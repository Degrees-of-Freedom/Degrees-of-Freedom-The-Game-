import type {
  MemberEndFixity,
  StructuralModel,
} from '@dof/solver-contract';
import { allNodeKeys, CELL_SIZE, parseNodeKey, type GameModel } from './model';
import { resolveMemberLaw } from '../solver/voxelSections';

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
 * - Explicit support masks preserve all six degrees of freedom; a legacy
 *   foundation without a mask restrains all six.
 * - Point loads preserve their selected axis direction.
 *
 * The optional corotational check carries SI section and cable laws. Both
 * service checks use only the explicit point loads on this editor geometry.
 */
export function toStructuralModel(game: GameModel, nonlinear = false): StructuralModelTranslation {
  const directions = { '-Z': [0, 0, -1], '+Z': [0, 0, 1], '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0] } as const;
  const fixityAt = (key: string, cable: boolean): MemberEndFixity =>
    !cable && game.attrs[key]?.joint ? 'fixed' : 'pinned';

  const model: StructuralModel = {
    units: 'SI',
    ...(nonlinear ? { analysis: { type: 'corotational' as const } } : {}),
    nodes: allNodeKeys(game).map((key) => {
      const [i, j, k] = parseNodeKey(key);
      return {
        id: key,
        position: [i * CELL_SIZE, j * CELL_SIZE, k * CELL_SIZE],
      };
    }),
    members: game.members.map((member) => {
      const cable = member.type === 'cable';
      const length = () => {
        const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
        return CELL_SIZE * Math.hypot(...a.map((value, i) => value - b[i]));
      };
      return {
        id: String(member.id),
        startNodeId: member.a,
        endNodeId: member.b,
        startFixity: fixityAt(member.a, cable),
        endFixity: fixityAt(member.b, cable),
        ...(nonlinear ? { law: resolveMemberLaw(member.type, length()) } : {}),
      };
    }),
    supports: [],
    loads: [],
  };
  for (const [key, attrs] of Object.entries(game.attrs)) {
    if (attrs.found)
      model.supports.push({
        nodeId: key,
        restrained: attrs.restraint ? [...attrs.restraint] : [true, true, true, true, true, true],
      });
    if (attrs.load) {
      const [x, y, z] = directions[attrs.loadDirection ?? '-Z'];
      model.loads.push({
        nodeId: key,
        force: [x * attrs.load * NEWTONS_PER_KILONEWTON, y * attrs.load * NEWTONS_PER_KILONEWTON, z * attrs.load * NEWTONS_PER_KILONEWTON],
        moment: [0, 0, 0],
      });
    }
  }

  if (nonlinear) return { model, notes: ['The nonlinear check uses catalogue section properties, reference cable lengths and simultaneous editor point loads. Self-weight and challenge combinations are excluded.'] };
  const notes: string[] = ['The contract check uses point loads only; it does not include self-weight, wind, or voxel member sections.'];
  if (game.members.some((member) => member.type !== 'cable' && !game.attrs[member.a]?.joint && !game.attrs[member.b]?.joint))
    notes.push('The contract solver models members pinned at both ends as axial-only ties, so their bending and torsion differ from the voxel frame model.');
  if (game.members.some((member) => member.type === 'cable'))
    notes.push(
      'Cables are treated as two-way ties here, so a cable that would go slack still counts as a restraint.',
    );
  return { model, notes };
}
