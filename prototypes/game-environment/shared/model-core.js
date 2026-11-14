/*!
 * Degrees of Freedom: The Game - game-environment prototypes
 * Shared model core (DRAFT, exploratory).
 *
 * What this is
 *   The single source of truth that every environment prototype edits and
 *   exports. It holds what the player builds (members, connections, loads) on
 *   an integer lattice and turns it into a solver-input document.
 *
 * Why a classic script
 *   It is loaded with a plain <script src> tag and exposes `window.DOFCore`,
 *   so the prototypes run by double-clicking index.html. Browsers block ES
 *   module imports of local files on file:// pages; classic scripts are fine.
 *
 * Status
 *   Nothing here is an agreed contract. The solver-input and results shapes
 *   are proposals from the environment side, there to give the solver work
 *   something concrete to react to.
 *
 * Modelling rules (assumptions, all open to change)
 *   - Coordinates are integer lattice indices [i, j, k]; k is up (+Z).
 *     World position = index * spacing (metres).
 *   - A member is a straight piece between two lattice points, any length.
 *   - Members that touch at a lattice point are joined there. A node exists
 *     wherever a member ends, two or more members share a lattice point, a
 *     load is applied, or the player placed a connection explicitly.
 *   - A member is connected to every node that lies on it. For analysis it is
 *     split into elements at those nodes and stays continuous through them.
 *   - Members that merely cross between lattice points are NOT joined.
 *   - A node's joint is 'rigid' or 'pinned'. 'pinned' releases the two bending
 *     rotations of every member END at that node; members running through the
 *     node stay continuous. Torsion is never released.
 *   - A node's support is six booleans in DOF order Tx Ty Tz Rx Ry Rz
 *     (true = restrained). Nodes created on the ground level get a default
 *     support (pinned unless configured otherwise).
 *   - Loads are point forces on nodes: a unit direction and a magnitude (kN).
 *   - Material and section are predetermined and owned by the solver; the
 *     export only references a section id.
 */
(function (global) {
  'use strict';

  /** Order of the six degrees of freedom used for every restraint array. */
  const DOF_ORDER = ['Tx', 'Ty', 'Tz', 'Rx', 'Ry', 'Rz'];

  /** Support presets as restraint flags in DOF_ORDER (true = restrained). */
  const SUPPORT_PRESETS = {
    free: [false, false, false, false, false, false],
    roller: [false, false, true, false, false, false],
    pinned: [true, true, true, false, false, false],
    fixed: [true, true, true, true, true, true]
  };

  /** Order used by cycleSupport(). */
  const SUPPORT_CYCLE = ['pinned', 'fixed', 'roller', 'free'];

  /** Order of element-end release flags, in LOCAL element axes (true = released). */
  const RELEASE_ORDER = ['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'];
  const RELEASE_NONE = [false, false, false, false, false, false];
  /** A pinned end releases both bending moments and keeps torsion. */
  const RELEASE_PINNED = [false, false, false, false, true, true];

  /** The six axis directions a load can point in. */
  const AXIS_DIRECTIONS = [
    { id: '-Z', label: 'down', vector: [0, 0, -1] },
    { id: '+X', label: '+X', vector: [1, 0, 0] },
    { id: '-X', label: '-X', vector: [-1, 0, 0] },
    { id: '+Y', label: '+Y', vector: [0, 1, 0] },
    { id: '-Y', label: '-Y', vector: [0, -1, 0] },
    { id: '+Z', label: 'up', vector: [0, 0, 1] }
  ];

  /** Suggested load magnitudes in kN. */
  const LOAD_STEPS = [5, 10, 20, 50];

  /** The 26 unit lattice steps (axis, face-diagonal and space-diagonal). */
  const DIRECTIONS_26 = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx || dy || dz) DIRECTIONS_26.push([dx, dy, dz]);
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  const keyOf = (i, j, k) => i + ',' + j + ',' + k;
  const keyOfPoint = (p) => keyOf(p[0], p[1], p[2]);
  const parseKey = (key) => key.split(',').map(Number);
  const isPoint = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isInteger);
  const samePoint = (p, q) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  const idNumber = (id) => parseInt(String(id).slice(1), 10);
  const byId = (a, b) => idNumber(a.id) - idNumber(b.id);
  const round = (value, digits) => {
    const f = Math.pow(10, digits);
    return Math.round(value * f) / f;
  };

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

  /**
   * Every lattice point a straight segment passes through, ends included.
   * [0,0,0] -> [0,0,3] gives four points; [0,0,0] -> [1,2,0] gives only two.
   */
  function latticePoints(p, q) {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const g = gcd(gcd(d[0], d[1]), d[2]);
    if (g === 0) return [p.slice()];
    const points = [];
    for (let t = 0; t <= g; t++) {
      points.push([p[0] + (d[0] / g) * t, p[1] + (d[1] / g) * t, p[2] + (d[2] / g) * t]);
    }
    return points;
  }

  function segmentKey(p, q) {
    const a = keyOfPoint(p);
    const b = keyOfPoint(q);
    return a < b ? a + '|' + b : b + '|' + a;
  }

  /** Accepts '-Z' style ids or a vector; returns a unit vector or null. */
  function toUnitVector(direction) {
    let v = direction;
    if (typeof direction === 'string') {
      const axis = AXIS_DIRECTIONS.find((d) => d.id === direction);
      v = axis ? axis.vector : null;
    }
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return null;
    const length = Math.hypot(v[0], v[1], v[2]);
    if (length < 1e-9) return null;
    return v.map((c) => round(c / length, 6) + 0); // "+ 0" turns -0 into 0
  }

  function supportName(restraint) {
    for (const name of Object.keys(SUPPORT_PRESETS)) {
      if (SUPPORT_PRESETS[name].every((flag, d) => flag === restraint[d])) return name;
    }
    return 'custom';
  }

  const fail = (reason) => ({ ok: false, reason });

  // ------------------------------------------------------------ the model

  /**
   * Create an editable model.
   *
   * @param {object} [options]
   * @param {number} [options.spacing=1]  Lattice spacing in metres.
   * @param {{i:number[],j:number[],k:number[]}} [options.bounds]  Inclusive index ranges; k[0] is the ground level.
   * @param {'pinned'|'fixed'|'roller'|null} [options.autoGroundSupport='pinned']  Default support for nodes created on the ground level.
   * @param {'any'|'26'} [options.directions='any']  '26' limits members to axis and 45-degree lattice directions.
   * @param {number|null} [options.maxSteps=null]  Longest member allowed, in lattice steps along its longest axis.
   * @param {number} [options.players=2]  Number of hot-seat players for the provisional turn counter.
   */
  function createModel(options) {
    const opts = Object.assign(
      { spacing: 1, autoGroundSupport: 'pinned', directions: 'any', maxSteps: null, players: 2, maxHistory: 200 },
      options || {}
    );
    const b = (options && options.bounds) || {};
    opts.bounds = { i: (b.i || [0, 8]).slice(), j: (b.j || [0, 8]).slice(), k: (b.k || [0, 6]).slice() };
    const groundLevel = opts.bounds.k[0];

    let state = emptyState();
    let index = new Map(); // lattice key -> node id, derived from state.nodes
    const listeners = [];
    const undoStack = [];
    const redoStack = [];
    let batchDepth = 0;
    let batchBefore = null;

    function emptyState() {
      return { nodes: {}, members: {}, loads: {}, meta: {}, seq: { n: 0, m: 0, l: 0 }, turn: { player: 1, number: 1 } };
    }

    function rebuildIndex() {
      index = new Map();
      for (const id in state.nodes) {
        const n = state.nodes[id];
        index.set(keyOf(n.i, n.j, n.k), id);
      }
    }

    const gridOf = (node) => [node.i, node.j, node.k];
    const position = (p) => [p[0] * opts.spacing, p[1] * opts.spacing, p[2] * opts.spacing];

    function inBounds(p) {
      const bd = opts.bounds;
      return (
        isPoint(p) &&
        p[0] >= bd.i[0] && p[0] <= bd.i[1] &&
        p[1] >= bd.j[0] && p[1] <= bd.j[1] &&
        p[2] >= bd.k[0] && p[2] <= bd.k[1]
      );
    }

    // ------------------------------------------------- history and events

    /** Start of a mutation: remember the state unless a batch already did. */
    function begin() {
      return batchDepth > 0 ? null : JSON.stringify(state);
    }

    /** End of a mutation: tidy derived nodes, then record and announce it. */
    function end(reason, before) {
      normalize();
      if (batchDepth === 0) finish(reason, before, false);
    }

    function finish(reason, before, reset) {
      if (JSON.stringify(state) === before) return false;
      undoStack.push(before);
      if (undoStack.length > opts.maxHistory) undoStack.shift();
      redoStack.length = 0;
      emit(reason, JSON.parse(before), reset);
      return true;
    }

    function emit(reason, previous, reset) {
      const ids = (from, to) => {
        const out = {};
        for (const kind of ['nodes', 'members', 'loads']) {
          out[kind] = Object.keys(to[kind]).filter((id) => !(id in from[kind]));
        }
        return out;
      };
      const change = { reason, reset: !!reset, added: ids(previous, state), removed: ids(state, previous) };
      for (const listener of listeners.slice()) {
        try {
          listener(change, api);
        } catch (error) {
          console.error('DOFCore change listener failed', error);
        }
      }
    }

    /**
     * Keep derived nodes consistent with the members and loads:
     * add a node wherever two or more members share a lattice point, and drop
     * nodes that nothing depends on any more.
     */
    function normalize() {
      rebuildIndex();
      const touches = new Map(); // lattice key -> number of members on that point
      const ends = new Set(); // lattice keys where a member ends
      for (const id in state.members) {
        const m = state.members[id];
        const points = latticePoints(gridOf(state.nodes[m.a]), gridOf(state.nodes[m.b]));
        points.forEach((p, t) => {
          const key = keyOfPoint(p);
          touches.set(key, (touches.get(key) || 0) + 1);
          if (t === 0 || t === points.length - 1) ends.add(key);
        });
      }
      for (const [key, count] of touches) {
        if (count >= 2 && !index.has(key)) createNode(parseKey(key), false);
      }
      const loaded = new Set();
      for (const id in state.loads) loaded.add(state.loads[id].node);
      for (const id of Object.keys(state.nodes)) {
        const n = state.nodes[id];
        const key = keyOf(n.i, n.j, n.k);
        const needed = ends.has(key) || (touches.get(key) || 0) >= 2 || loaded.has(id) || n.explicit;
        if (!needed) {
          delete state.nodes[id];
          index.delete(key);
        }
      }
    }

    function createNode(p, explicit) {
      const id = 'n' + ++state.seq.n;
      const onGround = p[2] === groundLevel && !!opts.autoGroundSupport;
      const preset = onGround ? opts.autoGroundSupport : 'free';
      state.nodes[id] = {
        id,
        i: p[0],
        j: p[1],
        k: p[2],
        restraint: SUPPORT_PRESETS[preset].slice(),
        joint: 'rigid',
        explicit: !!explicit
      };
      index.set(keyOfPoint(p), id);
      return state.nodes[id];
    }

    const nodeAtOrCreate = (p) => {
      const id = index.get(keyOfPoint(p));
      return id ? state.nodes[id] : createNode(p, false);
    };

    // ------------------------------------------------------ public copies

    function publicNode(n) {
      return {
        id: n.id,
        grid: gridOf(n),
        position: position(gridOf(n)),
        restraint: n.restraint.slice(),
        support: supportName(n.restraint),
        joint: n.joint,
        explicit: n.explicit,
        onGround: n.k === groundLevel
      };
    }

    function publicMember(m) {
      const a = gridOf(state.nodes[m.a]);
      const c = gridOf(state.nodes[m.b]);
      const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const vertical = d[0] === 0 && d[1] === 0;
      return {
        id: m.id,
        a: m.a,
        b: m.b,
        from: a,
        to: c,
        fromPosition: position(a),
        toPosition: position(c),
        length: round(Math.hypot(d[0], d[1], d[2]) * opts.spacing, 4),
        steps: Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])),
        /** 'column' is vertical, 'beam' is horizontal, 'brace' is inclined. */
        role: vertical ? 'column' : d[2] === 0 ? 'beam' : 'brace',
        player: m.player
      };
    }

    function publicLoad(l) {
      return {
        id: l.id,
        node: l.node,
        direction: l.direction.slice(),
        magnitude: l.magnitude,
        force: l.direction.map((c) => round(c * l.magnitude, 4) + 0),
        player: l.player
      };
    }

    // ------------------------------------------------------------ members

    function occupiedSegments() {
      const occupied = new Set();
      for (const id in state.members) {
        const m = state.members[id];
        const points = latticePoints(gridOf(state.nodes[m.a]), gridOf(state.nodes[m.b]));
        for (let t = 0; t < points.length - 1; t++) occupied.add(segmentKey(points[t], points[t + 1]));
      }
      return occupied;
    }

    /** Can a member be placed between lattice points p and q? Does not change anything. */
    function checkMember(p, q) {
      if (!isPoint(p) || !isPoint(q)) return fail('invalid-point');
      if (!inBounds(p) || !inBounds(q)) return fail('out-of-bounds');
      if (samePoint(p, q)) return fail('zero-length');
      const points = latticePoints(p, q);
      const unit = [points[1][0] - p[0], points[1][1] - p[1], points[1][2] - p[2]];
      if (opts.directions === '26' && unit.some((c) => Math.abs(c) > 1)) return fail('direction');
      const steps = Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]), Math.abs(q[2] - p[2]));
      if (opts.maxSteps && steps > opts.maxSteps) return fail('too-long');
      const occupied = occupiedSegments();
      for (let t = 0; t < points.length - 1; t++) {
        if (occupied.has(segmentKey(points[t], points[t + 1]))) return fail('overlap');
      }
      const length = round(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * opts.spacing, 4);
      return { ok: true, steps, length };
    }

    /** Place a member between lattice points p and q. Nodes are created as needed. */
    function addMember(p, q) {
      const check = checkMember(p, q);
      if (!check.ok) return check;
      const before = begin();
      rebuildIndex();
      const a = nodeAtOrCreate(p);
      const c = nodeAtOrCreate(q);
      const id = 'm' + ++state.seq.m;
      state.members[id] = { id, a: a.id, b: c.id, player: state.turn.player };
      end('addMember', before);
      return { ok: true, id };
    }

    function removeMember(id) {
      if (!state.members[id]) return fail('no-member');
      const before = begin();
      delete state.members[id];
      end('removeMember', before);
      return { ok: true };
    }

    /**
     * Lattice points a new member could reach from p along the 26 lattice
     * directions, between minSteps and maxSteps long (defaults 1 and 4).
     * Each entry: { point, steps, length, direction, node } where `node` is the
     * id of a node already on that point, or null.
     */
    function reachableFrom(p, limits) {
      const min = (limits && limits.minSteps) || 1;
      const max = (limits && limits.maxSteps) || 4;
      const out = [];
      if (!inBounds(p)) return out;
      rebuildIndex();
      for (const d of DIRECTIONS_26) {
        for (let s = 1; s <= max; s++) {
          const q = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
          if (!inBounds(q)) break;
          if (s < min) continue;
          const check = checkMember(p, q);
          if (!check.ok) continue;
          out.push({ point: q, steps: s, length: check.length, direction: d.slice(), node: index.get(keyOfPoint(q)) || null });
        }
      }
      return out;
    }

    // -------------------------------------------------------- connections

    /**
     * Place a connection point on a lattice point (for example part-way along
     * a member, or on bare ground before any member arrives). The node stays
     * until removeNode() is called.
     */
    function ensureNode(p) {
      if (!inBounds(p)) return fail('out-of-bounds');
      const before = begin();
      rebuildIndex();
      const node = nodeAtOrCreate(p);
      node.explicit = true;
      end('ensureNode', before);
      return { ok: true, id: node.id };
    }

    /** Remove a node together with its loads and every member that ends on it. */
    function removeNode(id) {
      if (!state.nodes[id]) return fail('no-node');
      const before = begin();
      for (const mid of Object.keys(state.members)) {
        const m = state.members[mid];
        if (m.a === id || m.b === id) delete state.members[mid];
      }
      for (const lid of Object.keys(state.loads)) {
        if (state.loads[lid].node === id) delete state.loads[lid];
      }
      state.nodes[id].explicit = false;
      end('removeNode', before);
      return { ok: true };
    }

    /** Set all six restraint flags of a node, in DOF_ORDER (true = restrained). */
    function setRestraint(id, restraint) {
      if (!state.nodes[id]) return fail('no-node');
      if (!Array.isArray(restraint) || restraint.length !== 6) return fail('invalid-restraint');
      const before = begin();
      state.nodes[id].restraint = restraint.map(Boolean);
      end('setRestraint', before);
      return { ok: true };
    }

    /** Apply a support preset: 'free', 'roller', 'pinned' or 'fixed'. */
    function setSupport(id, preset) {
      if (!SUPPORT_PRESETS[preset]) return fail('invalid-preset');
      return setRestraint(id, SUPPORT_PRESETS[preset]);
    }

    /** Step a node's support through pinned -> fixed -> roller -> free. */
    function cycleSupport(id) {
      if (!state.nodes[id]) return fail('no-node');
      const current = SUPPORT_CYCLE.indexOf(supportName(state.nodes[id].restraint));
      const next = SUPPORT_CYCLE[(current + 1) % SUPPORT_CYCLE.length];
      const result = setSupport(id, next);
      return result.ok ? { ok: true, support: next } : result;
    }

    /** Flip one degree of freedom of a node. Accepts an index 0-5 or a name such as 'Rz'. */
    function toggleDof(id, dof) {
      if (!state.nodes[id]) return fail('no-node');
      const d = typeof dof === 'string' ? DOF_ORDER.indexOf(dof) : dof;
      if (!(d >= 0 && d < 6)) return fail('invalid-dof');
      const restraint = state.nodes[id].restraint.slice();
      restraint[d] = !restraint[d];
      return setRestraint(id, restraint);
    }

    /** 'rigid' transfers moment between members; 'pinned' releases member ends at the node. */
    function setJoint(id, joint) {
      if (!state.nodes[id]) return fail('no-node');
      if (joint !== 'rigid' && joint !== 'pinned') return fail('invalid-joint');
      const before = begin();
      state.nodes[id].joint = joint;
      end('setJoint', before);
      return { ok: true };
    }

    function toggleJoint(id) {
      if (!state.nodes[id]) return fail('no-node');
      const joint = state.nodes[id].joint === 'rigid' ? 'pinned' : 'rigid';
      const result = setJoint(id, joint);
      return result.ok ? { ok: true, joint } : result;
    }

    // -------------------------------------------------------------- loads

    function findLoad(nodeId, direction) {
      for (const id in state.loads) {
        const l = state.loads[id];
        const dot = l.direction[0] * direction[0] + l.direction[1] * direction[1] + l.direction[2] * direction[2];
        if (l.node === nodeId && dot > 0.999) return l;
      }
      return null;
    }

    /**
     * Apply a point load. `target` is a node id or a lattice point, `direction`
     * an axis id such as '-Z' or a vector, `magnitude` a positive number in kN.
     * A node carries one load per direction: adding the same direction again
     * replaces the magnitude.
     */
    function addLoad(target, direction, magnitude) {
      const unit = toUnitVector(direction);
      if (!unit) return fail('invalid-direction');
      if (!(Number.isFinite(magnitude) && magnitude > 0)) return fail('invalid-magnitude');
      if (typeof target === 'string' ? !state.nodes[target] : !inBounds(target)) {
        return fail(typeof target === 'string' ? 'no-node' : 'out-of-bounds');
      }
      const before = begin();
      rebuildIndex();
      const node = typeof target === 'string' ? state.nodes[target] : nodeAtOrCreate(target);
      let load = findLoad(node.id, unit);
      if (load) {
        load.magnitude = magnitude;
      } else {
        const id = 'l' + ++state.seq.l;
        load = state.loads[id] = { id, node: node.id, direction: unit, magnitude, player: state.turn.player };
      }
      end('addLoad', before);
      return { ok: true, id: load.id };
    }

    /** Change the direction and/or magnitude of an existing load. */
    function updateLoad(id, changes) {
      const load = state.loads[id];
      if (!load) return fail('no-load');
      const next = changes || {};
      let unit = load.direction;
      if (next.direction !== undefined) {
        unit = toUnitVector(next.direction);
        if (!unit) return fail('invalid-direction');
        const clash = findLoad(load.node, unit);
        if (clash && clash.id !== id) return fail('direction-taken');
      }
      if (next.magnitude !== undefined && !(Number.isFinite(next.magnitude) && next.magnitude > 0)) {
        return fail('invalid-magnitude');
      }
      const before = begin();
      load.direction = unit;
      if (next.magnitude !== undefined) load.magnitude = next.magnitude;
      end('updateLoad', before);
      return { ok: true };
    }

    function removeLoad(id) {
      if (!state.loads[id]) return fail('no-load');
      const before = begin();
      delete state.loads[id];
      end('removeLoad', before);
      return { ok: true };
    }

    // ------------------------------------------- whole-model operations

    /** Remove everything. Ids keep counting up so views never see a reused id. */
    function clear() {
      const before = begin();
      state = Object.assign(emptyState(), { seq: state.seq });
      end('clear', before);
      return { ok: true };
    }

    /** Run several edits as one undo step and one change event. */
    function batch(fn, reason) {
      if (batchDepth === 0) batchBefore = JSON.stringify(state);
      batchDepth++;
      try {
        fn(api);
      } finally {
        batchDepth--;
        if (batchDepth === 0) {
          normalize();
          const before = batchBefore;
          batchBefore = null;
          finish(reason || 'batch', before, false);
        }
      }
    }

    function undo() {
      if (!undoStack.length || batchDepth > 0) return false;
      const previous = state;
      redoStack.push(JSON.stringify(state));
      state = JSON.parse(undoStack.pop());
      rebuildIndex();
      emit('undo', previous, false);
      return true;
    }

    function redo() {
      if (!redoStack.length || batchDepth > 0) return false;
      const previous = state;
      undoStack.push(JSON.stringify(state));
      state = JSON.parse(redoStack.pop());
      rebuildIndex();
      emit('redo', previous, false);
      return true;
    }

    /**
     * Provisional hot-seat turn counter. Turn rules are not decided; this only
     * records who placed what so a view can show it.
     */
    function endTurn() {
      const before = begin();
      state.turn = { player: (state.turn.player % opts.players) + 1, number: state.turn.number + 1 };
      end('endTurn', before);
      return { ok: true, turn: Object.assign({}, state.turn) };
    }

    /**
     * View-owned data that should follow undo/redo and save/restore (for
     * example which bays a block-based view has stacked). Values must be plain
     * JSON. Not part of the solver input.
     */
    function setMeta(key, value) {
      const before = begin();
      if (value === undefined) delete state.meta[key];
      else state.meta[key] = JSON.parse(JSON.stringify(value));
      end('setMeta', before);
      return { ok: true };
    }

    function getMeta(key) {
      const value = state.meta[key];
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    /** The full game state as plain JSON (members, connections, loads, turn). */
    function snapshot() {
      return JSON.parse(JSON.stringify(state));
    }

    /** Replace the game state with a snapshot. Views should rebuild: the change event has reset = true. */
    function restore(saved) {
      if (!saved || !saved.nodes || !saved.members || !saved.loads || !saved.seq) return fail('invalid-snapshot');
      const before = begin();
      state = Object.assign(emptyState(), JSON.parse(JSON.stringify(saved)));
      normalize();
      if (batchDepth === 0) finish('restore', before, true);
      return { ok: true };
    }

    // ------------------------------------------------------ derived data

    /**
     * Split every member into analysis elements at the nodes lying on it.
     * endI / endJ say whether that element end is a real end of the member
     * (as opposed to a point the member runs through).
     */
    function buildElements() {
      rebuildIndex();
      const elements = [];
      for (const m of Object.values(state.members).sort(byId)) {
        const points = latticePoints(gridOf(state.nodes[m.a]), gridOf(state.nodes[m.b]));
        let previous = state.nodes[m.a];
        let count = 0;
        for (let t = 1; t < points.length; t++) {
          const nodeId = index.get(keyOfPoint(points[t]));
          if (!nodeId) continue;
          const node = state.nodes[nodeId];
          const d = [node.i - previous.i, node.j - previous.j, node.k - previous.k];
          elements.push({
            id: m.id + '.' + ++count,
            member: m.id,
            nodeI: previous.id,
            nodeJ: node.id,
            length: round(Math.hypot(d[0], d[1], d[2]) * opts.spacing, 4),
            endI: previous.id === m.a,
            endJ: node.id === m.b
          });
          previous = node;
        }
      }
      return elements;
    }

    function adjacency(elements) {
      const graph = new Map();
      for (const id in state.nodes) graph.set(id, []);
      for (const e of elements) {
        graph.get(e.nodeI).push(e.nodeJ);
        graph.get(e.nodeJ).push(e.nodeI);
      }
      return graph;
    }

    /** Hop counts from one or more start nodes across the members. */
    function hops(graph, starts) {
      const distance = new Map();
      const queue = [];
      for (const s of starts) {
        distance.set(s, 0);
        queue.push(s);
      }
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const next of graph.get(current) || []) {
          if (!distance.has(next)) {
            distance.set(next, distance.get(current) + 1);
            queue.push(next);
          }
        }
      }
      return distance;
    }

    /**
     * Which parts have a path of members to a support. This is a plain graph
     * check: a piece with no path to a support cannot stand, but having a path
     * does NOT make a structure stable. Real stability needs the solver.
     */
    function connectivity() {
      const elements = buildElements();
      const graph = adjacency(elements);
      const supports = Object.values(state.nodes)
        .filter((n) => n.restraint[0] || n.restraint[1] || n.restraint[2])
        .map((n) => n.id);
      const reached = hops(graph, supports);
      const floatingNodes = Object.keys(state.nodes).filter((id) => !reached.has(id));
      const floating = new Set(floatingNodes);
      const floatingMembers = Object.values(state.members)
        .filter((m) => floating.has(m.a))
        .map((m) => m.id);
      return {
        supports,
        groundedNodes: Object.keys(state.nodes).filter((id) => reached.has(id)),
        floatingNodes,
        floatingMembers,
        allGrounded: floatingNodes.length === 0
      };
    }

    /** Simple size measures that need no analysis (README: "Complexity"). */
    function stats() {
      const nodes = Object.values(state.nodes);
      const members = Object.values(state.members).map(publicMember);
      const loads = Object.values(state.loads);
      return {
        members: members.length,
        nodes: nodes.length,
        supports: nodes.filter((n) => n.restraint.some(Boolean)).length,
        pinnedJoints: nodes.filter((n) => n.joint === 'pinned').length,
        loads: loads.length,
        totalLength: round(members.reduce((sum, m) => sum + m.length, 0), 3),
        totalLoad: round(loads.reduce((sum, l) => sum + l.magnitude, 0), 3)
      };
    }

    /**
     * The analysis model the environment would hand to the solver.
     * DRAFT: proposed here, not agreed with the solver work.
     */
    function toSolverInput() {
      const elements = buildElements();
      const elementsOf = {};
      for (const e of elements) (elementsOf[e.member] = elementsOf[e.member] || []).push(e.id);
      return {
        schema: 'dof-game/solver-input@0-draft',
        note: 'Draft proposed by the game-environment prototypes. Not an agreed contract.',
        units: { length: 'm', force: 'kN', moment: 'kN*m' },
        axes: { up: '+Z', gravity: '-Z', handedness: 'right' },
        dofOrder: DOF_ORDER.slice(),
        releaseOrder: RELEASE_ORDER.slice(),
        grid: { spacing: opts.spacing, bounds: JSON.parse(JSON.stringify(opts.bounds)) },
        section: {
          id: 'default',
          note: 'Material and section are predetermined; their values are owned by the solver.'
        },
        nodes: Object.values(state.nodes).sort(byId).map((n) => ({
          id: n.id,
          grid: gridOf(n),
          position: position(gridOf(n)),
          restraint: n.restraint.slice(),
          support: supportName(n.restraint),
          joint: n.joint
        })),
        members: Object.values(state.members).sort(byId).map((m) => {
          const pm = publicMember(m);
          return { id: m.id, nodeI: m.a, nodeJ: m.b, length: pm.length, role: pm.role, elements: elementsOf[m.id] || [] };
        }),
        elements: elements.map((e) => ({
          id: e.id,
          member: e.member,
          nodeI: e.nodeI,
          nodeJ: e.nodeJ,
          length: e.length,
          releaseI: (e.endI && state.nodes[e.nodeI].joint === 'pinned' ? RELEASE_PINNED : RELEASE_NONE).slice(),
          releaseJ: (e.endJ && state.nodes[e.nodeJ].joint === 'pinned' ? RELEASE_PINNED : RELEASE_NONE).slice()
        })),
        loads: Object.values(state.loads).sort(byId).map((l) => {
          const pl = publicLoad(l);
          return { id: l.id, node: l.node, force: pl.force, moment: [0, 0, 0], direction: pl.direction, magnitude: l.magnitude };
        }),
        summary: stats()
      };
    }

    /**
     * PLACEHOLDER results so a view can rehearse how feedback might look
     * before a solver exists. The numbers come from a toy rule (a load's
     * effect fades with the number of members between it and a piece). They
     * are NOT a structural analysis and must always be labelled as demo data.
     */
    function mockResults() {
      const elements = buildElements();
      const graph = adjacency(elements);
      const grounded = new Set(connectivity().groundedNodes);
      const nodes = Object.values(state.nodes);
      const top = Math.max(1, ...nodes.map((n) => n.k - groundLevel));
      const memberOut = {};
      const nodeOut = {};
      const axial = {};
      for (const id in state.members) axial[id] = 0;
      const moved = {};
      for (const n of nodes) moved[n.id] = [0, 0, 0];

      for (const l of Object.values(state.loads)) {
        const distance = hops(graph, [l.node]);
        const loadLevel = state.nodes[l.node].k;
        for (const m of Object.values(state.members)) {
          const da = distance.get(m.a);
          const db = distance.get(m.b);
          if (da === undefined && db === undefined) continue;
          const near = Math.min(da === undefined ? Infinity : da, db === undefined ? Infinity : db);
          const middle = (state.nodes[m.a].k + state.nodes[m.b].k) / 2;
          const sign = middle <= loadLevel ? -1 : 1; // below the load: squeezed; above: pulled
          axial[m.id] += (sign * l.magnitude) / (1 + near);
        }
        for (const n of nodes) {
          const d = distance.get(n.id);
          if (d === undefined) continue;
          const amount = (0.02 * (l.magnitude / 10) * ((n.k - groundLevel) / top)) / (1 + 0.5 * d);
          for (let c = 0; c < 3; c++) {
            if (!n.restraint[c]) moved[n.id][c] += l.direction[c] * amount;
          }
        }
      }
      for (const id in state.members) {
        memberOut[id] = { axial: round(axial[id], 2), utilization: round(Math.min(1.5, Math.abs(axial[id]) / 40), 3) };
      }
      for (const n of nodes) {
        nodeOut[n.id] = { displacement: moved[n.id].map((c) => round(c, 5) + 0), grounded: grounded.has(n.id) };
      }
      return {
        schema: 'dof-game/solver-results@0-draft',
        mock: true,
        note: 'PLACEHOLDER numbers from a toy rule. Not a structural analysis.',
        stable: null,
        members: memberOut,
        nodes: nodeOut
      };
    }

    // ----------------------------------------------------------- examples

    const EXAMPLES = {
      /** Two columns and a beam with a load in the middle. */
      portal(m) {
        m.addMember([3, 4, 0], [3, 4, 3]);
        m.addMember([6, 4, 0], [6, 4, 3]);
        m.addMember([3, 4, 3], [6, 4, 3]);
        m.addLoad([4, 4, 3], '-Z', 10);
        m.addLoad([3, 4, 3], '+X', 5);
      },
      /** A small braced two-storey frame with a propped arm carrying a load. */
      tower(m) {
        const corners = [[3, 3], [5, 3], [5, 5], [3, 5]];
        corners.forEach(([i, j], c) => {
          if (c % 2 === 0) {
            m.addMember([i, j, 0], [i, j, 4]); // one continuous two-storey column
          } else {
            m.addMember([i, j, 0], [i, j, 2]);
            m.addMember([i, j, 2], [i, j, 4]);
          }
        });
        for (const level of [2, 4]) {
          corners.forEach(([i, j], c) => {
            const [i2, j2] = corners[(c + 1) % 4];
            m.addMember([i, j, level], [i2, j2, level]);
          });
        }
        m.addMember([3, 3, 0], [5, 3, 2]);
        m.addMember([5, 3, 0], [5, 5, 2]);
        m.addMember([5, 5, 2], [3, 5, 4]);
        m.addMember([3, 5, 2], [3, 3, 4]);
        m.addMember([5, 3, 4], [7, 3, 4]); // arm
        m.addMember([5, 3, 2], [7, 3, 4]); // prop under the arm
        m.addLoad([7, 3, 4], '-Z', 20);
        m.addLoad([3, 5, 4], '+X', 10);
        m.setSupport(m.nodeAt([3, 3, 0]).id, 'fixed');
        m.setJoint(m.nodeAt([7, 3, 4]).id, 'pinned');
      }
    };

    /** Replace the model with a named example ('portal' or 'tower') as one undo step. */
    function loadExample(name) {
      if (!EXAMPLES[name]) return fail('no-example');
      batch(() => {
        clear();
        EXAMPLES[name](api);
      }, 'example');
      return { ok: true };
    }

    // ---------------------------------------------------------------- api

    const api = {
      options: opts,

      // reading
      get nodes() { return Object.values(state.nodes).sort(byId).map(publicNode); },
      get members() { return Object.values(state.members).sort(byId).map(publicMember); },
      get loads() { return Object.values(state.loads).sort(byId).map(publicLoad); },
      get turn() { return Object.assign({}, state.turn); },
      get canUndo() { return undoStack.length > 0; },
      get canRedo() { return redoStack.length > 0; },
      node: (id) => (state.nodes[id] ? publicNode(state.nodes[id]) : null),
      member: (id) => (state.members[id] ? publicMember(state.members[id]) : null),
      load: (id) => (state.loads[id] ? publicLoad(state.loads[id]) : null),
      /** The node on a lattice point, or null. */
      nodeAt(p) {
        rebuildIndex();
        const id = isPoint(p) ? index.get(keyOfPoint(p)) : null;
        return id ? publicNode(state.nodes[id]) : null;
      },
      /** Loads applied at a node. */
      loadsAt: (nodeId) => Object.values(state.loads).filter((l) => l.node === nodeId).sort(byId).map(publicLoad),
      /** Members on a node: `end` is false when the member runs through it. */
      membersAt(nodeId) {
        const n = state.nodes[nodeId];
        if (!n) return [];
        const key = keyOf(n.i, n.j, n.k);
        const out = [];
        for (const m of Object.values(state.members).sort(byId)) {
          const points = latticePoints(gridOf(state.nodes[m.a]), gridOf(state.nodes[m.b]));
          if (points.some((p) => keyOfPoint(p) === key)) out.push({ id: m.id, end: m.a === nodeId || m.b === nodeId });
        }
        return out;
      },
      position,
      inBounds,
      latticePoints,
      reachableFrom,
      getMeta,
      stats,
      connectivity,

      // editing
      checkMember,
      addMember,
      removeMember,
      setMeta,
      ensureNode,
      removeNode,
      setRestraint,
      setSupport,
      cycleSupport,
      toggleDof,
      setJoint,
      toggleJoint,
      addLoad,
      updateLoad,
      removeLoad,
      clear,
      batch,
      undo,
      redo,
      endTurn,
      loadExample,

      // output
      toSolverInput,
      mockResults,
      snapshot,
      restore,

      /** Subscribe to changes: fn(change, model). Returns an unsubscribe function. */
      on(event, fn) {
        if (event !== 'change' || typeof fn !== 'function') return () => {};
        listeners.push(fn);
        return () => {
          const at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        };
      }
    };

    return api;
  }

  global.DOFCore = {
    version: '0.1.0-draft',
    createModel,
    latticePoints,
    supportName,
    DOF_ORDER,
    SUPPORT_PRESETS,
    SUPPORT_CYCLE,
    RELEASE_ORDER,
    AXIS_DIRECTIONS,
    LOAD_STEPS,
    DIRECTIONS_26
  };
})(typeof window !== 'undefined' ? window : globalThis);
