# Game logic and modes (planning draft)

Status: proposal for discussion. Nothing here is implemented or decided.
Numbers (penalties, actions per turn, round counts) are placeholders chosen
to make the rules concrete. Open `game-modes.html` beside this file for a
picture of each mode.

Sources this draft builds on, read on 2026-11-14 and not modified:

- `origin/main`: `packages/solver-contract/src/index.ts`,
  `apps/web/src/game/store.ts`, `docs/kb/game-dynamics.md`,
  `docs/kb/structural-solver.md`.
- `origin/feature/voxel-struct-prototype`: `prototypes/voxel-struct/`
  (a working build-and-analyse loop with its own frame solver).

## 1. Shared vocabulary

| Term | Meaning in the rules |
| --- | --- |
| Foundation | A supported node on the ground. In multiplayer each one belongs to a player. |
| Member | A straight piece between two grid points. Section and material are predetermined. |
| Connection | How a member end is attached at a node: which of the six degrees of freedom it passes on. The simplest pair is rigid (passes moment) and pinned (does not). |
| Load | A point force at a node: location, direction, amount. |
| Instability | A part of the structure that can move without resistance. See 2.2. |
| Solve | One run of the structural solver on the current model. |
| Owner | The player who placed a piece. Game state, not solver input. |

## 2. The two measurements every mode scores with

All four modes are scored from the same two solver outputs.

### 2.1 Load on a foundation

The reaction at a foundation after a solve, in kN. Proposed measure: the
vertical reaction, counted only when it pushes down on the ground.

Two facts shape the rules:

- **In a stable structure the reactions add up to the applied load.** With
  one player, "load on my foundation" is therefore just the load they chose
  to apply. On its own it measures daring, not design. Single-player modes
  need a second quantity to make it mean something (section 4.1 proposes
  material used).
- **With several foundations it becomes a share,** and the shares always
  total 100%. That makes it a natural competitive score: stiffer, more direct
  load paths attract more of the load.

### 2.2 Instability

The modes need a number, not only yes or no. Three candidate definitions:

| Definition | For | Against |
| --- | --- | --- |
| A. Nodes that move freely | Already computed in the voxel-struct prototype (nodes displacing more than 0.5 m after a regularised solve). Easy to show: highlight the nodes. | Threshold-based. One loose member can flag several nodes. |
| B. Independent mechanisms (zero-stiffness modes of the stiffness matrix) | The exact engineering meaning. One number per way the structure can move. | Needs an eigen-solve that no branch has yet. Harder to explain. |
| C. Yes or no | Simplest. | Cannot rank players or measure progress in Forensics. |

**Proposed:** use A now because it exists and is easy to show; keep B as the
target. Pieces with no path to any foundation count as unstable too.

### 2.3 What the solver must return for these rules

The contract on main (`AnalysisResult`) returns six displacements per node and
warnings. The rules above also need:

- reactions per support (six values);
- an instability report: a flag, and the nodes (or modes) involved;
- which nodes have no path to a support.

The voxel-struct prototype already computes all three internally. They are
not part of the shared contract yet.

### 2.4 Scoring when the structure is unstable

A solve of a mechanism has no meaningful reactions. Proposed rule: load only
counts through the stable part. If a foundation is attached to an unstable
part, its load score for that solve is zero.

## 3. Shared turn structure

Every mode is the same loop with different settings:

```
Setup  ->  Act  ->  Solve  ->  Score  ->  next turn, or End
```

| Setting | Creative | Multiplayer | Forensics | Load in space |
| --- | --- | --- | --- | --- |
| Players | 1 | 4, in turn | 1 | 1 |
| Starts with | Empty space | Empty site, scenario loads | A given structure with instabilities | A foundation and a load in space |
| Foundations | Player places | One per player, placed in round 1 | Given | Given |
| Loads | Player places | Given by the scenario | Given | Given |
| Actions per turn | Unlimited | 1 member + 2 connections | 1 fix | Unlimited (or a supply) |
| Solve happens | When the player asks | After every turn | After every fix | When the player asks |
| Ends when | Player stops | Last round is played | No instabilities remain | Load reaches the foundation, stable |
| Scored on | Load carried per metre, minus instabilities | Share of load on your foundation, minus your instabilities | Fixes used against par | Material used against par |

## 4. The modes

### 4.1 Creative

A sandbox with a score at the end.

1. The player places members starting from any point in space. Pieces do not
   have to touch the ground or each other while building.
2. The player places foundations and loads freely.
3. "Run solver" at any time. The game shows load on each foundation and marks
   instabilities. The player can keep editing and run again.

Proposed score, shown after each run:

```
score = (load carried in kN / metres of member used) x 10  -  20 x instabilities
```

Load carried is the total applied load that reaches foundations through the
stable part. Dividing by material is what stops the score from rewarding
simply piling on load (see 2.1).

### 4.2 Multiplayer

Four players, hot seat or networked, building **one shared structure**.

- **Round 1:** each player in turn places one foundation on the ground. No
  two foundations on the same point.
- **Every later round:** each player in turn places **one member and sets
  its two end connections** (rigid or pinned at each end). This reads the
  brief's "1 member and 2 connections" as one member with a connection at
  each end; the count can change later.
- The member must have at least one end on an existing node or foundation,
  so the structure stays one object rather than four.
- Loads are not placed by players. The scenario defines them: one or more
  loads at fixed points in space, visible from the start.
- A solve runs after every turn, so each player sees what their move did.

Score at the end of each round, added up over the game:

```
round score = 100 x (your foundation's share of the total load)  -  10 x (your instabilities)
```

"Your instabilities" are unstable nodes that touch a member you placed.

The game ends after a fixed number of rounds (proposed: 8, so 28 members).

Why a shared structure: with four separate structures the players never
affect each other and the mode is four Creative games side by side. On one
structure, every member changes everyone's share, and a careless pin can
leave an instability at a rival's door.

### 4.3 Forensics

A puzzle. The level is a finished structure that has instabilities.

1. The game shows the structure and runs the solver. Instabilities are
   marked and counted.
2. Each turn the player makes one fix: add a member, change a connection, or
   change a support. Removing members is not a fix.
3. The solver runs after each fix and the count updates.
4. The level is solved when the count reaches zero.

Score: fixes used against the level's par (the fewest fixes known to work).
Levels need authoring, and each needs its par verified with the solver.

### 4.4 Load in space

A goal puzzle. This is the "goal-based" mode in the project README.

1. The level gives one foundation on the ground and one load at a point in
   space, not attached to anything.
2. The player builds members and sets connections to carry that load to the
   foundation.
3. "Run solver" at any time.
4. The level is complete when the structure is stable and the whole load
   arrives at the foundation.

Score: metres of member used against the level's par. Later levels can add
several loads, obstacles, a limited supply of pieces, or a second foundation.

## 5. Game state the modes need

On top of the structural model in the shared contract:

- mode and its settings (the table in section 3);
- players, turn order, current player, round number;
- owner of each foundation, member and load;
- actions left this turn;
- connection type per member end (see open question 3);
- the last solve result and the score history;
- for levels: the starting model, fixed pieces that cannot be edited, the
  goal, and par.

The store on main holds only the structural model and a reset action. The
shared model core on this branch (`prototypes/game-environment/shared/`)
records an owner per piece and a turn counter, as a placeholder.

## 6. How this lines up with existing work

- **Voxel-struct prototype** has levels (towers, bridges, sandbox), a limited
  supply of pieces, cost against a budget, and pass/fail objectives. Its
  sandbox is close to Creative; its tower and bridge levels are close to Load
  in space with engineering design checks added. It has no turns or players.
  Whether its rules carry over is recorded as undecided in its README.
- **Environment prototypes** on this branch: Kit is built around turns and a
  hand of pieces (Multiplayer); Grow, Levels and Blocks suit the
  single-player modes.

## 7. Open questions

Each has a proposed answer above. These are the ones worth settling first.

1. **Multiplayer: one shared structure or four separate ones?** Proposed:
   shared.
2. **How is an instability counted?** Proposed: freely-moving nodes now,
   independent mechanisms later.
3. **Is a connection set per member end or per node?** The multiplayer rule
   ("1 member, 2 connections") and the voxel-struct solver point to per
   member end. The environment prototypes currently set it per node.
4. **Where do multiplayer loads come from?** Proposed: the scenario. Letting
   players place loads would be a different, more aggressive game.
5. **When does a multiplayer game end, and is score summed per round or read
   once at the end?** Proposed: 8 rounds, summed per round.
6. **Does "load on a foundation" mean vertical force only?** Proposed: yes,
   downward only. Uplift, shear and moment could later be penalties, using
   foundation capacities like those in the voxel-struct prototype.
7. **Do member strength checks belong in these modes?** The voxel-struct
   prototype checks strength, buckling and deflection. This draft scores only
   load and instability, as the brief describes.
