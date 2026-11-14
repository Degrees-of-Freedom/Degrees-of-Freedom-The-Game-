# Voxel Struct prototype archive

This document records the original standalone experiment. The maintained version is the React workspace in `apps/web`; run it with `npm run dev` from the repository root. For historical comparison, see the [archived HTML at `bc702ad`](https://github.com/Degrees-of-Freedom/Degrees-of-Freedom-The-Game-/blob/bc702ad/prototypes/voxel-struct/index.html), the last standalone revision, which this document describes. An earlier snapshot is at [`0a40a92`](https://github.com/Degrees-of-Freedom/Degrees-of-Freedom-The-Game-/blob/0a40a9298887989a89cc91c3cdc759ac028e0d44/prototypes/voxel-struct/index.html). To run either version, check out the linked revision in a separate worktree and serve its `prototypes/voxel-struct` folder over HTTP. It loads Three.js from a CDN.

These features exist only in the archived `bc702ad` HTML and are not yet in the workspace: corner-to-corner unit members with per-piece supply and continuous straight runs, the Flip-the-force levels, and the degrees-of-freedom view.

## Gameplay

- Grid: 2 m voxels. Every member piece runs from one voxel corner to the next: a step of at most one cell per axis (straight, face diagonal or space diagonal). Drawing a longer straight line builds one piece per field (up to 12), and each piece uses one item from the supply; lines that would skip corners are refused. Costs are per piece. Saves from before this rule are split into pieces on load, and members that skip corners are dropped.
- Items (limited supply per level): SHS 100×6 steel tube, glulam 200×400, IPE 300, HEB 300, Ø24 cable (tension only, 25 kN pretension), moment connection (makes all member ends at a node rigid and raises joint capacity), foundation (fixed support on solid ground, not water).
- Levels: Tower I (12 m), Tower II (24 m), Bridge I (16 m span), Bridge II (28 m span), Pick-up I, Pick-up II, Pick-up (random), Flip I, Flip II, Sandbox (unlimited supply, placeable 50 kN point loads). Stars depend on cost against a level budget.
- **Pick-up mode**: weights (20–60 kN) hang at fixed voxel corners in the air; they are locked and survive Clear. The goal is one structure that connects every weight to foundations and passes all checks, with each weight moving at most (its height above ground)/250 under service loads. Crates show amber before analysis, green when picked up, red when still floating. Pick-up II puts two weights over a lake (no foundations on water). The random level generates 3–5 weights (2–6 cells high, at least 3 cells apart) and **New layout** replaces them.
- Editing members:
  - **Remove** tool (or Delete/Backspace on a member selected with Inspect, or the panel's *Remove member* button) deletes it and returns the item to the supply. On nodes it removes attachments (load, then moment connection, then foundation); abutment bearings are locked.
  - **Swap** tool replaces the whole straight run of the clicked piece (same section, collinear) with the chosen type in place (any beam ↔ beam or beam ↔ cable); Shift+click swaps every piece of the clicked type as far as supply allows. The Inspect panel's *Swap to* list does the same for one run.
  - Swaps are refused when the target type does not have one supply item per piece left. Removing works per piece. Every remove or swap is one undo step and clears stale analysis results.
- **Flip mode**: a structure is given and one member (orange, labelled TARGET, locked against removal and swaps) carries a force in one direction. Change the rest so that this member carries the opposite axial force, at least 5 kN, in every ULS load case, while all checks pass. The supply is the given structure's parts plus a few extra; removed parts return to the supply. Flip levels are analysed on load, so the current force is shown immediately. Flip I (see-saw) turns a compressed column into a tie; Flip II (hanger to prop) turns a hanger into a strut. Both have been solved by hand with the solver (see below), but there is no Example button for them.
- Bridge traffic acts on the two lanes above the abutment bearings (lane nodes over the gap share it).
- **Example** loads a passing reference structure for Tower I, Bridge I and Pick-up I. Tower II, Bridge II, Pick-up II and random layouts have no reference solution yet, so their supply, budget and solvability are unverified.

## Analysis (as implemented)

- Physical members: pieces are merged into one analysis member through pass-through nodes. A node is pass-through when exactly two pieces of the same type meet there in a straight line and the node has no support, joint or load and is not a load point (tower top level, bridge lane nodes). Where two members of the same beam section continue in a straight line through a junction node, they are spliced: both ends are rigid there and no connection check is made. Design checks (buckling length, deflection) therefore use the member length between junctions.
- Linear 3D frame model, 6 DOF per node, dense banded Cholesky on spatially ordered nodes. Joints are pinned by default (end moments released by static condensation); moment connections make ends rigid. Cables are axial-only, tension-only (iterated active set) with pretension applied as an initial strain.
- A tiny diagonal regularisation (1e-3) keeps the matrix positive definite; any node moving more than 2 m flags a mechanism.
- Load combinations: ULS 1.35G + 1.5Q + 0.9W and SLS G + Q + 0.6W, each with wind in +X and +Y. ULS adds notional horizontal loads of 1/200 of the vertical load per node. Wind pressure q0·(z/10)^0.25 acts on member projected depth.
- Global stability: critical load factor αcr found by bisection on positive-definiteness of K + λ·Kg (string geometric stiffness, or the consistent beam geometric stiffness for members rigid at both ends). αcr < 1 fails; for 1 < αcr < 10 moments are amplified by 1/(1 − 1/αcr).
- Member design (simplified Eurocode-style): strength (N + My + Mz interaction), shear, flexural buckling (χ from imperfection curves, effective length 1.0/0.85/0.7 by end fixity), slenderness (λ ≤ 200 compression, 300 tension), SLS deflection L/250, connection capacity (pinned 350 kN; rigid 700 kN and 220 kNm). Foundations: bearing 1500 kN, uplift 250 kN, shear 350 kN, moment 300 kNm (abutment bearings 3×).
- Level checks: tower top drift ≤ H/200 (SLS); continuous deck beams at deck level and deck deflection ≤ span/400 (SLS) for bridges.
- **Load path view** (L, or the Load path card): members are drawn with thickness ∝ √(transferred force) and coloured by how they carry it: compression, tension, or bending/shear (|N| < 0.7 of the end-force resultant). Members under 1 % of the peak force fade out, and dots flow along loaded members towards the supports. The flow direction comes from a Dijkstra "distance to ground" from the foundations, where an edge costs L·Fmax/(F + 0.02·Fmax), so heavily loaded members form the routes. Inspecting a node traces its main route to a support. The card lists each support's share of the vertical load. This is a visual reading of the analysis forces for the selected load case, not an extra structural check.
- **Degrees-of-freedom view** (F, or the Degrees of freedom card) shows, for the selected load case, the six DOFs of every solved node (translations X, Y, Z, then rotations X, Y, Z; colours red, green, blue):
  - translations are glowing arrows along ±axis, with length and opacity ∝ √(|u|/max|u|), so idle DOFs fade to a faint shadow;
  - DOFs locked by a foundation are solid grey stubs with end plates (translation) or solid grey rings (rotation);
  - rotations at nodes with at least one rigid member end (moment connection or continuous member) are coloured arcs whose sweep ∝ √(|θ|/max|θ|); rotations at nodes where every member is pinned are dashed hinge rings;
  - each node's dominant DOF is drawn at full strength, and nodes of a mechanism turn violet;
  - the structure "breathes" between its undeformed and deformed shape, leaving four fading ghost copies of the deformed shape; members turn translucent and joint cubes and node spheres are hidden, so the glyphs read clearly.

  Glyphs scale with the model size. The card counts solved, locked, free and hinged DOFs, lists the most mobile nodes, and gives a six-row readout (mm, mrad) for an inspected node. Pass-through nodes inside a member have no DOFs of their own and are shown by interpolation. The DOF view and the load path view are mutually exclusive.
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
- With unit pieces, the Tower I (78 pieces → 36 members), Bridge I and Pick-up I examples all pass.
- Flip I: the given frame fails only the flip objective (target N = −44 kN). Removing the right column and adding a fixed-base HEB column at x = 8 m under the beam makes the target +41 kN and passes everything.
- Flip II: the given frame fails only the flip objective (+45 kN). Adding a fixed-base SHS prop with a foundation under the hanging weight makes the hanger −29 kN and passes everything.
