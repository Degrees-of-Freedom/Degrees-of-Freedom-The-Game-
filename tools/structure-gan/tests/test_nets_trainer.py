import numpy as np
import torch

from dof_structure_gan.lattice import CHANNELS, GRID, LOAD_CHANNEL
from dof_structure_gan.nets import LATENT, Discriminator, Encoder, Generator, Surrogate, straight_through, validity_mask
from dof_structure_gan.store import StructureStore
from dof_structure_gan.trainer import Replay, TrainConfig, Trainer


def test_validity_mask_blocks_out_of_bounds_members_and_ground_loads():
    mask = validity_mask()
    assert mask.shape == (CHANNELS, GRID, GRID, GRID)
    assert mask[LOAD_CHANNEL, :, :, 0].sum() == 0 and mask[LOAD_CHANNEL, :, :, 1:].min() == 1
    from dof_structure_gan.lattice import OFFSETS

    up = OFFSETS.index((0, 0, 1))
    assert mask[up, :, :, GRID - 1].sum() == 0 and mask[up, :, :, : GRID - 1].min() == 1


def test_shapes_and_straight_through_is_binary_forward_with_gradient():
    g, e, d, s = Generator(), Encoder(), Discriminator(), Surrogate()
    z = torch.randn(3, LATENT, requires_grad=True)
    logits = g(z)
    x = straight_through(logits)
    assert x.shape == (3, CHANNELS, GRID, GRID, GRID)
    assert set(torch.unique(x.detach().round()).tolist()) <= {0.0, 1.0}
    assert d(x).shape == (3,) and s(x).shape == (3,) and e(x)[0].shape == (3, LATENT)
    d(x).sum().backward()
    assert z.grad is not None and torch.isfinite(z.grad).all()
    invalid = ~g.mask.bool()
    assert (logits.detach()[:, invalid] == -20).all()


def test_replay_roundtrips_sparse_tensors():
    replay = Replay(4)
    hard = np.zeros((CHANNELS, GRID, GRID, GRID), dtype=np.float32)
    hard[3, 1, 2, 3] = 1.0
    replay.add(hard.ravel(), 0.7)
    x, y = replay.sample(2, np.random.default_rng(0), torch.device("cpu"))
    assert x.shape == (2, CHANNELS, GRID, GRID, GRID) and x[0, 3, 1, 2, 3] == 1 and x.sum() == 2
    assert torch.allclose(y, torch.tensor([0.7, 0.7]))


def test_training_smoke_is_deterministic_and_stores_only_excellent(tmp_path):
    def run(name):
        config = TrainConfig(steps=3, batch=4, explore_per_step=4, seed_candidates=60, seed=7, log_every=100)
        with StructureStore(tmp_path / name) as store:
            Trainer(config, store).train()
            return sorted(r["id"] for r in store.top(1000)), len(store)

    first, count = run("a.sqlite")
    second, _ = run("b.sqlite")
    assert first == second and count == len(first)
