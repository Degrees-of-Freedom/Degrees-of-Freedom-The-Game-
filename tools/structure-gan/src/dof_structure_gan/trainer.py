"""The adversarial training loop.

Per step: (1) *explore* by decoding generator samples (prior draws, plus
perturbations and blends of encoded elites), (2) *judge* them with the physics
oracle and aesthetic metrics, (3) *archive* the best per behaviour cell and
persist new excellent ones, then (4) *learn*: the surrogate fits the verdicts,
the discriminator separates generated structures from archived elites, and
the generator is trained to reconstruct elites, fool the discriminator and
please the surrogate. Quality therefore ratchets up as the archive improves.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F

from .archive import Archive
from .decode import decode
from .evaluation import Criteria, Evaluation, Evaluator
from .lattice import CHANNELS, GRID, Structure
from .nets import LATENT, Discriminator, Encoder, Generator, Surrogate, straight_through
from .physics import LoadCase
from .seeding import random_seed_structure
from .store import StructureStore

log = logging.getLogger(__name__)
_SHAPE = (CHANNELS, GRID, GRID, GRID)


@dataclass(frozen=True)
class TrainConfig:
    steps: int = 200
    batch: int = 16
    explore_per_step: int = 24
    seed_candidates: int = 1000
    learning_rate: float = 2e-4
    kl_weight: float = 0.5
    recon_pos_weight: float = 30.0
    adversarial_weight: float = 0.05
    surrogate_weight: float = 0.05
    surrogate_warmup: int = 64
    replay_size: int = 4096
    seed: int = 0
    workers: int = 1
    log_every: int = 10
    run_id: str = field(default_factory=lambda: time.strftime("run-%Y%m%d-%H%M%S"))
    load_case: LoadCase = LoadCase()
    criteria: Criteria = Criteria()


def to_batch(structures: list[Structure], device: torch.device) -> torch.Tensor:
    return torch.from_numpy(np.stack([s.to_tensor() for s in structures])).to(device)


class Replay:
    """Sparse buffer of (binary tensor, fitness) pairs that trains the surrogate."""

    def __init__(self, capacity: int) -> None:
        self._items: deque[tuple[np.ndarray, float]] = deque(maxlen=capacity)

    def __len__(self) -> int:
        return len(self._items)

    def add(self, hard: np.ndarray, fitness: float) -> None:
        self._items.append((np.flatnonzero(hard).astype(np.int32), fitness))

    def sample(self, count: int, rng: np.random.Generator, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
        picks = rng.integers(len(self._items), size=count)
        x = np.zeros((count, int(np.prod(_SHAPE))), dtype=np.float32)
        y = np.zeros(count, dtype=np.float32)
        for row, i in enumerate(picks):
            indices, y[row] = self._items[i]
            x[row, indices] = 1.0
        return torch.from_numpy(x.reshape(count, *_SHAPE)).to(device), torch.from_numpy(y).to(device)


@dataclass
class Stats:
    explored: int = 0
    decoded: int = 0
    passing: int = 0
    excellent: int = 0
    stored: int = 0


class Trainer:
    def __init__(self, config: TrainConfig, store: StructureStore, device: str = "cpu") -> None:
        self.config, self.store = config, store
        self.device = torch.device(device)
        torch.manual_seed(config.seed)
        self.rng = np.random.default_rng(config.seed)
        self.encoder = Encoder().to(self.device)
        self.generator = Generator().to(self.device)
        self.discriminator = Discriminator().to(self.device)
        self.surrogate = Surrogate().to(self.device)
        betas = (0.5, 0.9)
        lr = config.learning_rate
        self.opt_g = torch.optim.Adam([*self.encoder.parameters(), *self.generator.parameters()], lr, betas=betas)
        self.opt_d = torch.optim.Adam(self.discriminator.parameters(), lr, betas=betas)
        self.opt_s = torch.optim.Adam(self.surrogate.parameters(), lr, betas=betas)
        self.archive = Archive()
        self.replay = Replay(config.replay_size)
        self.evaluator = Evaluator(config.load_case, config.criteria, config.workers)
        self.stats = Stats()
        self._baseline_stored = len(store)

    # -- bootstrap -------------------------------------------------------------------------
    def bootstrap(self) -> None:
        """Fill the archive with verified procedural seeds (the first 'real' data)."""
        seeds = [s for s in (random_seed_structure(self.rng) for _ in range(self.config.seed_candidates)) if s]
        for evaluation in self.evaluator(seeds):
            self._record(evaluation, generation=0, source="seed")
        if len(self.archive) < 2:
            raise RuntimeError("Seeding produced fewer than two passing structures; relax the load case.")
        log.info("seeded archive: %d cells, best fitness %.3f", len(self.archive), self.archive.best_fitness())

    def _record(self, evaluation: Evaluation, *, generation: int, source: str) -> None:
        if self.archive.offer(evaluation) and evaluation.excellent:
            stored = self.store.add(
                evaluation, run_id=self.config.run_id, generation=generation, source=source,
                load_kn=self.config.load_case.vertical_n / 1000,
            )
            self.stats.stored += stored is not None

    # -- exploration -----------------------------------------------------------------------
    @torch.no_grad()
    def _latents(self, count: int) -> torch.Tensor:
        """A third prior draws; the rest perturb or blend encodings of archived elites."""
        z = torch.randn(count, LATENT, device=self.device)
        refs = to_batch(self.archive.sample(2 * count, self.rng), self.device)
        mu, _ = self.encoder(refs)
        a, b = mu[:count], mu[count:]
        t = torch.rand(count, 1, device=self.device)
        blended = torch.lerp(a, b, t) + 0.25 * torch.randn_like(a)
        perturbed = a + 0.5 * torch.randn_like(a)
        mode = torch.randint(0, 3, (count, 1), device=self.device)
        return torch.where(mode == 0, z, torch.where(mode == 1, blended, perturbed))

    @torch.no_grad()
    def explore(self, generation: int) -> None:
        self.generator.eval()
        logits = self.generator(self._latents(self.config.explore_per_step))
        self.generator.train()
        hard = (torch.sigmoid(logits) > 0.5).float().cpu().numpy()
        probabilities = torch.sigmoid(logits).cpu().numpy()
        decoded = [decode(p) for p in probabilities]
        self.stats.explored += len(decoded)
        self.stats.decoded += sum(s is not None for s in decoded)
        results = iter(self.evaluator([s for s in decoded if s is not None]))
        for structure, h in zip(decoded, hard):
            if structure is None:
                self.replay.add(h, 0.0)
                continue
            evaluation = next(results)
            self.replay.add(h, evaluation.fitness)
            self.stats.passing += evaluation.fitness > 0
            self.stats.excellent += evaluation.excellent
            self._record(evaluation, generation=generation, source="generator")

    # -- learning --------------------------------------------------------------------------
    def learn(self) -> dict[str, float]:
        cfg, dev = self.config, self.device
        real = to_batch(self.archive.sample(cfg.batch, self.rng), dev)
        out: dict[str, float] = {}

        # Surrogate: regress oracle fitness from sparse replay.
        if len(self.replay) >= cfg.surrogate_warmup:
            x, y = self.replay.sample(cfg.batch, self.rng, dev)
            loss_s = F.mse_loss(self.surrogate(x), y)
            self.opt_s.zero_grad()
            loss_s.backward()
            self.opt_s.step()
            out["surrogate"] = loss_s.item()

        # Discriminator: archived elites vs prior samples.
        z = torch.randn(cfg.batch, LATENT, device=dev)
        with torch.no_grad():
            fake = straight_through(self.generator(z))
        loss_d = F.relu(1 - self.discriminator(real)).mean() + F.relu(1 + self.discriminator(fake)).mean()
        self.opt_d.zero_grad()
        loss_d.backward()
        self.opt_d.step()
        out["discriminator"] = loss_d.item()

        # Generator + encoder: reconstruct elites, fool D, please the surrogate.
        mu, logvar = self.encoder(real)
        latent = mu + torch.randn_like(mu) * torch.exp(0.5 * logvar)
        logits = self.generator(latent)
        mask = self.generator.mask
        weight = torch.where(real > 0.5, torch.full_like(real, cfg.recon_pos_weight), torch.ones_like(real))
        recon = (F.binary_cross_entropy_with_logits(logits, real, weight=weight, reduction="none") * mask).sum() / cfg.batch
        kl = -0.5 * (1 + logvar - mu.pow(2) - logvar.exp()).sum() / cfg.batch
        fake = straight_through(self.generator(torch.randn(cfg.batch, LATENT, device=dev)))
        adversarial = -self.discriminator(fake).mean()
        loss_g = recon + cfg.kl_weight * kl + cfg.adversarial_weight * adversarial
        if len(self.replay) >= cfg.surrogate_warmup:
            loss_g = loss_g - cfg.surrogate_weight * self.surrogate(fake).mean()
        self.opt_g.zero_grad()
        loss_g.backward()
        self.opt_g.step()
        out.update(recon=recon.item(), kl=kl.item(), adversarial=adversarial.item())
        return out

    # -- loop ------------------------------------------------------------------------------
    def train(self) -> None:
        start = time.time()
        self.bootstrap()
        for step in range(1, self.config.steps + 1):
            self.explore(step)
            losses = self.learn()
            if step % self.config.log_every == 0 or step == self.config.steps:
                s = self.stats
                log.info(
                    "step %d/%d  decoded %d%% passing %d excellent %d  stored(+%d)  archive %d (%.0f%%) best %.3f  "
                    "recon %.1f D %.2f  [%.0fs]",
                    step, self.config.steps, 100 * s.decoded // max(s.explored, 1), s.passing, s.excellent,
                    s.stored, len(self.archive), 100 * self.archive.coverage(), self.archive.best_fitness(),
                    losses.get("recon", 0.0), losses.get("discriminator", 0.0), time.time() - start,
                )
        self.evaluator.close()
