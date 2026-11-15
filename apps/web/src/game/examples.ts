import { initialModel } from './layout';
import {
  nodeKey,
  type GameModel,
  type LevelId,
  type MemberType,
} from './model';
import { LEVELS } from './levels';
/** Reference structures supplied by the standalone prototype. */
export function exampleModel(id: LevelId): GameModel | null {
  if (id === 'tower2') return towerTwoExample();
  if (id === 'bridge2') return bridgeTwoExample();
  if (id === 'pickup2') return lakeExample();
  // A reproducible three-weight layout allowed by the random generator.
  // Loading it replaces the current randomized targets as well as the structure.
  if (id === 'pickupR') return exampleModel('pickup1');
  if (id !== 'tower1' && id !== 'bridge1' && id !== 'pickup1') return null;
  const m = initialModel(LEVELS[id]);
  const add = (a: string, b: string, type: MemberType) =>
    m.members.push({ id: m.nextId++, a, b, type });
  if (id === 'pickup1') {
    const points = [
      [4, 4],
      [7, 4],
      [5, 7],
    ];
    points.forEach(([i, j]) => {
      m.attrs[nodeKey(i, j, 0)] = { found: true };
      add(nodeKey(i, j, 0), nodeKey(i, j, 3), 'shs');
    });
    points.forEach(([i, j], n) => {
      const [p, q] = points[(n + 1) % 3];
      add(nodeKey(i, j, 3), nodeKey(p, q, 3), 'shs');
      add(nodeKey(i, j, 0), nodeKey(p, q, 3), 'glulam');
    });
  } else if (id === 'tower1') {
    const legs = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ];
    legs.forEach(([i, j]) => {
      m.attrs[nodeKey(i, j, 0)] = { found: true };
    });
    legs.forEach(([i, j], n) => {
      add(nodeKey(i, j, 0), nodeKey(i, j, 3), 'ipe');
      add(nodeKey(i, j, 3), nodeKey(i, j, 6), n < 2 ? 'ipe' : 'glulam');
    });
    for (const k of [3, 6])
      legs.forEach(([i, j], n) => {
        const [p, q] = legs[(n + 1) % 4];
        add(nodeKey(i, j, k), nodeKey(p, q, k), 'shs');
      });
    for (const k of [0, 3])
      legs.forEach(([i, j], n) => {
        const [p, q] = legs[(n + 1) % 4];
        add(nodeKey(i, j, k), nodeKey(p, q, k + 3), 'shs');
      });
    add(nodeKey(4, 4, 3), nodeKey(6, 6, 3), 'shs');
    add(nodeKey(4, 4, 6), nodeKey(6, 6, 6), 'shs');
  } else {
    const d = 3,
      t = 5;
    for (const y of [4, 6]) {
      for (const i of [4, 6, 8, 10])
        add(nodeKey(i, y, d), nodeKey(i + 2, y, d), 'ipe');
      for (const i of [6, 8])
        add(nodeKey(i, y, t), nodeKey(i + 2, y, t), 'ipe');
      add(nodeKey(4, y, d), nodeKey(6, y, t), 'glulam');
      add(nodeKey(12, y, d), nodeKey(10, y, t), 'glulam');
      for (const i of [6, 8, 10])
        add(nodeKey(i, y, d), nodeKey(i, y, t), 'shs');
      add(nodeKey(6, y, t), nodeKey(8, y, d), 'shs');
      add(nodeKey(10, y, t), nodeKey(8, y, d), 'shs');
    }
    for (const i of [6, 8, 10]) {
      add(nodeKey(i, 4, d), nodeKey(i, 6, d), 'shs');
      add(nodeKey(i, 4, t), nodeKey(i, 6, t), 'shs');
    }
    add(nodeKey(4, 4, d), nodeKey(6, 6, d), 'shs');
    add(nodeKey(6, 6, d), nodeKey(8, 4, d), 'shs');
    add(nodeKey(8, 4, d), nodeKey(10, 6, d), 'shs');
    add(nodeKey(10, 6, d), nodeKey(12, 4, d), 'shs');
    add(nodeKey(6, 4, t), nodeKey(8, 6, t), 'shs');
    add(nodeKey(8, 6, t), nodeKey(10, 4, t), 'shs');
    add(nodeKey(4, 4, d), nodeKey(6, 6, t), 'shs');
    add(nodeKey(12, 4, d), nodeKey(10, 6, t), 'shs');
  }
  return m;
}

/** A braced four-leg tower, with moment joints at its bases and mid-height. */
function towerTwoExample(): GameModel {
  const model = initialModel(LEVELS.tower2);
  const legs = [[4, 4], [6, 4], [6, 6], [4, 6]];
  const add = (a: string, b: string, type: MemberType) =>
    model.members.push({ id: model.nextId++, a, b, type });
  for (const [x, y] of legs) {
    model.attrs[nodeKey(x, y, 0)] = { found: true, joint: true };
    model.attrs[nodeKey(x, y, 6)] = { joint: true };
  }
  for (const z of [0, 3, 6, 9]) for (let n = 0; n < legs.length; n++) {
    const [x, y] = legs[n], [u, v] = legs[(n + 1) % legs.length];
    add(nodeKey(x, y, z), nodeKey(x, y, z + 3), z === 0 ? 'heb' : 'ipe');
    add(nodeKey(x, y, z + 3), nodeKey(u, v, z + 3), 'shs');
    add(nodeKey(x, y, z), nodeKey(u, v, z + 3), 'shs');
  }
  return model;
}

/** The gorge truss uses four added supports on solid bank edges. */
function bridgeTwoExample(): GameModel {
  const m = initialModel(LEVELS.bridge2);
  const add = (x: number, y: number, z: number, u: number, v: number, w: number, type: MemberType = 'shs') =>
    m.members.push({ id: m.nextId++, a: nodeKey(x, y, z), b: nodeKey(u, v, w), type });
  for (const y of [4, 6]) {
    for (let x = 4; x < 18; x += 2) add(x, y, 4, x + 2, y, 4, 'ipe');
    for (let x = 6; x < 16; x += 2) add(x, y, 7, x + 2, y, 7);
    add(4, y, 4, 6, y, 7, 'ipe');
    add(18, y, 4, 16, y, 7, y === 4 ? 'shs' : 'ipe');
    for (let x = 6; x <= 16; x += 2) {
      add(x, y, 4, x, y, 7, x === 14 || x === 16 ? 'ipe' : 'shs');
      m.attrs[nodeKey(x, y, 7)] = { joint: true };
    }
    for (let x = 6; x < 16; x += 2)
      if (x === 14) add(16, y, 7, 14, y, 4);
      else add(x, y, 7, x + 2, y, 4);
    for (const x of [6, 16]) {
      m.attrs[nodeKey(x, y, 0)] = { found: true, joint: true };
      add(x, y, 0, x, y, 2, 'heb');
      add(x, y, 2, x, y, 4, 'heb');
    }
  }
  for (let x = 6; x <= 16; x += 2) {
    add(x, 4, 4, x, 6, 4);
    add(x, 4, 7, x, 6, 7, [6, 14, 16].includes(x) ? 'ipe' : 'shs');
  }
  for (let x = 4; x < 18; x += 2) add(x, 4, 4, x + 2, 6, 4);
  for (let x = 6; x < 16; x += 2) add(x, 4, 7, x + 2, 6, 7);
  return m;
}

/** Two bank frames pick up the lake weights; separate frames serve the land weights. */
function lakeExample(): GameModel {
  const model = initialModel(LEVELS.pickup2);
  const add = (a: string, b: string, type: MemberType = 'shs') =>
    model.members.push({ id: model.nextId++, a, b, type });
  const k = nodeKey;
  for (const [x, y] of [[5, 7], [10, 7], [4, 10], [11, 3]])
    model.attrs[k(x, y, 0)] = { found: true, ...(x === 10 ? {} : { joint: true }) };
  for (const x of [5, 10]) {
    add(k(x, 7, 0), k(x, 7, 2), x === 5 ? 'heb' : 'ipe');
    add(k(x, 7, 2), k(x, 7, 4), 'ipe');
    model.attrs[k(x, 7, 2)] = { joint: true };
    if (x === 10) model.attrs[k(x, 7, 4)] = { joint: true };
  }
  model.attrs[k(7, 7, 4)].joint = true;
  model.attrs[k(10, 6, 2)] = { joint: true };
  add(k(5, 7, 4), k(7, 7, 4), 'ipe');
  add(k(7, 7, 4), k(10, 7, 4), 'ipe');
  add(k(7, 7, 4), k(9, 6, 5), 'ipe');
  add(k(10, 7, 4), k(9, 6, 5), 'ipe');
  add(k(5, 7, 2), k(7, 7, 4), 'ipe');
  add(k(10, 7, 2), k(7, 7, 4));
  model.attrs[k(10, 6, 0)] = { found: true, joint: true };
  add(k(10, 6, 0), k(10, 6, 2), 'glulam');
  add(k(10, 6, 2), k(10, 6, 4), 'glulam');
  add(k(10, 6, 2), k(10, 7, 4), 'ipe');
  add(k(10, 6, 4), k(10, 7, 4), 'ipe');
  add(k(10, 6, 4), k(9, 6, 5), 'ipe');
  for (const [a, b] of [
    [k(5, 7, 2), k(7, 7, 2)], [k(10, 7, 2), k(7, 7, 2)],
    [k(10, 6, 2), k(7, 7, 2)], [k(7, 7, 2), k(7, 7, 4)],
    [k(10, 7, 2), k(9, 6, 5)],
  ]) add(a, b);
  const base = k(4, 10, 0), mid = k(4, 10, 3), target = k(4, 10, 6);
  add(base, mid, 'heb'); add(mid, target, 'ipe'); model.attrs[mid] = { joint: true };
  const a = k(6, 10, 3), b = k(4, 12, 3);
  for (const [from, to] of [[base, a], [base, b], [a, target], [b, target], [a, b], [a, mid], [b, mid]]) add(from, to);
  add(k(11, 3, 0), k(11, 3, 3), 'glulam');
  return model;
}
