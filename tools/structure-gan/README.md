# structure-gan

Offline tool that trains an adversarial neural network to invent **complex but stable** structures for
Degrees of Freedom: The Game, and stores the excellent ones in a SQLite database. It is a design aid,
not part of the shipped game. The knowledge-base page [`docs/kb/structure-gan.md`](../../docs/kb/structure-gan.md)
records the design, calibration evidence and limits.

## How it works

```
 procedural seeds ──► physics oracle ──► archive of verified elites ──► "real" samples
                          ▲                      │                          │
 generator (VAE decoder) ─┴─ explore ◄───────────┘                          ▼
        ▲   ▲                                                       discriminator (adversary)
        │   └─────────── surrogate critic (learns the oracle) ◄── replay of solver verdicts
        └──────────────────────── gradients ◄──────────────────────────────┘
```

* **Representation** (`lattice.py`): a 12×12×12 lattice, 2 m cells, members between nodes at primitive
  offsets up to ±2 cells (49 member directions), loads as a channel, supports on the ground plane.
* **Generator / discriminator / surrogate** (`nets.py`, `trainer.py`): a 3D-convolutional VAE decoder
  is trained against a spectrally normalised hinge discriminator and a surrogate that regresses the
  oracle's fitness, so the generator gets gradients from the non-differentiable physics.
* **Rules, not hopes** (`decode.py`): generated tensors become legal structures by deterministic repair:
  no crossing members, one grounded body, bounded size, at least one load.
* **Physics oracle** (`physics.py`): the repository's OpenSees engine (`services/opensees`) with the
  game's SHS 100×6 section, rigid joints, fixed foundations, self-weight and ULS-factored loads.
* **Aesthetics** (`metrics.py`): six documented heuristics in `[0, 1]`: curvature, organic, asymmetry,
  dimensionality, complexity and dynamism.
* **Quality-diversity archive** (`archive.py`): best verified structure per (curvature, dynamism,
  complexity) cell is the discriminator's real set, so quality ratchets up without collapsing to one form.
* **Database** (`store.py`): `evolved_structures` table with a game-loadable `dof-voxel-save` per row.

## Use

```bash
cd tools/structure-gan
uv sync
uv run pytest
uv run dof-structure-gan train --steps 1200 --workers 3   # appends to apps/web/public/structures/evolved.sqlite
uv run dof-structure-gan top --limit 10
```

`train` is resumable only in the sense that the database accumulates: networks restart each run and the
archive is re-seeded. Duplicate structures (under footprint symmetry and translation) are never stored twice.
Workers should not exceed the CPU count; the oracle runs one OpenSees instance per process.

Verify stored structures against the game's own loader and solver from the repository root:

```bash
npx vitest run apps/web/src/game/evolvedStructures.test.ts
```
