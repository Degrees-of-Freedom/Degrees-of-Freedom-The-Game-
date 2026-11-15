"""Neural networks of the adversarial loop.

* :class:`Encoder` / :class:`Generator` form a variational auto-encoder over
  structure tensors. The encoder gives the generator a meaningful latent space
  from the first step, which a pure GAN cannot get from sparse binary voxels.
* :class:`Discriminator` (spectrally normalised, hinge loss) is the adversary
  that separates generated structures from the archive of verified elites.
* :class:`Surrogate` is a differentiable stand-in for the non-differentiable
  physics oracle: trained on solver verdicts, it lets the generator receive
  gradients that push toward stable, high-quality forms.

All three consume / produce ``(B, CHANNELS, GRID, GRID, GRID)`` tensors.
"""

from __future__ import annotations

import torch
from torch import nn
from torch.nn.utils import spectral_norm

from .lattice import CHANNELS, GRID, LOAD_CHANNEL, N_EDGE_CHANNELS, OFFSETS

LATENT = 64
_START = GRID // 4  # 3: the decoder upsamples 3 -> 6 -> 12


def validity_mask() -> torch.Tensor:
    """1 where a channel/position can exist in the lattice (member end in bounds, load above ground)."""
    mask = torch.zeros(CHANNELS, GRID, GRID, GRID)
    for channel, offset in enumerate(OFFSETS):
        lo = [max(0, -o) for o in offset]
        hi = [GRID - max(0, o) for o in offset]
        mask[channel, lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = 1.0
    mask[LOAD_CHANNEL, :, :, 1:] = 1.0
    return mask


def _down(c_in: int, c_out: int, *, norm: bool = True, spectral: bool = False) -> nn.Sequential:
    conv: nn.Module = nn.Conv3d(c_in, c_out, 4, stride=2, padding=1)
    if spectral:
        conv = spectral_norm(conv)
    layers: list[nn.Module] = [conv]
    if norm:
        layers.append(nn.GroupNorm(min(8, c_out), c_out))
    layers.append(nn.LeakyReLU(0.2))
    return nn.Sequential(*layers)


class Encoder(nn.Module):
    def __init__(self, width: int = 32) -> None:
        super().__init__()
        self.trunk = nn.Sequential(_down(CHANNELS, width), _down(width, width * 2), nn.Flatten())
        features = width * 2 * _START**3
        self.mu = nn.Linear(features, LATENT)
        self.logvar = nn.Linear(features, LATENT)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.trunk(x)
        return self.mu(h), self.logvar(h).clamp(-8.0, 4.0)


class Generator(nn.Module):
    """Latent vector to per-channel logits of the structure tensor."""

    def __init__(self, width: int = 32) -> None:
        super().__init__()
        self.width = width
        self.project = nn.Linear(LATENT, width * 2 * _START**3)
        self.net = nn.Sequential(
            nn.GroupNorm(min(8, width * 2), width * 2), nn.LeakyReLU(0.2),
            nn.ConvTranspose3d(width * 2, width * 2, 4, stride=2, padding=1),
            nn.GroupNorm(8, width * 2), nn.LeakyReLU(0.2),
            nn.ConvTranspose3d(width * 2, width, 4, stride=2, padding=1),
            nn.GroupNorm(min(8, width), width), nn.LeakyReLU(0.2),
            nn.Conv3d(width, CHANNELS, 3, padding=1),
        )
        self.register_buffer("mask", validity_mask())
        # Start sparse: a few dozen members, not thousands.
        with torch.no_grad():
            final = self.net[-1]
            assert isinstance(final, nn.Conv3d) and final.bias is not None
            final.bias.fill_(-4.0)

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        h = self.project(z).view(-1, self.width * 2, _START, _START, _START)
        logits = self.net(h)
        return torch.where(self.mask.bool(), logits, torch.full_like(logits, -20.0))


class Discriminator(nn.Module):
    def __init__(self, width: int = 32) -> None:
        super().__init__()
        self.net = nn.Sequential(
            _down(CHANNELS, width, norm=False, spectral=True),
            _down(width, width * 2, norm=False, spectral=True),
            nn.Flatten(),
            spectral_norm(nn.Linear(width * 2 * _START**3, 1)),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class Surrogate(nn.Module):
    """Predicts the oracle's fitness (0 for rejected structures) from a structure tensor."""

    def __init__(self, width: int = 32) -> None:
        super().__init__()
        self.net = nn.Sequential(
            _down(CHANNELS, width), _down(width, width * 2), nn.Flatten(),
            nn.Linear(width * 2 * _START**3, 64), nn.LeakyReLU(0.2), nn.Linear(64, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.net(x)).squeeze(-1)


def straight_through(logits: torch.Tensor, threshold: float = 0.5) -> torch.Tensor:
    """Binary forward pass matching real tensors, sigmoid gradient backward."""
    p = torch.sigmoid(logits)
    return (p > threshold).float() + p - p.detach()


__all__ = [
    "LATENT", "N_EDGE_CHANNELS", "Discriminator", "Encoder", "Generator", "Surrogate",
    "straight_through", "validity_mask",
]
