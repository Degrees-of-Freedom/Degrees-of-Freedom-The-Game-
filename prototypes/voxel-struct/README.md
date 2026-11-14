# Voxel Struct prototype

A self-contained, single-file browser prototype of the build-and-analyse loop: players place structural items on a 3D voxel grid, run a structural analysis, and see stability and design results. It is independent of the TypeScript scaffold in `apps/web` and the solver contract in `packages/solver-contract`; nothing there depends on it.

## Run

Serve the folder over HTTP (ES modules and the Three.js import map do not load from `file://` or `data:` URLs), for example:

```bash
python -m http.server 8765 --directory prototypes/voxel-struct
```

Then open `http://localhost:8765`. Three.js 0.160.0 is loaded from the jsDelivr CDN, so an internet connection is required.

## Gameplay

- Grid: 2 m voxels. Members connect voxel corners; beams span at most 3 cells per axis, cables at most 8.
- Items (limited supply per level): SHS 100×6 steel tube, glulam 200×400, IPE 300, HEB 300, Ø24 cable (tension only, 25 kN pretension), moment connection (makes all member ends at a node rigid and raises joint capacity), foundation (fixed support on solid ground, not water).
- Levels: Tower I (12 m), Tower II (24 m), Bridge I (16 m span), Bridge II (28 m span), Pick-up I, Pick-up II, Pick-up (random), Sandbox (unlimited supply, placeable 50 kN point loads). Stars depend on cost against a level budget.
- **Pick-up mode**: weights (20–60 kN) hang at fixed voxel corners in the air; they are locked and survive Clear. The goal is one structure that connects every weight to foundations and passes all checks, with each weight moving at most (its height above ground)/250 under service loads. Crates show amber before analysis, green when picked up, red when still floating. Pick-up II puts two weights over a lake (no foundations on water). The random level generates 3–5 weights (2–6 cells high, at least 3 cells apart) and **New layout** replaces them.
- Editing members:
  - **Remove** tool (or Delete/Backspace on a member selected with Inspect, or the panel's *Remove member* button) deletes it and returns the item to the supply. On nodes it removes attachments (load, then moment connection, then foundation); abutment bearings are locked.
  - **Swap** tool replaces a member with the chosen type (any beam ↔ beam or beam ↔ cable) in place, keeping its id and end nodes; Shift+click swaps every member of the clicked type as far as supply allows. The Inspect panel's *Swap to* list does the same for one member.
  - Swaps are refused when the target type has no supply left or the member is longer than the target's per-axis limit (3 cells for beams). Every remove or swap is one undo step and clears stale analysis results.
- **Example** loads a passing reference structure for Tower I, Bridge I and Pick-up I. Tower II, Bridge II, Pick-up II and random layouts have no reference solution yet, so their supply, budget and solvability are unverified.

## Analysis (as implemented)

- Linear 3D frame model, 6 DOF per node, dense banded Cholesky on spatially ordered nodes. Joints are pinned by default (end moments released by static condensation); moment connections make ends rigid. Cables are axial-only, tension-only (iterated active set) with pretension applied as an initial strain.
- A tiny diagonal regularisation (1e-3) keeps the matrix positive definite; any node moving more than 2 m flags a mechanism.
- Load combinations: ULS 1.35G + 1.5Q + 0.9W and SLS G + Q + 0.6W, each with wind in +X and +Y. ULS adds notional horizontal loads of 1/200 of the vertical load per node. Wind pressure q0·(z/10)^0.25 acts on member projected depth.
- Global stability: critical load factor αcr found by bisection on positive-definiteness of K + λ·Kg (string geometric stiffness, or the consistent beam geometric stiffness for members rigid at both ends). αcr < 1 fails; for 1 < αcr < 10 moments are amplified by 1/(1 − 1/αcr).
- Member design (simplified Eurocode-style): strength (N + My + Mz interaction), shear, flexural buckling (χ from imperfection curves, effective length 1.0/0.85/0.7 by end fixity), slenderness (λ ≤ 200 compression, 300 tension), SLS deflection L/250, connection capacity (pinned 350 kN; rigid 700 kN and 220 kNm). Foundations: bearing 1500 kN, uplift 250 kN, shear 350 kN, moment 300 kNm (abutment bearings 3×).
- Level checks: tower top drift ≤ H/200 (SLS); continuous deck beams at deck level and deck deflection ≤ span/400 (SLS) for bridges.
- **Load path view** (L, or the Load path card): members are drawn with thickness ∝ √(transferred force) and coloured by how they carry it: compression, tension, or bending/shear (|N| < 0.7 of the end-force resultant). Members under 1 % of the peak force fade out, and dots flow along loaded members towards the supports. The flow direction comes from a Dijkstra "distance to ground" from the foundations, where an edge costs L·Fmax/(F + 0.02·Fmax), so heavily loaded members form the routes. Inspecting a node traces its main route to a support. The card lists each support's share of the vertical load. This is a visual reading of the analysis forces for the selected load case, not an extra structural check.
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
- Load path on the Bridge I example: each bearing takes 25 % of the vertical load, all truss members show as axial, and a mid-deck node traces through a tension diagonal and a compression end post to a bearing.
- Pick-up I: empty, partial and complete structures report 0/3, 1/3 and 3/3 weights picked up, and the reference solution passes.
