# Voxel Struct prototype

A self-contained, single-file browser prototype of the build-and-analyse loop: players place structural items on a 3D voxel grid, run a structural analysis, and see stability and design results. It is independent of the TypeScript scaffold in `apps/web` and the solver contract in `packages/solver-contract`; nothing there depends on it.

The workspace groups editing tools and existing prototype items into member, connection and support, and load libraries. These entries and their properties are provisional, not the agreed game catalog. Grouping them does not change the solver, inventories, or shortcuts. Springs are not implemented in this prototype.

## Run

From the repository root, create and activate the shared Python environment once:

```bash
conda env create -f environment.yml
conda activate degrees-of-freedom
```

On subsequent sessions, only activation is needed. The prototype currently uses Python's built-in HTTP server and has no third-party Python dependencies. Add project Python dependencies to `environment.yml` as they are chosen; after changing it, run `conda env update -f environment.yml`.

Serve the folder over HTTP (ES modules and the Three.js import map do not load from `file://` or `data:` URLs), for example:

```bash
python -m http.server 8765 --directory prototypes/voxel-struct
```

Then open `http://localhost:8765`. Three.js 0.160.0 is loaded from the jsDelivr CDN, so an internet connection is required.

## Gameplay

- Grid: 2 m voxels. Members connect voxel corners; beams span at most 3 cells per axis, cables at most 8.
- Items (limited supply per level): SHS 100×6 steel tube, glulam 200×400, IPE 300, HEB 300, Ø24 cable (tension only, 25 kN pretension), moment connection (makes all member ends at a node rigid and raises joint capacity), foundation (fixed support on solid ground, not water).
- Levels: Tower I (12 m), Tower II (24 m), Bridge I (16 m span), Bridge II (28 m span), Sandbox (unlimited supply, placeable 50 kN point loads). Stars depend on cost against a level budget.
- Editing members:
  - **Remove** tool (or Delete/Backspace on a member selected with Inspect, or the panel's *Remove member* button) deletes it and returns the item to the supply. On nodes it removes attachments (load, then moment connection, then foundation); abutment bearings are locked.
  - **Swap** tool replaces a member with the chosen type (any beam ↔ beam or beam ↔ cable) in place, keeping its id and end nodes; Shift+click swaps every member of the clicked type as far as supply allows. The Inspect panel's *Swap to* list does the same for one member.
  - Swaps are refused when the target type has no supply left or the member is longer than the target's per-axis limit (3 cells for beams). Every remove or swap is one undo step and clears stale analysis results.
- **Example** loads a passing reference structure for Tower I and Bridge I. Tower II and Bridge II have no reference solution yet, so their supply and budget are unverified.

## Analysis (as implemented)

- Linear 3D frame model, 6 DOF per node, dense banded Cholesky on spatially ordered nodes. Joints are pinned by default (end moments released by static condensation); moment connections make ends rigid. Cables are axial-only, tension-only (iterated active set) with pretension applied as an initial strain.
- A tiny diagonal regularisation (1e-3) keeps the matrix positive definite; any node moving more than 2 m flags a mechanism.
- Load combinations: ULS 1.35G + 1.5Q + 0.9W and SLS G + Q + 0.6W, each with wind in +X and +Y. ULS adds notional horizontal loads of 1/200 of the vertical load per node. Wind pressure q0·(z/10)^0.25 acts on member projected depth.
- Global stability: critical load factor αcr found by bisection on positive-definiteness of K + λ·Kg (string geometric stiffness, or the consistent beam geometric stiffness for members rigid at both ends). αcr < 1 fails; for 1 < αcr < 10 moments are amplified by 1/(1 − 1/αcr).
- Member design (simplified Eurocode-style): strength (N + My + Mz interaction), shear, flexural buckling (χ from imperfection curves, effective length 1.0/0.85/0.7 by end fixity), slenderness (λ ≤ 200 compression, 300 tension), SLS deflection L/250, connection capacity (pinned 350 kN; rigid 700 kN and 220 kNm). Foundations: bearing 1500 kN, uplift 250 kN, shear 350 kN, moment 300 kNm (abutment bearings 3×).
- Level checks: tower top drift ≤ H/200 (SLS); continuous deck beams at deck level and deck deflection ≤ span/400 (SLS) for bridges.
- Auto-design picks the cheapest beam section in remaining supply with utilisation ≤ 95% using current forces, then re-analyses (up to 4 rounds).

## Known simplifications

- Member self-weight is lumped to end nodes, with a qL²/8 (pinned) or qL²/24 (rigid) correction added to mid-span moments.
- Torsion and lateral-torsional buckling are not design-checked.
- Analysis is linear; second-order effects enter only through αcr and the moment amplifier.

## Manual checks performed

These were run in a browser, not as automated tests:

- The Tower I and Bridge I examples pass every objective.
- A 24 m rigid-jointed HEB 300 cantilever gives αcr 0.883, against about 0.89 by hand (Euler weak axis with distributed self-weight).
- On a guyed mast, the sum of support reactions equals the applied loads, and the cables stay taut under pretension.
- A 735-member, 1050-DOF sandbox model analyses in about 0.65 s.
