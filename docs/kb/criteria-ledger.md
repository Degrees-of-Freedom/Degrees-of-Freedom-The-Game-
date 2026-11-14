---
title: "Game criteria implementation and acceptance ledger"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - docs/kb/release-acceptance-criteria.md
  - "Read-only audits of cdd5c9a and independent integrated checks recorded below"
status: partial
---

# Criteria ledger

The three domain audits used local commit `cdd5c9a`, also the tip of main and the criteria branch. The implementation branch is `codex/criteria-implementation`. This ledger tracks the normal game, service or renderer entry point specified in each row. An isolated helper passing its tests does not establish game integration. Section numbers identify the acceptance cases in the linked specifications.

## Rules decisions for this run

The owner approved a scored two-player, eight-round preset. Score signed verified upward reactions against all persistent gravity-card loads with self-weight off for that scored load state. Zero gravity awards zero attraction. Compare full-precision adjusted scores with joint winners within 0.01 points. The first connector establishes the joint law. Incompatible incoming cards remain in hand. Hand identities, counts and discard details are private, including on resume. The owner authorized a versioned candidate physical catalogue for review and testing. Unvalidated families are excluded from scored play. Candidate numerical values have playtest status.

## Structural model and numerical verification

Source and acceptance references are [solver](solver-criteria.md) §§2–7, [card-definition](card-definition-criteria.md) §§2–6, [visualization](visualization-criteria.md) LP01–LP08 and [release-acceptance](release-acceptance-criteria.md) §§2,3,6. M and A IDs are the original solver identifiers. The numerical criteria are proposed in the KB and explicitly requested for validation in this run.

| ID | Authority | Status | Observed behavior and owning module | Acceptance evidence or next check |
| --- | --- | --- | --- | --- |
| M01 | confirmed model | partially meets | voxel.ts and frameSolve.ts track six potential nodal DOFs. OpenSees stability.py detects null modes. | Distinguish unloaded translational mechanism from inactive pin rotations. |
| M02 | confirmed | meets | game/turnAnalysis.ts maps unattached coincident ends to separate analytical node keys. | turnAnalysis.test.ts compares coincident unattached member with supported column. |
| M03 | requested numerical | partially meets | frameElement.ts, frameMath.ts, engine.py model 3D frame/truss responses. Cable kernel has a fixed pretension assumption. | Axial/torsion fixtures pass. Test authored braces and noncompressive cables under load reversals. |
| M04 | confirmed / G13 | partially meets | structural-state.ts stores six free/locked/elastic laws. Active turn connectors offer fixed/ball only. | Rotated hinge and unequal elastic springs at one joint must retain separate forces. |
| M05 | proposed numerical | partially meets | engine.py uses equalDOF for pinned translations and artificial stiffness for unloaded spin modes. | Identify redundant/incompatible constraints and exclude numerical restraints from reaction awards. |
| M06 | confirmed / G16 | partially meets | voxel.ts and restraints.test.ts exercise default six locks and configurable masks. No distinct neutral support in turns. | Trace all six signed components to player or neutral foundation. |
| M07 | confirmed gravity / requested numerical | partially meets | turnAnalysis.test.ts verifies persistent gravity-card increment. Applied analysis currently adds member self-weight. | Compare scoring load policy to explicit gravity-only reference, count each load once. |
| M08 | proposed definitions / requested physics | partially meets | structural-state.ts has SI properties, rest length and initial strain. engine.py uses one steel section and frameSolve uses constant initial tension. | Resolve printed quantities into each live analysis and inspect provenance. |
| M09 | confirmed / G06–G07 | partially meets | Member ends, loads and foundations have identities. Turn model has no original-parent station identity. | Quarter/cancel/reload and physical transfer for every family. See family rows. |
| A01 | requested numerical | partially meets | OpenSees test_engine.py covers bars, rotated cantilever, torsion, simple and propped beams. | Linear analytic errors ≤0.1%, explicit absolute scales near zero. Check released joints and reaction splits. |
| A02 | requested numerical | missing | engine.py uses Linear geometry. frameStability.ts estimates elastic instability. Cable active set is first order. | Imperfect column mesh convergence, second-order sway, pretension and large cable deflection. |
| A03 | requested numerical | partially meets | stability.py identifies linear translational and rotational modes. voxel.ts groups singularity and excessive displacement. | Classify disconnected, unused, unloaded, incipient and strength cases independently. |
| A04 | requested numerical | partially meets | stability.py scales constrained linear stiffness. No stress-dependent nonlinear tangent in game. | Localize modes and verify cable activation and prestress dependence. |
| A05 | requested numerical | partially meets | frameSolve.ts bounds cable iteration. No adaptive nonlinear recovery. | Verify recovery and bounded unresolved outcomes on difficult states. |
| A06 | requested numerical / G14 | partially meets | voxel.ts pools standing components. A double-ball column currently suppresses the independent fixed column. | Dedicated component_isolation. Compare stable response alone, beside floating member and beside supported mechanism. |
| A07 | requested numerical / G14 | partially meets | test_engine.py includes force/moment balance. No per-component runtime acceptance gate in voxel.ts. | Verify force, moment, compatibility and supported constitutive laws before scoring each component. |
| A08 | requested numerical | partially meets | Schema rejects nonfinite data and adapter supports abort. Extreme input and active-state bounds lack stress evidence. | Run invalid and legal seeded states, check finite reported fields and absence of false valid outputs. |
| CAP | requested numerical / G10 | partially meets | voxelDesignChecks.ts checks design combinations only. Turn analysis lacks validated member or connector capacities. | Run overload and remote redistribution fixtures under reviewed catalogue. |
| BENCH-10K | explicit acceptance | unverified | No maintained 10,000-state structural benchmark at baseline. | Seed, run and retain failure counts separately from turn lifecycle stress. |
| SURROGATE | deferred proposal | unverified | No learned surrogate on the active solver path. | Optional preview only. No reference validation credit. |

## Cards, placement, match and recovery

Sources and executable scenarios are [turn](turn-criteria.md) §§1–8, [placement](placement-criteria.md) §§2–7, [card-definition](card-definition-criteria.md) §§2–6, [failure-repair](failure-repair-criteria.md) §§2–7, [scoring-match](scoring-match-criteria.md) §§2–5, [multiplayer](multiplayer-criteria.md) §§2–5 and [saved-match](saved-match-criteria.md) §§2–6. G identifiers refer to [game-completion](game-completion-criteria.md) §2. Branch implementations and independent checks belong in the checkpoint record below.

| ID | Authority | Status | Observed behavior and owning module | Acceptance evidence or next check |
| --- | --- | --- | --- | --- |
| T-DECK | confirmed | meets | turns.createDecks separates element/load from connection cards. | Seeded turn tests check separate ownership. |
| T-DRAW | confirmed | meets | turns.draw draws two from each at setup and turn advance. | Seed 23, all 16 turns including passes. |
| T-PLAY | confirmed | meets | turns.ts stages one member, one load and two external connectors independently. | turns.test.ts exercises independent budgets. |
| T-PASS | confirmed | meets | endTurn accepts an empty draft. | 16 passes, equal turns, no post-match draw. |
| T-CANCEL | confirmed | meets | Draft rollback restores reservations. | Cancel with same hand IDs and no new draw. |
| T-SHARED | confirmed | meets | stageLoad and stageConnection allow other players’ structural targets. | turnAnalysis.test.ts checks load on opposing foundation. |
| T-IMMUTABLE | confirmed | meets | stageConnection rejects occupied member ends. | Repeat attachment to an end after commit. |
| T-FOUND | confirmed | meets | Setup creates each fixed foundation and column. No player foundation card. | Inspect both ground masks independent of end law. |
| T-GRAVITY | confirmed | meets | Placed card loads persist on committed joints. | Compare staged/committed and replayed load IDs and downward force. |
| G01 | confirmed | partially meets | No per-turn attraction accrual. Final award absent. | Award attraction exactly once after final pass. |
| G02 | confirmed | meets | Eight completed two-player rounds end the current preset. | Seed 23 stops after 16 reports with no available hand. |
| G03 | confirmed | missing | TurnPlayer.score stays zero in a loaded finished match. | 60% share minus two historical penalties gives 58. Save and recover same winners. |
| G04-PUBLIC | confirmed | missing | Workspace Model drawer serializes the full turn, including both hands and future draws. | Dedicated private_projection. Inspect ordinary drawer throughout handoffs. |
| G04-HANDOFF | confirmed | partially meets | Two independent reveal toggles. Workspace Enter can pass before readiness. | Fresh Ready after switch, resume and hidden tab. Held Enter must not advance. |
| G05 | confirmed | partially meets | stageElement checks grid bounds and per-axis steps. Card length convention ambiguous for diagonals. | Test exact printed reach, invalid nonfinite and too-long diagonal, preserve cards on rejection. |
| G06 | confirmed | missing | turnPicking and turn model only accept endpoints and integer coordinates. | Original diagonal ¼, ½, ¾ selectable on repeated reload. Reject recursive fractions. |
| G08 | confirmed | partially meets | No force transfer without attachment. Seed 0 coplanar crossing at (2,2,1) is accepted. | Exact intersecting positive control, depth-separated crossing negative control, fitting envelopes. |
| G09 | confirmed | missing | TurnCard represents a single flat member. No parent assembly with individually attached external ends. | One element, independently spend 0–2 connectors, replay stable internal IDs. |
| G13-JOINT | confirmed | missing | Seed 0 permits ball connector into fixed setup joint. Joint lacks stored law. | First connector establishes law. Reject incompatible committed and staged incoming profiles, keep card, preserve legacy bytes. |
| ISSUE-COMPARE | confirmed | missing | assessTurn returns one status. No compatible before/after evidence, comparable lineage or worsening policy. | Test affected opponents, new, persistent, worsened, resolved and unknown under same policy. |
| ISSUE-PENALTY | confirmed | missing | TurnReport.penalty is literal zero. | Exactly one event for multiple verified eligible changes, none for previews, repeats or unknowns. |
| G10-INSTABILITY | confirmed | missing | endTurn retains player geometry without generating physical repair objects. | Verify permanent local correction under player and system capacities, pre/post analyses. |
| G10-OVERLOAD | confirmed | missing | No committed capacity correction under applied card loads. | Relieve overload without deleting load or changing printed section. Reject harmful candidate. |
| G11 | confirmed | missing | TurnPanel has no verified correction, pending or failed correction report. | Persist actual outcome and keep the structure playable in all cases. |
| G12 | confirmed | missing | No historical penalty ledger. | After repair/retry/reload originating penalty survives exactly once. |
| G14 | confirmed | missing | No final verified-component award implementation. | W=100, verified 30/20, unknown 50 yields 30/20 and partial evidence. Unknown reactions absent. |
| G15 | confirmed | missing | No active companion or recorded repair presentation. | Read exact object/cause/repair and verification with avatar on, off, reduced or muted. |
| G16-PERM | confirmed | missing | No permanent neutral system objects on board. | Keep neutral ID and physical influence after reinforcement and reload. |
| G16-SHARE | confirmed | missing | No neutral support owner or reaction share. | With 50 verified neutral distinguish from missing 50. Denominator remains 100. |
| G17 | confirmed | missing | No local correction candidates or whole-board verification after intervention. | Only incident interfaces change directly. Inspect global redistribution and failed local attempt. |
| SAVE-REPLAY | requested | partially meets | session.ts replays seed/actions for current preset. Missing policy, result and repair provenance. | Compare every model, hand, report and final award at checkpoints. |
| SAVE-CONFLICT | requested | missing | writeSession overwrites newer valid envelope. Auditor observed head 3 → stale head 2. | Two writers restoring/staging/advancing must retain newer head and surface conflict. |
| SAVE-FAULT | requested | partially meets | Single-key writes and validation preserve corrupt/unknown inputs. No last-good recovery choice. | Quota, invalid/truncated, future, interrupted and oversized saves. |
| SAVE-EXPORT | requested | missing | Match model I/O disabled. Debug export contains private decks. | Separate public summary and explicit private recovery round-trip. |
| G07-FRAME | confirmed | missing | turnAnalysis lacks frame interior stations. | Select all three original stations in viewer and demonstrate continuity, force transfer and unchanged mass. |
| G07-CABLE | confirmed | missing | turnAnalysis lacks cable interior stations. | Select all three original stations in viewer and demonstrate axial reference strain/rest length and tension-only equilibrium. |
| G07-SPRING | confirmed | missing | turnAnalysis lacks spring interior stations. | Select all three original stations in viewer and demonstrate validated multiport constitutive law. |
| G07-PLANAR | confirmed | missing | turnAnalysis lacks planar interior stations. | Select all three original stations in viewer and demonstrate ports on physical chord/panel interfaces. |
| G07-TRICHORD | confirmed | missing | turnAnalysis lacks trichord interior stations. | Select all three original stations in viewer and demonstrate actual three-chord attachment stations. |

## Viewer, controls and presentation

Sources and acceptance cases are [element representation](element-representation-criteria.md) §§3–8,10, [joint DOFs](joint-dof-criteria.md) §§3–11, [visualization](visualization-criteria.md) LP01–LP08 and §§3–5, [controls](controls-camera-criteria.md) §§2–6, [animation](animation-criteria.md) §§3–9,14 and [avatar](avatar-criteria.md) §§3–10,12–13. The [capture manifest](../evidence/viewer/README.md) records the fixture, cameras and reachability of each presenter.

| ID | Authority | Status | Behavior | Baseline and owning module | Acceptance case |
| --- | --- | --- | --- | --- | --- |
| GEOM-01 | confirmed | missing | Wide flange | structureMeshes.ts uses a cylinder or solid box. | Web and two distinct flanges, correct roll and open silhouette. |
| GEOM-02 | confirmed | missing | Square/rectangular hollow section | SHS drawn solid. | Visible bore/wall thickness, true vs readable dimensions. |
| GEOM-03 | confirmed | missing | Round hollow section | No CHS section in active catalogue. | Circular opening, thickness, oblique and reversed orientation. |
| GEOM-04 | confirmed | missing | Standalone axial helical spring | No spring member/geometry. | Terminal axis, bounded turns/wire, no implied torsional law. |
| GEOM-05 | confirmed | missing | Planar two-chord truss | No parent assembly in inventory or renderer. | Two coplanar chords, authored webs, real station contacts. |
| GEOM-06 | confirmed | missing | Triangular three-chord truss | No parent assembly in inventory or renderer. | Three non-collinear chords, three braced faces, one selectable card. |
| GEOM-07 | confirmed | missing | Readable and true scale | Rendered width is a theme constant. | Compare known section dimensions in metres and prove analytical inputs unchanged. |
| GEOM-08 | confirmed | partially meets | Cable | Cable has a narrower generic stroke. | Distinguish cable from rod in each theme with no invented deformed sag. |
| GEOM-09 | confirmed | partially meets | Columns use section | Column role affects theme appearance, lacks section-specific geometry. | Vertical and diagonal setup column retain intended section and orientation. |
| JOINT-01 | confirmed | missing | Selected / All / Off, Selected default | SceneView has no joint-visibility preference. | Cycle modes, persist choice and avoid drawing duplicate coincident joints. |
| JOINT-02 | confirmed | missing | Six translation/rotation permissions | DofGlyph.tsx describes a toolbar preset only. | Inspect selected intentional joint, separate ground mask from attached-end laws. |
| JOINT-03 | confirmed | missing | Global and local joint frames | No physical joint-frame view. | Orbit camera around rotated single-axis permissions and verify axis labels. |
| JOINT-04 | confirmed | missing | Separate instability layer | No dedicated joint instability view. | Solver-sourced mode, scale and provenance distinct from connector freedom. |
| JOINT-05 | confirmed | missing | Brief optional demonstration | No joint overlay. | One selection cycle, reduced motion, no change to geometry or game state. |
| VIS-01 | confirmed | partially meets | Simultaneous calculated deflected shape | sceneResults.ts reads end translations. Hidden auto scale, no ghost or intermediate response. | All persistent loads, display scale, reference and valid component scope. |
| VIS-02 | confirmed | missing | Displacement magnitude contour | structureMeshes.ts colors utilization or paths only. | Blue-to-red magnitude legend with units and actual numerical range. |
| VIS-03 | requested | partially meets | Signed local member inspection | AnalysisPanel shows absolute endpoint maxima. | Inspect signed local axial, both shear and bending components and torsion with units. |
| VIS-04 | requested | missing | Shear diagram | No recovered station series. | Check signed stations against analytical beam including distributed load or mark quantity unavailable. |
| VIS-05 | requested | missing | Moment diagram | No recovered station series. | Simply supported and cantilever expected shape, units and discontinuities. |
| VIS-06 | confirmed / LP06 | partially meets | Per-object valid quantities | Global mechanism flag hides valid responses. A06 prerequisite. | Check partial scope, no shape/reaction for unverified part. |
| VIS-07 | requested / LP04,08 | partially meets | Illustrative load paths | computeLoadPath traces approximate graph routes and particles. | Explicit illustrative provenance, no false attribution or fabricated branches. |
| VIS-08 | confirmed | partially meets | Player loads act simultaneously | AnalysisPanel still shows Load case even for single applied state. | Open Shared table results without choosing a load case. |
| CTL-01 | requested | partially meets | Keyboard/touch staging | TurnPanel form supports endpoints only. | Play same turn including quarter selection with each input method. |
| CTL-02 | requested | partially meets | Ambiguous target choice | growthStack cycles grid candidates. turnPicking only chooses ends. | Cycle coincident/occluded interfaces without cross-connecting. |
| CTL-03 | requested | partially meets | Camera views and focus | Scene supports Fit and orbit. Kit automatically swings at handoff. | Explicit Reset/top/front/side. Handoff and safe focus preserve board state. |
| CTL-04 | requested | partially meets | Interruption | sceneInteraction handles pointercancel, lacks lost capture/blur handling. | Lose pointer mid-drag, resume with no placement or camera jump. |
| CTL-05 | proposed parity | partially meets | Five environments | Only Grow Dusk routed. Other four presenters retained on store. | Exercise existing presenters and preserve baseline appearance. |
| CTL-06 | requested evidence | unverified | Accessibility and device matrix | Desktop Chrome only at audit. | Full keyboard, touchscreen and screen reader plus orientation/resize and error feedback. |
| AN-01 | confirmed | partially meets | Master mute | useEditorSound has a local switch independent of saved menu sound. | Mute stops present/future voices, persists and applies after navigation. |
| AN-02 | confirmed | partially meets | Reduced motion, skip and optional glow | Menu preference present. Scene water/particles and Kit auto-camera persist. | Skip without double consequences. Reduced motion and glow-off leave static cues. |
| AN-03 | confirmed | partially meets | Routine action feedback | Some editor changes trigger sound. No complete game event coverage. | Animation §3 action table, held input, bounded queues and private reveal. |
| AN-04 | confirmed | missing | Rare serious events | No credible source of final victory, lead or repair feedback. | Use actual committed evidence, skip/mute work identically. |
| AV-01 | confirmed | missing | Compact companion across routes | Only unapplied GLBs/patch in prototypes/timburr-companion. | Inspect candidate assets, compact desktop/touch layout, keyboard and WebGL fallback. |
| AV-02 | confirmed | missing | Companion activation, mute and hide | No active component or settings. | Static fallback, user controls, safe focus and public-only reactions. |
| AV-03 | proposed | needs owner decision | Automatic Conkeldurr reaction | Candidate model unapproved, lacks serious event threshold. | Preview candidate. Require compatible serious-event source and approved transformation. |

## Acceptance checkpoints

Baseline `cdd5c9a` on Windows x64, Node 24.15.0, Chrome 157.0.8103.51 with SwiftShader, Python 3.12.16. TypeScript passed after restoring declared npm dependencies. Vitest passed 136 with 2 live-service checks skipped. OpenSees passed 42 tests including analytical and HTTP fixtures. Its Starlette test client emitted one dependency deprecation warning. The read-only turn audit replayed 625 matches with seeds 0–624 and 10,000 total turns with 3,180 staged loads. No card conservation or final-round violations were observed. This run exercised turn rules only.

[Whole-game matrix](release-acceptance-criteria.md) §§2–6 remains open at baseline. Setup, draw and partial staging work on the two-seat preset. Legality fails crossing and common-joint fixtures. Analysis fails the independent supported mechanism fixture. Handoff and recovery fail on public drawer exposure and stale saves. Final award, repair, 10,000 numerical states, assisted-input workflows and performance acceptance lack passing evidence. The [initial photos](../evidence/viewer/README.md) cover the desktop portal fixture in each presenter.
