# Game-environment prototype

The standalone prototype of the game environment: what the player sees and
touches while building a structure. It is a design reference, not the game.
The team's app in `apps/web` has its own adaptation of it.

Only Grow Dusk is kept here. Four earlier alternatives (Grow, Levels, Blocks
and Kit) were removed once Grow Dusk was chosen; they remain in the git
history of this branch.

## Open it

Open `../game-interface/index.html` for the home page and menus, or
`grow-dusk/index.html` directly, in a current Chrome or Edge. No install and
no build step. An internet connection is needed the first time, because
three.js loads from a CDN.

## What it does

[Grow Dusk](grow-dusk/) gives the player three tools: connections (the
degrees of freedom at a node), member geometry (where members connect and how
long they are) and loads (where, which way, how much). Click a joint and the
points it can reach bloom around it; click one to place a member. Material
and section are predetermined and are not offered as a choice. Its own
`README.md` lists controls and known gaps.

The look takes its cues from Townscaper (one-click building with a ghost
preview, a small calm diorama, pieces that detail themselves from context).
The palette, shapes and interface are original to this project.

## What is real and what is not

- **Real:** the model the player builds, the draft solver input exported from
  it, the size measures (member count, total length, total load), and the
  check for pieces with no path of members to a support.
- **Not real:** the "feedback preview". No solver is connected. Its numbers
  come from a toy rule in `shared/model-core.js` (`mockResults`) so the
  prototype can rehearse how feedback might look. It is labelled as demo data
  on screen.
- **Placeholder:** everything about turns. The core only counts turns and
  records who placed what. The confirmed turn rules live in the team's app,
  not here.

## The shared model

`shared/model-core.js` is the model Grow Dusk edits. It is a plain
script with no dependencies, loaded with a `<script>` tag, and it exposes
`DOFCore.createModel()`. Its header documents the API and the rules below.

Open `shared/model-core.test.html` in a browser to run its checks.

### Modelling rules it applies (assumptions, all open to change)

- Coordinates are integer lattice indices `[i, j, k]` with k up (+Z). World
  position is index times spacing; spacing is 1 m.
- A member is a straight piece between two lattice points, of any length.
- Members that touch at a lattice point are joined there. A node exists where
  a member ends, where two or more members share a lattice point, where a
  load sits, or where the player placed a connection.
- A member is connected to every node lying on it. For analysis it is split
  into elements at those nodes and is continuous through them.
- Members that only cross between lattice points are not joined.
- A node's support is six booleans in the order `Tx Ty Tz Rx Ry Rz`, true
  meaning restrained. New nodes on the ground level get a pinned support.
- A node's joint is `rigid` or `pinned`. `pinned` releases both bending
  rotations of every member end at that node; members running through the
  node stay continuous. Torsion is never released.
- Loads are point forces on nodes: a direction and a magnitude in kN.

## Draft solver input

`core.toSolverInput()` returns the document below (shortened). It is a
proposal from the environment side so the solver work has something concrete
to react to. It has not been agreed with anyone.

```json
{
  "schema": "dof-game/solver-input@0-draft",
  "units": { "length": "m", "force": "kN", "moment": "kN*m" },
  "axes": { "up": "+Z", "gravity": "-Z", "handedness": "right" },
  "dofOrder": ["Tx", "Ty", "Tz", "Rx", "Ry", "Rz"],
  "releaseOrder": ["Fx", "Fy", "Fz", "Mx", "My", "Mz"],
  "grid": { "spacing": 1, "bounds": { "i": [0, 8], "j": [0, 8], "k": [0, 6] } },
  "section": { "id": "default" },
  "nodes": [
    { "id": "n1", "grid": [3, 4, 0], "position": [3, 4, 0],
      "restraint": [true, true, true, true, true, true], "support": "fixed", "joint": "rigid" },
    { "id": "n4", "grid": [6, 4, 3], "position": [6, 4, 3],
      "restraint": [false, false, false, false, false, false], "support": "free", "joint": "pinned" }
  ],
  "members": [
    { "id": "m3", "nodeI": "n2", "nodeJ": "n4", "length": 3, "role": "beam", "elements": ["m3.1", "m3.2"] }
  ],
  "elements": [
    { "id": "m3.1", "member": "m3", "nodeI": "n2", "nodeJ": "n5", "length": 1,
      "releaseI": [false, false, false, false, false, false],
      "releaseJ": [false, false, false, false, false, false] },
    { "id": "m3.2", "member": "m3", "nodeI": "n5", "nodeJ": "n4", "length": 2,
      "releaseI": [false, false, false, false, false, false],
      "releaseJ": [false, false, false, false, true, true] }
  ],
  "loads": [
    { "id": "l1", "node": "n5", "force": [0, 0, -10], "moment": [0, 0, 0], "direction": [0, 0, -1], "magnitude": 10 }
  ]
}
```

- `members` are the pieces the player placed. `elements` are those pieces
  split at every node lying on them. Here the beam `m3` carries a load one
  metre along, so it becomes two elements that are continuous at `n5`.
- `restraint` is per node in `dofOrder`, in global axes.
- `releaseI` and `releaseJ` are per element end in `releaseOrder`, in the
  element's local axes, true meaning released. The local axis convention is
  not defined here; it is the solver's to set.
- `section` is only an id. Section and material values belong to the solver.

### Things the solver work should know about this draft

- **Fully pinned joints leave rotations with no stiffness.** In the example,
  every member end at `n4` is released and the node has no rotational
  restraint, so its three rotations are unrestrained even though the frame
  may be perfectly stable. The solver needs a way to tell that apart from a
  real mechanism, or the export needs to change (for instance by leaving one
  member end unreleased at such a node).
- **Releases are node-level in the game, element-level in the export.** The
  player pins a joint; the export turns that into end releases.
- **No self-weight, distributed loads or applied moments.** Only point forces.
- **Up is +Z** and units are metres and kilonewtons. The knowledge base lists
  coordinate conventions as an open question; these are the prototype's
  assumptions, not an answer.

### Draft results shape

`core.mockResults()` returns placeholder data in the shape the prototype
currently knows how to display:

```json
{
  "schema": "dof-game/solver-results@0-draft",
  "mock": true,
  "stable": null,
  "members": { "m1": { "axial": -5, "utilization": 0.125 } },
  "nodes": { "n2": { "displacement": [0, 0, -0.01333], "grounded": true } }
}
```

## How it was checked

Grow Dusk was driven in a headless browser with real mouse and keyboard
input (placing members, editing connections, placing loads, removing, undo
and redo, the solver-input drawer). It exposes a small `window.__dof`
object for that purpose: the model, the current tool, and `screenOf(i, j, k)`
to find a lattice point on screen. The test scripts are not part of the
repository.

## Knowledge base

The pages under `docs/kb/` were left unchanged on purpose. These are
explorations, not decisions. When a direction is chosen, `3d-viewer.md` and
`architecture.md` are the places to record it.
