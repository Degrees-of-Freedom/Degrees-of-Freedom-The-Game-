import type {
  AnalysisLoad,
  AnalysisModel,
  AnalysisOptions,
  AnalysisSection,
  ConnectionLaws,
} from '@dof/solver-contract';
import { ITEMS } from '../solver/voxelSections';
import {
  allNodeKeys,
  CELL_SIZE,
  parseNodeKey,
  type GameModel,
  type Level,
  type MemberType,
} from './model';

/** The game stores forces in kN and stiffness in kN/m²; the solver uses SI. */
const SI_PER_KILO = 1e3;
/** Standard gravity, m/s², acting along −Z (the game's vertical axis). */
const GRAVITY = 9.81;

/**
 * Bending released, torsion and forces held: the game's ordinary
 * (non-moment) connection, as the voxel analysis models it.
 */
const PINNED: ConnectionLaws = ['rigid', 'rigid', 'rigid', 'rigid', 'free', 'free'];

export interface AnalysisModelTranslation {
  model: AnalysisModel;
  options: AnalysisOptions;
  /** What this translation leaves out, for display beside the result. */
  notes: string[];
}

/**
 * Card properties of one member type in the solver's units.
 *
 * Strengths become capacities: axial from the area, bending from the section
 * moduli, shear from the smaller shear area, a cable from its design
 * resistance. Self-weight per metre becomes a density, so that the solver's
 * own self-weight reproduces the card's weight.
 */
export function sectionFor(type: MemberType): AnalysisSection {
  const item = ITEMS[type];
  const density = (item.w * SI_PER_KILO) / (item.A * GRAVITY);
  if (item.kind === 'cable')
    return {
      id: type,
      E: item.E * SI_PER_KILO,
      A: item.A,
      density,
      capacity: { tension: item.NRd * SI_PER_KILO },
    };
  return {
    id: type,
    E: item.E * SI_PER_KILO,
    G: item.G * SI_PER_KILO,
    A: item.A,
    Iy: item.Iy,
    Iz: item.Iz,
    J: item.J,
    shearAreaY: item.Avy,
    shearAreaZ: item.Avz,
    density,
    capacity: {
      tension: item.ft * item.A * SI_PER_KILO,
      compression: item.fc * item.A * SI_PER_KILO,
      momentY: item.fm * item.Wy * SI_PER_KILO,
      momentZ: item.fm * item.Wz * SI_PER_KILO,
      shear: item.fv * Math.min(item.Avy, item.Avz) * SI_PER_KILO,
    },
  };
}

/**
 * Downward loads the level puts on the structure, in kN per node key.
 *
 * These follow the voxel analysis: a tower carries its payload on its
 * highest nodes, a bridge carries its traffic on the deck nodes between the
 * cliffs, and other levels carry the point loads placed on nodes.
 */
function levelLoads(game: GameModel, level: Level, keys: string[]): Map<string, number> {
  const loads = new Map<string, number>();
  if (level.type === 'tower' && level.payload) {
    const top = Math.max(...keys.map((key) => parseNodeKey(key)[2]), 0);
    const tops = top > 0 ? keys.filter((key) => parseNodeKey(key)[2] === top) : [];
    for (const key of tops) loads.set(key, level.payload / tops.length);
  } else if (level.type === 'bridge' && level.traffic) {
    const { cliffL = 0, cliffR = 0, cliffH } = level;
    const deck = keys.filter((key) => {
      const [i, , k] = parseNodeKey(key);
      return k === cliffH && i > cliffL && i < cliffR;
    });
    const total = level.traffic * (cliffR - cliffL) * CELL_SIZE;
    for (const key of deck) loads.set(key, total / deck.length);
  } else {
    for (const key of keys) {
      const load = game.attrs[key]?.load;
      if (load) loads.set(key, load);
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
 * - a foundation restrains all six degrees of freedom;
 * - the level's gravity loads are applied (tower payload, bridge traffic,
 *   placed point loads).
 *
 * Loads are unfactored and there is no wind: the solver analyses one load
 * case, and the voxel analysis's four load combinations are not reproduced.
 * The analysis is geometrically nonlinear.
 */
export function toAnalysisModel(game: GameModel, level: Level): AnalysisModelTranslation {
  const keys = allNodeKeys(game).sort();
  const types = [...new Set(game.members.map((member) => member.type))].sort();

  const loads: AnalysisLoad[] = [];
  for (const [key, kilonewtons] of levelLoads(game, level, keys))
    loads.push({ id: `load:${key}`, nodeId: key, force: [0, 0, -kilonewtons * SI_PER_KILO] });

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
    foundations: keys
      .filter((key) => game.attrs[key]?.found)
      .map((key) => ({ id: `foundation:${key}`, nodeId: key, restrained: [true, true, true, true, true, true] as const })),
    loads,
  };

  return {
    model,
    options: { fidelity: 'nonlinear', gravity: [0, 0, -GRAVITY] },
    notes: ['Self-weight and the level loads, unfactored. Wind and load combinations are not included.'],
  };
}
