/**
 * Test fixtures for the checkpoint service. They are structural models in
 * this module's own input format and stand in for the domain until session 4
 * wires the real adapters. They are not game rules and not shipped state.
 *
 * Section and stiffness numbers are placeholders chosen for clear test
 * outcomes; the criteria leave the authored values open.
 */

import type { AnalysisSection } from '@dof/solver-contract';
import type { CheckpointLoad, CheckpointMember, CheckpointModel, ModelAdapter, OrderedTurn, OrderedTurnAdapter, RotationMask } from './types';

export const FULL: RotationMask = [true, true, true];
/** Placeholder reference spring stiffness k₀, N/m. */
export const K0 = 1e6;

export const BEAM: AnalysisSection = {
  id: 'beam', E: 210e9, G: 81e9, A: 7.49e-3, Iy: 4.47e-5, Iz: 4.47e-5, J: 7.03e-5,
  capacity: { tension: 1.5e6, compression: 1.5e6, momentY: 4e4, momentZ: 4e4 },
};
export const CABLE: AnalysisSection = { id: 'cable', E: 210e9, A: 3e-4, capacity: { tension: 6e4 } };

/** Two players, each with one fixed foundation and a 4 m starting column, 10 m apart. */
export function setupModel(): CheckpointModel {
  const column = (player: string): CheckpointMember => ({
    id: `${player}:column`, kind: 'beam', sectionId: 'beam', ownerId: player, originTurnId: null,
    start: { nodeId: `${player}:base`, mask: FULL }, end: { nodeId: `${player}:top`, mask: FULL },
  });
  return {
    revision: 'setup',
    nodes: [
      { id: 'p1:base', position: [0, 0, 0] }, { id: 'p1:top', position: [0, 0, 4] },
      { id: 'p2:base', position: [10, 0, 0] }, { id: 'p2:top', position: [10, 0, 4] },
    ],
    sections: [BEAM, CABLE],
    members: [column('p1'), column('p2')],
    foundations: [
      { id: 'p1:foundation', nodeId: 'p1:base', ownerId: 'p1' },
      { id: 'p2:foundation', nodeId: 'p2:base', ownerId: 'p2' },
    ],
    loads: [],
  };
}

/** A later revision of `model` with objects added. Nothing is ever removed. */
export function extend(
  model: CheckpointModel, revision: string,
  added: { nodes?: CheckpointModel['nodes']; members?: CheckpointMember[]; loads?: CheckpointLoad[] },
): CheckpointModel {
  return {
    ...model, revision,
    nodes: [...model.nodes, ...(added.nodes ?? [])],
    members: [...model.members, ...(added.members ?? [])],
    loads: [...model.loads, ...(added.loads ?? [])],
  };
}

export function beam(id: string, ownerId: string, turnId: string, from: string, to: string, startMask: RotationMask = FULL, endMask: RotationMask = FULL): CheckpointMember {
  return { id, kind: 'beam', sectionId: 'beam', ownerId, originTurnId: turnId, start: { nodeId: from, mask: startMask }, end: { nodeId: to, mask: endMask } };
}

export function gravityLoad(id: string, ownerId: string, turnId: string, nodeId: string, newtons: number): CheckpointLoad {
  return { id, nodeId, force: [0, 0, -newtons], ownerId, originTurnId: turnId };
}

/**
 * Adapters over a scripted match. Each entry is one committed turn: the
 * player and the model after it, or `null` for a pass.
 */
export function scriptedMatch(setup: CheckpointModel, script: readonly (readonly [playerId: string, model: CheckpointModel | null])[]) {
  const models = new Map([[setup.revision, setup]]);
  const turns: OrderedTurn[] = [];
  let revision = setup.revision;
  script.forEach(([playerId, model], index) => {
    if (model) { models.set(model.revision, model); revision = model.revision; }
    turns.push({ turnId: `turn-${index + 1}`, turnNumber: index + 1, playerId, revision });
  });
  const turnAdapter: OrderedTurnAdapter = { turnsInWindow: (after, through) => turns.filter(t => t.turnNumber > after && t.turnNumber <= through) };
  const modelAdapter: ModelAdapter = {
    modelAt(id) {
      const model = models.get(id);
      if (!model) throw new Error(`Unknown revision ${id}.`);
      return model;
    },
  };
  return { turns, turnAdapter, modelAdapter, models };
}
