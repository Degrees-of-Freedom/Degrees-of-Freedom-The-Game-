# Grow

One of four alternative game-environment prototypes. Open `index.html` by
double-clicking it (Chrome or Edge, online: three.js 0.170.0 comes from
jsDelivr). Add `?empty=1` to start with an empty quay.

## What this option explores

Free joint-to-joint building in full 3D with nothing but hover, bloom and
click. Click a point and every point a member could reach from it blooms
around it; click one and the member pops in, and the far end is already the
next start. There are no working planes and no modes; the camera orbits
freely.

The question: can that be made quick and unambiguous?

## Controls

| Action | How |
|---|---|
| Choose a tool | `1` Member, `2` Connection, `3` Load, or the dock |
| Start a member | Click a joint, a lattice point on a member, or a dot on the quay |
| Place a member | Click a blooming point. The far end becomes the next start |
| Place in one gesture | Drag from a start point and release on a blooming point |
| Let go of the start | `Esc`, right-click, click empty space, or click the start again |
| Open a joint's degrees of freedom | Connection tool, click the joint |
| Step a joint's type | Click the selected joint again (support on the quay level, rigid/pinned above) |
| Add a joint part-way along a member | Connection tool, click a lattice point on the member |
| Put a joint back to its default | Connection tool, right-click it |
| Place a load | Load tool, pick direction and amount on the pad, click a joint or a point on a member |
| Edit a load | Load tool, click the load, then use the pad. Wheel over it steps the amount |
| Remove a member or load | Right-click it, Alt+click it, or point at it and press `Delete` |
| Orbit | Drag empty space, or right-drag anywhere |
| Pan / zoom / re-frame | Shift+drag or middle-drag / wheel / `F` or double-click empty space |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z` |
| Help | `H` or `?` |

## How things draw themselves

- Members are coloured by role: column (vertical) coral, beam (horizontal)
  mustard, brace (inclined) teal. Bloom points and the ghost use the same
  colours, so the role is visible before placing.
- A bloom point that already holds a joint is a ring instead of a bead.
- The hub shows the joint: a smooth ball is rigid, a ring with a pin is
  pinned. What stands under it shows the support: nothing (free), a pad on
  balls (roller), a cone on a pad (pinned), a plinth (fixed), a hexagonal post
  (custom mix of restraints).
- Lattice level 0 sits 0.28 m above the deck so supports have room. A joint on
  level 0 with no support visibly hovers.
- A downward load hangs as a weight when nothing is below the joint, sits on
  top when a column is below; other loads are arrows that keep clear of
  members on their own line.
- Pieces with no path of members to a support are pale, dashed and drift up
  and down. This is a graph fact from the model, not an analysis result.

## Provisional and demo data

- No structural solver is connected. "Feedback preview" tints members with
  `core.mockResults()`, placeholder numbers from a toy rule, and shows "Demo
  data - no solver connected" while it is on.
- The turn chip only counts turns through `core.endTurn()`. Turn rules,
  scoring and units are not decided.
- The solver-input drawer shows `core.toSolverInput()`, a draft format.

## Known gaps

- No touch support beyond what OrbitControls gives for orbiting.
- Right-click on a joint in the Member or Load tool does nothing; joints only
  disappear when their members do.
- While a start point is held, right-click only lets go of it; it does not
  remove the piece under the pointer.
- Bloom points that overlap on screen are resolved by nearness to the camera;
  the player has to orbit to reach the hidden one. There is no depth cycling.
- The DOF card can cover nearby lattice points; close it (`Esc`) to reach them.
- Load labels that overlap on screen are hidden rather than moved.
- "Load example" always loads the tower; the core's portal example has no button.
- The sky is only visible from low camera angles.
- Wheel zoom is eased by this file rather than by OrbitControls, and a small
  capture-phase layer in front of OrbitControls separates clicks from drags.
  It reads two private fields of OrbitControls r170 (`_rotateStart`,
  `_panStart`).
- Tested only in headless Edge with software WebGL at 1440x900 and 1280x720.

## Strengths and weaknesses as a way to play

Strengths: any member the rules allow is two clicks away, chains of members
need one click each, and the bloom shows the whole rule set (26 directions, up
to 4 steps, no overlaps) without a word of text. The role colours make the
result legible.

Weaknesses: with up to about a hundred bloom points, picking a point in depth
still depends on a good camera angle, so there is more orbiting than in a
plane-based option. Most of the quay is covered by start points, so orbiting
by left-drag has to begin on water or sky (right-drag works anywhere). Nothing
here says anything about turns; it is a modelling toy first.
