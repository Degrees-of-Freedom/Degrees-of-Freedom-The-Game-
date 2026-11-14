# Kit: a board game on a turntable

One of four exploratory game-environment prototypes. Open `index.html` in a current Chrome or Edge (double-click works; it needs a network connection to load three.js 0.170.0 from jsDelivr). Add `?empty=1` to start with an empty board.

## What this option explores

- What turn-based play looks like in the environment: two players, hot seat, building one structure in two colours.
- Whether choosing a stick's length as a piece, before placing it, makes the member-length decision more deliberate than dragging a distance.

Players take pieces from a tray (sticks of 1 to 4 lattice steps, joint tokens, weights) and play them onto a 7 by 7 board, six levels high, standing on a turntable at dusk. Everything the player builds is held by the shared model core (`../shared/model-core.js`); this page only draws it and edits it.

## How to use it

| Input | What it does |
| --- | --- |
| Click a tray piece | Picks it up. `1`, `2`, `3` jump to the first piece of Sticks, Joints, Weights; `Q W E R T Y` pick a piece inside the open group. |
| Stick: click an anchor, then a glowing point | Anchors are joints, lattice points along sticks and board points. Only points exactly that many steps away glow; the ghost stick swings to the nearest one and shows its length in metres. Blocked points are dark and the ghost turns red. |
| Inspect (first joint token): click a joint | Opens the DOF card: six toggles (Tx Ty Tz Rx Ry Rz), support presets, rigid hub or pin. Clicking the selected joint again steps its base (on the board) or switches hub and pin (above it). Clicking a lattice point along a stick places a joint there. |
| Rigid hub, Pin, Pinned base, Fixed base, Roller tokens: click a joint | Applies that type directly. Hub and pin also work on a point along a stick; bases also work on a bare board point. Bases are refused above the board (use Inspect there). |
| Weight: click a joint or a point along a stick | Places the chosen amount (5, 10, 20, 50 kN) in the chosen direction. The six-way selector follows the camera; `F` steps it. Click a placed weight or its tag to change amount or direction, or take it back. |
| Right-click | Takes back the piece under the cursor: a stick, a weight, or a joint token (the joint returns to its plain default). Cancels an armed stick. |
| `X` or the Take back token | Take-back mode: the left button removes instead. |
| Drag, `A` / `D` | Spin the turntable (45 degree steps with the keys). |
| Wheel, `V` | Zoom; switch between the low and the high view. |
| `Enter` or End turn | Ends the turn: the banner changes colour and the turntable swings half a turn. |
| `Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z` | Undo, redo (undo also returns the action). |
| `Esc`, `H` or `?`, `M` | Cancel; show or hide the controls; mute. |
| Clear, Load example | Empty the board; cycle through three examples (game in progress, portal frame, braced tower). |
| Solver input | Drawer with the live draft solver-input JSON, Copy and Download. |
| Feedback preview | Tints sticks with placeholder numbers and shows a legend. |

## What is provisional or demo data

- **Turn rules are placeholders.** Two players, three actions per turn, one action for a stick, a connection change, or placing or changing a weight; taking a piece back is free; no scoring. None of this is decided by the team. The banner says so ("Placeholder rules"), and the Sandbox switch turns the limit off.
- **Feedback preview is demo data.** The colours come from `core.mockResults()`, a toy rule in the shared core. No solver is connected and nothing here is a structural analysis. The screen says "Demo data - no solver connected" while it is on.
- **"Not connected to a support"** (grey, translucent, gently bobbing) is a plain graph fact from `core.connectivity()`. It says nothing about stability.
- The solver-input document is the shared core's draft format, not an agreed contract. Units (m, kN) are the core's assumptions.
- The player strips show real counts only (sticks placed, metres used).

## Known gaps

- Picking is by distance on screen and ignores what is in front: a point behind a stick can be picked. The ghost always shows which point will be used.
- While a stick is armed, every click goes to the nearest glowing point; to anchor elsewhere, cancel first (`Esc`, right-click, or click the anchor again).
- A plain joint cannot be removed on its own; it leaves when its sticks do. Right-clicking it only says so.
- The joint in 3D shows preset supports and one generic "custom" base; which single DOFs are locked is only readable on the DOF card.
- A weight's arrow can overlap a stick that runs the same way from the same joint.
- Undo stops at the state the page opened with. Sandbox mode and the selected tray piece are not part of undo.
- The core's own `tower` example does not fit this 7 by 7 board (it throws); "Braced tower" here is the same shape built one step over.
- No touch support; the offline and no-WebGL messages were not exercised in the automated run.
- Tested only in headless Edge with software rendering, with up to about twenty sticks on screen.

## Strengths and weaknesses as a way to play

Strengths: the turn is visible and physical (pips, a tray in the player's colour, the half-turn hand-off); a stick's length is a choice made before placing, and the glowing points make the reachable set clear; joint tokens make a connection change a one-click move while the DOF card keeps the six degrees of freedom in view.

Weaknesses: placing a stick takes more clicks than a drag (piece, anchor, end); glowing points in the air are hard to read for depth, even with the drop line; the tray is wide and the dark interface takes more of the screen than a tool-free view would; the action budget and free take-back are guesses and shape how it feels more than anything else here.
