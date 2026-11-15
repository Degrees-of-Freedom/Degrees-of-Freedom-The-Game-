import type { AnalysisFidelity, StructuralMember, StructuralModel, StructuralNode } from '@dof/solver-contract';
import { catalogMember, gridPosition, type StructuralModelTranslation } from './structuralModel';
import { turnJoints, type TurnState } from './turns';
import { isInteriorSite } from './attachmentSites';

/** Game load cards are in kN; the contract uses newtons. */
const NEWTONS_PER_KILONEWTON = 1e3;

/**
 * Translate a shared-table turn to the solver contract, member end by member end.
 *
 * Unlike the voxel model, the turn game already has the contract's notion of
 * connectivity: each member end is attached to a shared joint by its own
 * connection card, or not at all. So:
 *
 * - Every joint is a node. Joints with a foundation owner are fully fixed
 *   supports, the confirmed foundation default.
 * - A connected end attaches to its joint with its card's profile: `fixed`
 *   (moment connection) or `ball` (the contract's `pinned`: translations
 *   locked, rotations free).
 * - An end without a connection gets a node of its own at its grid point, so
 *   it transfers nothing to a joint that happens to sit at the same place.
 *   Geometry alone never connects.
 * - Load cards are persistent downward point loads on their joint.
 * - Members use the voxel catalog sections. Cables are tension-only, with the
 *   catalog pretension, which the notes disclose.
 *
 * Board and draft are combined: the turn being ended is assessed as a whole.
 */
export function toTurnStructuralModel(
  turn: TurnState,
  fidelity: AnalysisFidelity = 'nonlinear',
): StructuralModelTranslation {
  if ([...turn.board.connections, ...turn.draft.connections].some(c => isInteriorSite(c.end)))
    throw new Error('The standalone contract adapter does not translate interior collars. Use the Shared table solver.');
  const connections = new Map(
    [...turn.board.connections, ...turn.draft.connections].map((connection) => [
      `${connection.memberId}:${connection.end}`,
      connection,
    ]),
  );
  const nodes = new Map<string, StructuralNode>();
  const supports: StructuralModel['supports'] = [];
  for (const joint of turnJoints(turn)) {
    nodes.set(joint.id, { id: joint.id, position: gridPosition(joint.id) });
    if (joint.foundationOwner) supports.push({ nodeId: joint.id, restrained: [true, true, true, true, true, true] });
  }

  const members: StructuralMember[] = [...turn.board.members, ...turn.draft.members].map((member) => {
    if (member.type === 'spring')
      throw new Error('The contract solvers cannot represent an axial spring printing.');
    const ends = (['a', 'b'] as const).map((side) => {
      const point = side === 'a' ? member.a : member.b;
      const connection = connections.get(`${member.id}:${side}`);
      if (connection) return { node: connection.jointId, fixity: connection.profile === 'ball' ? ('pinned' as const) : ('fixed' as const) };
      const node = `endpoint:${member.id}:${side}`;
      nodes.set(node, { id: node, position: gridPosition(point) });
      return { node, fixity: 'fixed' as const };
    });
    const section = catalogMember(member.type, gridPosition(member.a), gridPosition(member.b));
    const base = { id: String(member.id), startNodeId: ends[0].node, endNodeId: ends[1].node, ...section };
    return member.type === 'cable' ? base : { ...base, startFixity: ends[0].fixity, endFixity: ends[1].fixity };
  });

  const loads: StructuralModel['loads'] = [...turn.board.loads, ...turn.draft.loads].map((load) => ({
    nodeId: load.jointId,
    force: [0, 0, -load.magnitude * NEWTONS_PER_KILONEWTON],
    moment: [0, 0, 0],
  }));

  const notes: string[] = [];
  if (members.some((member) => member.kind === 'cable'))
    notes.push('Every cable carries the prototype catalog pretension, not a per-card value.');
  return {
    model: { units: 'SI', nodes: [...nodes.values()], members, supports, loads, analysis: { fidelity } },
    notes,
  };
}
