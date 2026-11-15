---
title: "Structure GAN"
last_validated: 2026-11-15
validated_against:
  - tools/structure-gan/README.md
  - tools/structure-gan/pyproject.toml
  - tools/structure-gan/src/dof_structure_gan
  - tools/structure-gan/tests
  - apps/web/src/game/calibration.test.ts
  - apps/web/src/game/evolvedStructures.test.ts
  - apps/web/public/structures/evolved.sqlite
  - apps/web/src/evaluator/sections.ts
  - apps/web/src/game/evolvedStructures.test.ts
  - services/opensees/src/dof_opensees/engine.py
  - .github/workflows/structure-gan.yml
owner: unknown
status: partial
---

# Structure GAN

`tools/structure-gan` is an offline Python tool that trains an adversarial neural network to invent structures that are complex, curved, organic, asymmetric, three-dimensional and visually dynamic **and** stable, then stores the excellent ones in `apps/web/public/structures/evolved.sqlite`. It is a design aid; nothing in the game loads that database yet. Do not read this page as a claim that the stored forms are curved or organic (they currently are not; see Evidence), engineered, playable under the card rules, or independently validated.

## Design

| Part | Module | What it does |
| --- | --- | --- |
| Representation | `lattice.py` | 12×12×12 lattice of 2 m cells (inside the voxel save limit of 16×16×14). Members join nodes at the 49 *primitive* offsets with components in −2…2, so a member never passes through another node. Tensor of 49 member channels plus one load channel. |
| Legality | `decode.py` | Deterministic repair of generator output: members must stay 0.35 cell apart unless they share a node, only the largest body touching the ground survives, at most 120 members, up to 6 supports, at most 5 loads (fallback: the highest node). The networks never need to learn these rules. |
| Networks | `nets.py`, `trainer.py` | A 3D-convolutional VAE (encoder + generator), a spectrally normalised hinge **discriminator** and a **surrogate** that regresses the oracle's fitness from solver verdicts, giving the generator gradients from non-differentiable physics. Generated samples reach the discriminator and surrogate as binary tensors with sigmoid gradients (straight-through). |
| Physics oracle | `physics.py` | `dof_opensees.engine.analyze` (the repository's OpenSees engine; the section is passed as per-member properties, compatible with main as of the 2026-11-15 merge) with the game's `shs` card (SHS 100×6, S355), rigid joints, fixed foundations, self-weight and ULS partial factors (1.35 dead, 1.5 applied) plus a 3% notional lateral push. A structure passes only if it is stable, equilibrium residual < 1e-6, elastic utilisation ≤ 0.45 and maximum displacement ≤ 1/60 of its extent. |
| Aesthetics | `metrics.py` | Six heuristics in [0, 1]: curvature, organic, asymmetry, dimensionality, complexity, dynamism. They are proxies, defined in the module docstrings, not measures of beauty. |
| Archive | `archive.py` | MAP-Elites-style grid over curvature × dynamism × complexity (4 bins each). Each cell keeps its fittest passing structure; these are the discriminator's "real" samples, so quality ratchets up while diversity is kept. Duplicates are detected under footprint symmetry and horizontal translation. |
| Database | `store.py` | Table `evolved_structures` with scores, oracle provenance, `source` (`seed` or `generator`) and a `dof-voxel-save` v1 document in `save_json` (all members `shs` with rigid joints, ground supports as foundations, loads in kN). |

Fitness is 0 unless the oracle passes; otherwise `0.3 × structural margin + 0.7 × mean aesthetics`. A structure is **excellent** (and stored when it also improves its archive cell) if fitness ≥ 0.62, every aesthetic component ≥ 0.3 and it has ≥ 20 members. Real samples are bootstrapped from procedural seeds (`seeding.py`): spline-guided, laced twin ribs rasterised onto the lattice.

## Evidence

All numbers below are from one run (`--steps 700 --workers 3`, seed 0, CPU, about 32 minutes on 4 cores) and its database; they are observations, not guarantees.

- **Oracle calibration.** The first oracle used a stiffer section than the game's and a game check flagged one stored structure as a mechanism. After switching to the game's section, self-weight and factored loads, 900 sampled seeds were run through both the oracle and the game's voxel analysis (`analyzeGame`): 0 of 114 oracle-passing seeds were game mechanisms (242 of 786 oracle-failing seeds were), and the two utilisations correlated at 0.84. With an oracle utilisation limit of 0.5, 41 of 42 passing seeds had game utilisation ≤ 1, so 0.45 is used. Since 2026-11-15 `analyzeGame` runs on the Rust solver (see [voxel retirement](voxel-retirement.md)). All 105 stored structures still pass `evolvedStructures.test.ts` there: no mechanism, floating part or unresolved buckling, and game utilisation ≤ 1. The calibration itself has not been re-run against the Rust analysis.
- **Metric defect found and fixed.** Curvature originally looked only at degree-2 nodes, so every stable (braced) seed scored 0. It now follows the straightest chord continuation through junctions; `test_curved_lattice_girder_counts_as_curved` covers this.
- **Training outcome (second run, retuned metrics).** `--steps 1100 --workers 3`, seed 0, about 68 minutes on 4 cores. 1,000 seed candidates gave 8 archive cells and 2 excellent seeds. The archive ended at 57 of 64 cells (89%), best fitness 0.800, and the database holds 105 distinct structures (2 from seeds, 103 from the generator) after the game gate removed none. Means: members 68 (range 28-120), oracle utilisation 0.06, curvature 0.59, organic 0.38, asymmetry 0.73, dimensionality 0.87, complexity 0.65, dynamism 0.66. This replaces an earlier 88-structure run scored with saturated metrics.
- **Visual inspection (previews of the six best).** They do **not** look curved or organic: they are boxy, mostly axis-aligned braced frames with dangling vertical stubs (members with a free end), and three of the six are near-duplicates that exact-hash deduplication does not catch. Their curvature scores of 0.83-1.00 are therefore spurious: following the straightest continuation through a junction lets a post turn into a 45-degree brace and count as a bend. Treat the curvature score, and the "curved" claim for this database, as unverified until the metric is fixed (see Limits).
- **Independent game check.** `apps/web/src/game/evolvedStructures.test.ts` loads every row through the game's save validator and `analyzeGame`: all 105 load, fit the grid, and have no mechanism, floating body or solver error, and game maximum utilisation ≤ 1. The test fails if the database is empty or a row regresses.
- **Tests.** 55 pytest tests (lattice, repair, physics, metrics, archive, store, networks, checkpoint resume, calibration, a deterministic training smoke test, CLI) and the game-side Vitest suite passed on the branch.

## Limits and open decisions

- The metrics no longer saturate, but the **curvature metric is gameable** (see the visual inspection) and nothing penalises dangling members, near-duplicates in shape, or boxy rectilinear scaffolding. The stored set therefore satisfies stability and the game gate but not yet the intended organic, curved look. Planned fixes, none implemented: require sustained curvature over at least four chord members with a mostly oblique, non-axis-aligned path; remove or penalise members with a free end; add a shape-similarity (not exact-hash) diversity measure to the archive.
- One load case by default (`--both-wind-directions` adds the reversed lateral push) and a linear elastic analysis. No buckling, connection design, dynamic or nonlinear check beyond the game's own analysis (the voxel analysis at calibration time, the Rust solver since 2026-11-15). The oracle's utilisation is a screening value, deliberately well below the game's limit.
- Playability is not assessed: card inventory, placement rules, the 3-cell member length limit for `shs` (the longest primitive offset is exactly 3 cells), clashes with the game's own physical rules beyond the 0.35-cell clearance, and balance are all unchecked.
- Stored rows carry isometric SVG previews (`preview.py`; exact lattice geometry, not deflected shapes) rather than the PNG previews of the main library, whose script needs Windows GDI+. The game UI does not list the evolved database; like `structures.sqlite` it is a downloadable file. Whether to surface it is an open product decision.
- Runs can be checkpointed and resumed (`--checkpoint`, `--resume`); without a checkpoint the networks and archive restart each run and only the database accumulates. Parallel workers use one OpenSees instance per process.
- CI (`.github/workflows/structure-gan.yml`) was written but not run. The default PyPI torch wheel bundles CUDA libraries; a CPU-only index would shorten CI.

The 105 stored rows were re-analysed after merging main's reworked OpenSees engine: all still pass the oracle, with utilisation differing from the stored values by at most 3.4% (the stored values predate the Euler buckling term).

## Calibration finding (fresh sample) and the game gate

Re-running the comparison with the new tooling on 500 fresh seeds (52 within the displacement limit) found 0 game mechanisms among those 52 (versus 147 of 448 for the too-flexible ones), but the utilisation agreement was weaker than the first calibration suggested: correlation 0.50, and only 86-91% of structures at oracle limits of 0.45-0.55 had game utilisation ≤ 1 (samples of 11-21). The earlier "41 of 42" figure does not generalise. A pinned-pinned Euler buckling term was added to the oracle's compression capacity; it did not materially change the agreement, and some outliers remain (for example oracle 0.42 against game 3.46 with 22 failing members, cause not identified). Therefore the oracle's utilisation limit is a pre-filter, not a guarantee. The guarantee is the game gate: `export-db`, the Vitest calibration harness and `prune-db` remove any stored row the game rejects, and `evolvedStructures.test.ts` fails if one remains.

## Recalibration

`calibration.py`, `calibration.test.ts` and two CLI commands make the oracle-versus-game comparison repeatable (steps in the tool README). They are tested on synthetic data (`tests/test_calibration.py`) and were run once on real seeds (above). `export-db` / `prune-db` apply the same harness to the stored database.

## Commands

```bash
cd tools/structure-gan
uv sync
uv run pytest
uv run dof-structure-gan train --steps 700 --workers 3
uv run dof-structure-gan top --limit 10
```

From the repository root, verify stored structures with the game's own solver: `npx vitest run apps/web/src/game/evolvedStructures.test.ts` (needs Node ≥ 22.13 for `node:sqlite`).
