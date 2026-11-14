# Grow · Dusk

Grow's modelling and interface (see `../grow/`) in Kit's "Dusk table" colours
and lighting. Open `index.html` by double-clicking it (Chrome or Edge, online:
three.js 0.170.0 comes from jsDelivr). Building behaviour is unchanged by the
menu layer described below.

## Launch parameters

All optional. With none, the page opens with the example tower exactly as
before. Unknown or invalid values fall back safely (no mode chip, defaults).

| Parameter | Values | Used by |
|---|---|---|
| `mode` | `creative`, `challenge`, `forensics`, `load-space`, `multiplayer` | all |
| `start` | `empty` or `example` | creative (`?empty=1` still works everywhere) |
| `level` | an id: letters, digits, `_`, `-`, `.`, up to 40 characters | challenge, forensics, load-space |
| `players` | 2 to 4 (default 2) | multiplayer |
| `names` | comma-separated, each name URI-encoded, e.g. `Ana,B%C3%A9a` | multiplayer |

Display names: Creative, Engineering challenges, Forensics, Load in space,
Shared table. When `mode` is present the top-left brand area shows the mode
name with a "Prototype preview" tag (tooltip: you are in the standalone
prototype and can build freely; the mode's rules, simulation and results run
in the team's main app). Modes with a level also show "Level: <id>".

Multiplayer creates the model with `players: n`, so the turn chip cycles
through n players, shows the entered names (missing ones become "Player N")
and colours its dot per player: coral, blue, amber-gold, sage. Turns stay
provisional: no cards, action limits or scoring.

Example: `index.html?mode=multiplayer&players=3&names=Ana,Ben,Cy`

## Members between any two grid points

Members can run between any two grid points up to 4 steps apart (the model is
created with `directions: 'any'`). Click a joint and the reachable points
bloom: points on the 26 principal directions (axis and 45 degree lines) stay
slightly more prominent on faint spokes; off-angle points appear only near the
pointer, and the hot target swells with its drop line and ground dot. The
ghost label shows the real length and the target's `[i, j, k]`.

Where several reachable points overlap on screen, the one nearest the camera is
chosen by default. The mouse wheel (over such a stack) or `[` (shallower) and
`]` (deeper) step to the next candidate; the wheel zooms as usual everywhere
else. Roles still come from the core: vertical column, horizontal beam,
inclined brace.

## Menu

The **Menu** button (top right), `Esc` (when nothing else is in progress:
cancelling an armed member, the DOF card, the solver drawer still come first)
or `P` opens a pause overlay that dims and blocks the scene. Focus is trapped
in it and `Esc` resumes.

- **Resume**
- **Restart**: asks, then restores the launch state (undoable).
- **How to play**: closes the menu and opens the help panel.
- **Settings**: Sound, Reduced motion, Show controls at start. Stored in
  `localStorage` key `dof.settings` as
  `{ "sound": true, "reducedMotion": false, "showHelpOnStart": true }`.
  Sound is kept in sync with the top-bar sound button; Reduced motion stops
  CSS animations and the opening camera move.
- **Finish and see summary**: real counts from the model (members, total
  length, total load, supports, pieces not connected to a support, and members
  per player in multiplayer). It states that there is no score: results need a
  simulation, which is not connected in this prototype.
- **Quit to menu**: asks first if the structure changed since launch, then
  goes to `../../game-interface/index.html#modes`.

## Test hooks

`window.__dof` keeps its earlier fields and adds `mode` (id or `null`),
`players`, `playerNames`, `openMenu()`, `closeMenu()` and `menuOpen` (getter).
