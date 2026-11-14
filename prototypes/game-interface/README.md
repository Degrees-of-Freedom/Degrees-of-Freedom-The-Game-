# Game interface prototype

Home page and menu screens for "Degrees of Freedom: The Game". One self-contained file: open `index.html` by double-clicking (no server, no build, no network).

Routes (hash based): `#home`, `#modes`, `#setup/<mode>`, `#how`, `#settings`, `#about`. Esc goes back one screen; browser Back works.

Modes: `creative`, `challenge`, `forensics`, `load-space`, `multiplayer` (Shared table). A mode sets the rules; an environment (`grow-dusk`, `grow`, `levels`, `blocks`, `kit`) sets how building looks. Every setup has an environment picker, preselected to the mode's default.

Start opens `../game-environment/<env>/index.html?mode=<id>` plus `start=empty|example` (creative), `level=<id>` (challenge, forensics, load-space) or `players=2&names=<comma-separated, URI-encoded>` (multiplayer).

Storage: `dof.lastSetup` (last setup per mode, including environment) and `dof.settings` (`sound`, `reducedMotion`, `showHelpOnStart`). The environment prototypes do not read these yet.

This is a design prototype. Mode rules, simulation and results live in the team's main app (`apps/web`); nothing here runs a solver.
