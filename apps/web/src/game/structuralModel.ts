import type {
  MemberEndFixity,
  StructuralModel,
} from '@dof/solver-contract';
import { allNodeKeys, CELL_SIZE, parseNodeKey, type GameModel } from './model';

/** Game point loads are stored in kN; the contract uses newtons. */
const NEWTONS_PER_KILONEWTON = 1e3;

export interface StructuralModelTranslation {
  model: StructuralModel;
  /** What the shared contract could not express about this game model. */
  notes: string[];
}

/**
 * Translate the voxel game model to the shared solver contract.
 *
 * The translation carries what decides kinematic stability: geometry,
 * connectivity, connection type and supports. It follows the game's rules:
 *
 * - Node ids are grid keys; positions are grid indices times the cell size,
 *   with Z vertical.
 * - A member end is rigid where its node has a moment connection (`joint`)
 *   and pinned elsewhere. Cables are pinned at both ends.
 * - A foundation restrains all six degrees of freedom.
 * - Point loads placed on nodes act downwards.
 *
 * It does not carry member sections, self-weight, wind, or the tower and
 * bridge level loads that the voxel analysis generates, and the contract has
 * no tension-only member. Results from a contract solver are therefore a
 * stability and determinacy check, not a replacement for the voxel analysis.
 */
export function toStructuralModel(game: GameModel): StructuralModelTranslation {
  const fixityAt = (key: string, cable: boolean): MemberEndFixity =>
    !cable && game.attrs[key]?.joint ? 'fixed' : 'pinned';

  const model: StructuralModel = {
    units: 'SI',
    nodes: allNodeKeys(game).map((key) => {
      const [i, j, k] = parseNodeKey(key);
      return {
        id: key,
        position: [i * CELL_SIZE, j * CELL_SIZE, k * CELL_SIZE],
      };
    }),
    members: game.members.map((member) => {
      const cable = member.type === 'cable';
      return {
        id: String(member.id),
        startNodeId: member.a,
        endNodeId: member.b,
        startFixity: fixityAt(member.a, cable),
        endFixity: fixityAt(member.b, cable),
      };
    }),
    supports: [],
    loads: [],
  };
  for (const [key, attrs] of Object.entries(game.attrs)) {
    if (attrs.found)
      model.supports.push({
        nodeId: key,
        restrained: [true, true, true, true, true, true],
      });
    if (attrs.load)
      model.loads.push({
        nodeId: key,
        force: [0, 0, -attrs.load * NEWTONS_PER_KILONEWTON],
        moment: [0, 0, 0],
      });
  }

  const notes: string[] = [];
  if (game.members.some((member) => member.type === 'cable'))
    notes.push(
      'Cables are treated as two-way ties here, so a cable that would go slack still counts as a restraint.',
    );
  return { model, notes };
}
