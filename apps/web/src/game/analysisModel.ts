import type {
  AnalysisLoad,
  AnalysisModel,
  AnalysisOptions,
  ConnectionLaws,
} from '@dof/solver-contract';
import { ITEMS } from '../evaluator/sections';
import {
  CELL_SIZE,
  parseNodeKey,
  type GameModel,
  type Level,
  type LoadDirection,
  type MemberType,
  type NodeAttributes,
  type Restraint,
} from './model';

import { GRAVITY, SI_PER_KILO, sectionFor } from '../evaluator/engine/siSections';
export { sectionFor };

/**
 * Bending released, torsion and forces held: the game's ordinary
 * (non-moment) connection, as the voxel analysis models it.
 */
const PINNED: ConnectionLaws = ['rigid', 'rigid', 'rigid', 'rigid', 'free', 'free'];

const FULLY_FIXED: Restraint = [true, true, true, true, true, true];

/** Unit vector of each point-load direction the editor offers. */
const DIRECTIONS: Record<LoadDirection, [number, number, number]> = {
  '-Z': [0, 0, -1],
  '+Z': [0, 0, 1],
  '+X': [1, 0, 0],
  '-X': [-1, 0, 0],
  '+Y': [0, 1, 0],
  '-Y': [0, -1, 0],
};

/**
 * Restrained degrees of freedom of a node, or `null` if it is not a support.
 * A foundation without an explicit mask restrains all six, as before masks
 * existed.
 */
function restraintOf(attrs: NodeAttributes | undefined): Restraint | null {
  if (!attrs?.found) return null;
  return attrs.restraint ?? FULLY_FIXED;
}

export interface AnalysisModelTranslation {
  model: AnalysisModel;
  options: AnalysisOptions;
  /** What this translation leaves out, for display beside the result. */
  notes: string[];
}

/** Nodes joined to a foundation through members, found by walking outwards from the foundations. */
function supportedNodes(game: GameModel): Set<string> {
  const neighbours = new Map<string, string[]>();
  for (const { a, b } of game.members) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const reached = new Set(Object.keys(game.attrs).filter((key) => restraintOf(game.attrs[key])?.some(Boolean) && neighbours.has(key)));
  const queue = [...reached];
  for (let next = queue.pop(); next !== undefined; next = queue.pop())
    for (const neighbour of neighbours.get(next) ?? [])
      if (!reached.has(neighbour)) {
        reached.add(neighbour);
        queue.push(neighbour);
      }
  return reached;
}

/**
 * Loads the level puts on the structure, as a force vector in kN per node key.
 *
 * These follow the voxel analysis: a tower carries its payload on its
 * highest nodes, a bridge carries its traffic on the deck nodes between the
 * cliffs, and other levels carry the point loads placed on nodes. Like the
 * voxel analysis, only nodes connected to a foundation are considered, so a
 * loose member cannot attract the payload away from the structure.
 */
function levelLoads(game: GameModel, level: Level, keys: string[]): Map<string, [number, number, number]> {
  const loads = new Map<string, [number, number, number]>();
  if (level.type === 'tower' && level.payload) {
    const top = Math.max(...keys.map((key) => parseNodeKey(key)[2]), 0);
    const tops = top > 0 ? keys.filter((key) => parseNodeKey(key)[2] === top) : [];
    for (const key of tops) loads.set(key, [0, 0, -level.payload / tops.length]);
  } else if (level.type === 'bridge' && level.traffic) {
    const { cliffL = 0, cliffR = 0, cliffH } = level;
    const deck = keys.filter((key) => {
      const [i, , k] = parseNodeKey(key);
      return k === cliffH && i > cliffL && i < cliffR;
    });
    const total = level.traffic * (cliffR - cliffL) * CELL_SIZE;
    for (const key of deck) loads.set(key, [0, 0, -total / deck.length]);
  } else {
    for (const key of keys) {
      const attrs = game.attrs[key];
      if (!attrs?.load) continue;
      // A placed load acts along its chosen axis; downwards unless set.
      const [x, y, z] = DIRECTIONS[attrs.loadDirection ?? '-Z'];
      loads.set(key, [x * attrs.load, y * attrs.load, z * attrs.load]);
    }
  }
  return loads;
}

/**
 * Translate the voxel game model to the detailed solver contract.
 *
 * Unlike `toStructuralModel`, this carries what the cards define:
 *
 * - every member type has its own section, capacities and self-weight;
 * - cables are tension-only and start with their card pretension;
 * - a member end is rigid at a moment connection and pinned in bending
 *   elsewhere;
 * - a foundation restrains the degrees of freedom in its restraint mask, or
 *   all six when it has none;
 * - the level's gravity loads are applied (tower payload, bridge traffic,
 *   placed point loads) to the parts that reach a foundation.
 *
 * Every member is sent, so a part with no foundation is reported by the
 * solver as unsupported, under its own weight only. Nodes without a member
 * are not sent: a foundation nothing stands on has no reaction to report,
 * and a weight nothing is attached to is not yet part of the structure.
 *
 * Bending includes shear deformation, from the cards' shear areas. The voxel
 * analysis does not include it, so short deep members are softer here.
 *
 * Loads are unfactored and there is no wind: the solver analyses one load
 * case, and the voxel analysis's four load combinations are not reproduced.
 * The analysis is geometrically nonlinear.
 */
export function toAnalysisModel(game: GameModel, level: Level): AnalysisModelTranslation {
  const keys = [...new Set(game.members.flatMap((member) => [member.a, member.b]))].sort();
  const supported = supportedNodes(game);
  const types = [...new Set(game.members.map((member) => member.type))].sort();

  const loads: AnalysisLoad[] = [];
  for (const [key, [x, y, z]] of levelLoads(game, level, keys.filter((key) => supported.has(key))))
    loads.push({ id: `load:${key}`, nodeId: key, force: [x * SI_PER_KILO, y * SI_PER_KILO, z * SI_PER_KILO] });

  const model: AnalysisModel = {
    version: `next-id-${game.nextId}`,
    nodes: keys.map((key) => {
      const [i, j, k] = parseNodeKey(key);
      return { id: key, position: [i * CELL_SIZE, j * CELL_SIZE, k * CELL_SIZE] };
    }),
    sections: types.map(sectionFor),
    members: game.members.map((member) => {
      const base = { id: String(member.id), startNodeId: member.a, endNodeId: member.b, sectionId: member.type };
      if (member.type === 'cable') {
        const cable = ITEMS.cable;
        return { ...base, kind: 'cable' as const, initialStrain: cable.P0 / (cable.E * cable.A) };
      }
      return {
        ...base,
        kind: 'beam' as const,
        ...(!game.attrs[member.a]?.joint && { start: { laws: PINNED } }),
        ...(!game.attrs[member.b]?.joint && { end: { laws: PINNED } }),
      };
    }),
    foundations: keys.flatMap((key) => {
      const restrained = restraintOf(game.attrs[key]);
      return restrained ? [{ id: `foundation:${key}`, nodeId: key, restrained: [...restrained] as Restraint }] : [];
    }),
    loads,
  };

  const notes = [
    'Self-weight and the level loads, unfactored. Wind and load combinations are not included.',
    'Utilisation is section strength only. Buckling shows as instability, not as a reduced capacity; deflection limits and joint and foundation capacities are not checked.',
  ];
  const looseLoads = Object.entries(game.attrs).filter(([key, attrs]) => attrs.load && !supported.has(key)).length;
  if (looseLoads && level.type !== 'tower' && level.type !== 'bridge')
    notes.push(`${looseLoads} placed load(s) are not connected to a foundation and were left out.`);
  return { model, options: { fidelity: 'nonlinear', gravity: [0, 0, -GRAVITY] }, notes };
}
