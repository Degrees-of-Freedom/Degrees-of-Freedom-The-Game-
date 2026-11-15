/** Faceted gridshells on the existing 2 m integer lattice, not shell elements.
 * All member joints are rigid. Triangulation joins actual vertices; crossings
 * between vertices do not introduce implicit connectivity. */
const roundPoint = p => p.map(Math.round);
const tau = Math.PI * 2;

function foot(c, point) {
  const base = [point[0], point[1], 0];
  c.base(base);
  c.edge(base, point, 'heb');
}

/** Triangulate each four-node panel once, alternating diagonals for readability. */
function patch(c, nu, nv, point, type = 'shs') {
  const points = Array.from({ length: nu }, (_, u) =>
    Array.from({ length: nv }, (_, v) => roundPoint(point(u, v))));
  for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) {
    if (u + 1 < nu) c.edge(points[u][v], points[u + 1][v], type);
    if (v + 1 < nv) c.edge(points[u][v], points[u][v + 1], type);
    if (u + 1 < nu && v + 1 < nv) {
      if ((u + v) % 2) c.edge(points[u][v + 1], points[u + 1][v], type);
      else c.edge(points[u][v], points[u + 1][v + 1], type);
    }
    // A sparse, explicitly recorded gravity pattern keeps the geometry legible.
    if ((u + v) % 3 === 0) c.load(points[u][v], 2);
  }
  return points;
}

/** Closed rings with radial and diagonal links, optionally closed by one apex. */
function rings(c, profiles, point, apex, type = 'shs') {
  const n = 12;
  const rows = profiles.map((profile, row) =>
    Array.from({ length: n }, (_, i) => roundPoint(point(profile, tau * i / n, row))));
  rows.forEach((row, r) => row.forEach((p, i) => {
    const next = (i + 1) % n;
    c.edge(p, row[next], type);
    if (r > 0) {
      c.edge(rows[r - 1][i], p, type);
      c.edge(rows[r - 1][i], row[next], type);
    } else if (apex) c.edge(apex, p, type);
    if (i % 4 === 0) c.load(p, 2);
  }));
  return rows;
}

/** Add exactly ten specimens; none modifies the original twenty models. */
export function addSculpturalStructures(build) {
  build('21-four-foot-bowl', 'Four-foot bowl', 'bowl',
    'Concave double-curved dish with a low center and four rim supports.', c => {
      const rows = rings(c, [[2, 2], [4, 3], [6, 5]],
        ([r, z], t) => [8 + r * Math.cos(t), 8 + r * Math.sin(t), z], [8, 8, 1]);
      [0, 3, 6, 9].forEach(i => foot(c, rows[2][i]));
    }, 'review');

  build('22-tilted-bowl', 'Tilted asymmetric bowl', 'bowl',
    'An offset basin, tilted lip and three unequal rim columns.', c => {
      const rows = rings(c, [[2, 3], [4, 4], [6, 6]],
        ([r, z], t, row) => [7 + row * .5 + r * Math.cos(t), 8 + r * Math.sin(t),
          z + .32 * r * Math.cos(t) - .18 * r * Math.sin(t)], [7, 8, 2]);
      [0, 4, 8].forEach(i => foot(c, rows[2][i]));
    }, 'review');

  build('23-cambered-ribbon', 'Cambered ribbon bridge', 'camber',
    'Longitudinal camber and a transverse crown carried by only two central piers.', c => {
      const heights = [2, 4, 5, 6, 5, 4, 2];
      const p = patch(c, 7, 3, (u, v) => [2 + 2 * u, 6 + 2 * v, heights[u] + (v === 1 ? 1 : 0)], 'ipe');
      foot(c, p[0][1]); foot(c, p[6][1]);
    }, 'review');

  build('24-twisting-cantilever', 'Twisting cantilever', 'cantilever',
    'A rising, torsionally warped deck with a deep truss spine projecting 12 m from a two-foot root.', c => {
      const p = patch(c, 7, 3, (u, v) => [2 + u, 6 + 2 * v,
        3 + .5 * u + (u - 2) * (v - 1) * .5], 'ipe');
      foot(c, p[0][0]); foot(c, p[0][2]); c.load(p[6][1], 8);
      // Give the long projection structural depth without adding a third foot.
      const lower = p.map(row => [row[1][0], row[1][1], row[1][2] - 2]);
      lower.forEach((q, u) => {
        c.edge(q, p[u][1], 'heb');
        c.edge(q, p[u][0]); c.edge(q, p[u][2]);
        if (u < 6) { c.edge(q, lower[u + 1], 'heb'); c.edge(q, p[u + 1][1]); }
      });
      for (const v of [0, 2]) c.edge([p[0][v][0], p[0][v][1], 0], lower[0], 'heb');
    }, 'review');

  build('25-organic-dome', 'Eccentric organic dome', 'dome',
    'An off-center crown, elliptical rings and a wavy skirt on three supports.', c => {
      const rows = rings(c, [[2, 7], [4, 5], [6, 3]],
        ([r, z], t, row) => [9 - .5 * row + r * Math.cos(t), 7 + .5 * row + .85 * r * Math.sin(t),
          z + .7 * Math.sin(2 * t) + .5 * Math.cos(t)], [9, 7, 9], 'glulam');
      [0, 4, 8].forEach(i => foot(c, rows[2][i]));
    }, 'review');

  build('26-saddle-gridshell', 'Anticlastic saddle', 'double-curved',
    'Opposing principal curvatures and alternating high/low corners on four feet.', c => {
      const p = patch(c, 5, 5, (u, v) => [3 + 2 * u, 3 + 2 * v, 5 + .75 * (u - 2) * (v - 2)]);
      [[0, 0], [0, 4], [4, 0], [4, 4]].forEach(([u, v]) => foot(c, p[u][v]));
    }, 'review');

  build('27-asymmetric-wave', 'Asymmetric wave canopy', 'freeform',
    'Warped plan, changing curvature and a lopsided roof resting on three feet.', c => {
      const p = patch(c, 5, 5, (u, v) => [3 + 2 * u + Math.sin(v * Math.PI / 3),
        3 + 2 * v + .5 * Math.sin(u),
        5 + 2 * Math.sin(u * Math.PI / 3) + 1.5 * Math.cos(v * Math.PI / 3) + .35 * (u - 2) * (v - 2)]);
      [[0, 0], [4, 0], [2, 4]].forEach(([u, v]) => foot(c, p[u][v]));
    }, 'review');

  build('28-crescent-leaf', 'Crescent leaf cantilever', 'organic',
    'A curved spine, tapering width and twisted leaf edges cantilever from three clustered feet.', c => {
      const widths = [1, 2, 3, 3, 2, 1];
      const heights = [3, 4, 6, 7, 6, 5];
      const p = patch(c, 6, 3, (u, v) => [3 + 2 * u,
        7 + 2 * Math.sin(u * Math.PI / 5) + (v - 1) * widths[u],
        heights[u] + (v - 1) * Math.sin(u * Math.PI / 4)], 'glulam');
      foot(c, p[0][0]); foot(c, p[0][2]); foot(c, p[1][1]); c.load(p[5][1], 5);
      // Two sweeping branches share the existing third foundation.
      const root = [p[1][1][0], p[1][1][1], 0];
      c.edge(root, p[3][0], 'glulam'); c.edge(root, p[3][2], 'glulam');
    }, 'review');

  build('29-torqued-oculus', 'Torqued oculus', 'double-curved',
    'An open central eye surrounded by a twisting annular gridshell and four rim columns.', c => {
      const rows = rings(c, [[2, 6], [4, 5], [6, 4]],
        ([r, z], t) => [8 + r * Math.cos(t), 8 + r * Math.sin(t),
          z + 1.5 * Math.sin(2 * t) + .6 * Math.cos(t)], null);
      [0, 3, 6, 9].forEach(i => foot(c, rows[2][i]));
    }, 'review');

  build('30-branching-canopy', 'Branching cloud canopy', 'organic',
    'A doubly curved, asymmetric roof supported by three trunks with branching load paths.', c => {
      const roof = patch(c, 5, 5, (u, v) => [3 + 2 * u, 3 + 2 * v,
        7 + 2 * Math.cos((u - 2) * .7) * Math.cos((v - 2) * .7) + .3 * (u - v)], 'glulam');
      const trees = [
        { root: [4, 4, 0], fork: [5, 5, 3], tips: [[0, 0], [2, 0], [1, 2]] },
        { root: [11, 5, 0], fork: [10, 6, 4], tips: [[4, 0], [4, 2], [2, 2]] },
        { root: [7, 11, 0], fork: [7, 10, 3], tips: [[0, 4], [2, 4], [4, 4]] },
      ];
      trees.forEach(({ root, fork, tips }) => {
        c.base(root); c.edge(root, fork, 'heb');
        tips.forEach(([u, v]) => c.edge(fork, roof[u][v], 'glulam'));
      });
    }, 'review');
}
