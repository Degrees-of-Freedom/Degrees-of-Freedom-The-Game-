/** Deterministic voxel fixtures. Coordinates are grid cells (2 m); loads are kN. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { addSculpturalStructures } from './sculptural-structures.mjs';

const root = fileURLToPath(new URL('../apps/web/public/structures/', import.meta.url));
mkdirSync(root, { recursive: true });
mkdirSync(`${root}/records`, { recursive: true });
const records = [];
function build(id, name, family, purpose, construct, expectation = 'stable') {
  const model = { members: [], attrs: {}, nextId: 1 };
  const key = p => p.join(',');
  const attr = (p, values) => Object.assign(model.attrs[key(p)] ??= {}, values);
  const edge = (a, b, type = 'shs', rigid = true) => {
    model.members.push({ id: model.nextId++, a: key(a), b: key(b), type });
    if (rigid && type !== 'cable') { attr(a, { joint: true }); attr(b, { joint: true }); }
  };
  const base = p => attr(p, { found: true });
  const load = (p, amount = 10) => attr(p, { load: amount });
  construct({ edge, base, load, attr });
  const points = [...new Set(model.members.flatMap(m => [m.a, m.b]))].map(p => p.split(',').map(Number));
  const span = [0, 1, 2].map(i => 2 * (Math.max(...points.map(p => p[i])) - Math.min(...points.map(p => p[i]))));
  records.push({ format: 'dof-structure-record', version: 1, id, name, family, purpose,
    complexity: model.members.length <= 10 ? 'small' : model.members.length <= 60 ? 'medium' : 'large',
    nodeCount: points.length, memberCount: model.members.length, extentMetres: span,
    foundationCount: Object.values(model.attrs).filter(a => a.found).length,
    expectation: { stability: expectation, basis: 'Qualitative design intent; not a verified numerical reference.' },
    preview: `previews/${id}.png`,
    save: { format: 'dof-voxel-save', version: 1, levelId: 'library', model } });
}
const column = ({ edge, base, load }, height = 3, type = 'heb') => {
  base([6, 6, 0]);
  for (let z = 0; z < height; z++) edge([6, 6, z], [6, 6, z + 1], type);
  load([6, 6, height]);
};
build('01-stocky-column', 'Stocky column', 'column', 'Axial load, foundation reaction and short-member picking.', c => column(c, 1));
build('02-slender-column', 'Slender column', 'column', 'Height, slenderness and deformation overlays.', c => column(c, 10, 'shs'));
build('03-cantilever', 'Bent cantilever', 'beam', 'Bending, end displacement and moment connections.', c => {
  column(c, 2); for (let x = 6; x < 10; x++) c.edge([x, 6, 2], [x + 1, 6, 2], 'ipe'); c.load([10, 6, 2], 20);
});
function portal(c, rigid = true, brace = false, type = 'ipe') {
  for (const x of [4, 8]) { c.base([x, 6, 0]); c.edge([x, 6, 0], [x, 6, 2], type, rigid); }
  for (let x = 4; x < 8; x++) c.edge([x, 6, 2], [x + 1, 6, 2], type, rigid);
  if (brace) { c.edge([4, 6, 0], [6, 6, 2]); c.edge([8, 6, 0], [6, 6, 2]); }
  c.load([6, 6, 2], 20);
}
build('04-rigid-portal', 'Rigid portal', 'frame', 'Rigid joints and planar frame bending.', c => portal(c));
build('05-released-portal', 'Released portal', 'mechanism', 'Released bending joints; detect mechanism rather than plausible deformation.', c => portal(c, false), 'mechanism');
build('06-braced-portal', 'Braced portal', 'frame', 'Compare bracing against the released portal.', c => portal(c, true, true));
build('07-timber-portal', 'Timber portal', 'frame', 'Material color, section sizing and stiffness comparison.', c => portal(c, true, false, 'glulam'));
function frame(c, nx, ny, floors, brace = false) {
  const p = (x, y, z) => [2 + x * 2, 2 + y * 2, z * 2];
  for (let x = 0; x <= nx; x++) for (let y = 0; y <= ny; y++) {
    c.base(p(x, y, 0));
    for (let z = 1; z <= floors; z++) {
      c.edge(p(x, y, z - 1), p(x, y, z), 'heb');
      if (x < nx) c.edge(p(x, y, z), p(x + 1, y, z), 'ipe');
      if (y < ny) c.edge(p(x, y, z), p(x, y + 1, z), 'ipe');
      if (brace && x < nx && (y === 0 || y === ny)) c.edge(p(x, y, z - 1), p(x + 1, y, z));
      if (brace && y < ny && (x === 0 || x === nx)) c.edge(p(x, y, z - 1), p(x, y + 1, z));
    }
    c.load(p(x, y, floors), 5);
  }
}
build('08-space-frame', 'Single-storey space frame', 'frame', '3D connections and overlapping node selection.', c => frame(c, 1, 1, 1));
build('09-two-storey', 'Two-storey frame', 'building', 'Multiple build planes and floor connectivity.', c => frame(c, 2, 1, 2));
build('10-braced-tower', 'Braced tower', 'tower', 'Slender 3D tower with facade diagonals.', c => frame(c, 1, 1, 5, true));
build('11-unbraced-tower', 'Moment tower', 'tower', 'Compare sway and force distribution without diagonals.', c => frame(c, 1, 1, 5));
build('12-midrise', 'Multi-bay midrise', 'building', 'Dense selection and solver scaling across 208 members.', c => frame(c, 3, 3, 4, true));
function bridge(c, bays, cable = false) {
  for (const y of [4, 6]) {
    for (const x of [2, 2 + bays * 2]) { c.base([x, y, 0]); c.edge([x, y, 0], [x, y, 2], 'heb'); }
    for (let b = 0; b < bays; b++) {
      const x = 2 + b * 2;
      c.edge([x, y, 2], [x + 2, y, 2], 'ipe');
      c.edge([x, y, 4], [x + 2, y, 4]);
      c.edge([x, y, 2], [x + 2, y, 4], cable ? 'cable' : 'shs');
    }
    for (let b = 0; b <= bays; b++) { const x = 2 + b * 2; c.edge([x, y, 2], [x, y, 4]); c.load([x, y, 2], 5); }
  }
  for (let b = 0; b <= bays; b++) for (const z of [2, 4]) c.edge([2 + b * 2, 4, z], [2 + b * 2, 6, z]);
}
build('13-short-bridge', 'Short through bridge', 'bridge', 'Deck loads and two connected side frames.', c => bridge(c, 3));
build('14-long-bridge', 'Long through bridge', 'bridge', '24 m span and repeated-member load paths.', c => bridge(c, 6));
build('15-cable-bridge', 'Cable-diagonal bridge', 'cable', 'Tension-only diagonals and slack-cable visualization.', c => bridge(c, 4, true), 'review');
build('16-roof-grid', 'Timber roof grid', 'roof', 'Plan view, orthogonal roof grid and material contrast.', c => {
  for (let x = 2; x <= 10; x += 2) for (let y = 2; y <= 10; y += 2) {
    if (x < 10) c.edge([x, y, 3], [x + 2, y, 3], 'glulam');
    if (y < 10) c.edge([x, y, 3], [x, y + 2, 3], 'glulam');
    if ([2, 10].includes(x) && [2, 10].includes(y)) { c.base([x, y, 0]); c.edge([x, y, 0], [x, y, 3], 'heb'); }
    c.load([x, y, 3], 2);
  }
});
build('17-pyramid', 'Pyramid canopy', 'roof', 'Spatial diagonals meeting at one loaded apex.', c => {
  const corners = [[3, 3, 0], [9, 3, 0], [9, 9, 0], [3, 9, 0]];
  corners.forEach((p, i) => { c.base(p); c.edge(p, [6, 6, 4]); c.edge(p, corners[(i + 1) % 4]); }); c.load([6, 6, 4], 40);
});
build('18-guyed-mast', 'Guyed mast', 'cable', 'Pretension, cable angles and symmetric anchor layout.', c => {
  column(c, 6); for (const p of [[2, 6, 0], [10, 6, 0], [6, 2, 0], [6, 10, 0]]) { c.base(p); c.edge(p, [6, 6, 6], 'cable'); }
}, 'review');
build('19-floating-component', 'Supported plus floating', 'diagnostic', 'Scope failures to a disconnected component; never claim whole-model stability.', c => {
  portal(c); c.edge([10, 8, 3], [12, 8, 3]); c.load([12, 8, 3]);
}, 'floating');
build('20-no-foundation', 'Unsupported cube', 'diagnostic', 'No-support error, rigid-body modes and clear UI diagnostics.', c => {
  frame(c, 1, 1, 1); for (const p of [[2, 2, 0], [2, 4, 0], [4, 2, 0], [4, 4, 0]]) c.attr(p, { found: false });
}, 'unsupported');

addSculpturalStructures(build);
const catalog = { format: 'dof-structure-library', version: 1, records };
writeFileSync(`${root}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
for (const record of records) writeFileSync(`${root}/records/${record.id}.json`, JSON.stringify(record, null, 2) + '\n');
// SQLite is a generated portable index, not an application persistence service.
const db = new DatabaseSync(`${root}/structures.sqlite`);
db.exec('DROP TABLE IF EXISTS structures; CREATE TABLE structures (id TEXT PRIMARY KEY, name TEXT NOT NULL, family TEXT NOT NULL, member_count INTEGER NOT NULL, node_count INTEGER NOT NULL, foundation_count INTEGER NOT NULL, preview TEXT NOT NULL, record_json TEXT NOT NULL);');
const insert = db.prepare('INSERT INTO structures VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
for (const r of records) insert.run(r.id, r.name, r.family, r.memberCount, r.nodeCount, r.foundationCount, r.preview, JSON.stringify(r));
db.close();
console.log(`Generated ${records.length} structure records and SQLite index.`);
