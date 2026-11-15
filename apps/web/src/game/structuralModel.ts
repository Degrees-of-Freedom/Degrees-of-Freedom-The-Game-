import type {
  AnalysisFidelity,
  MemberEndConnection,
  MemberProperties,
  StructuralMember,
  StructuralModel,
  Vector3,
} from '@dof/solver-contract';
import { ITEMS, type BeamSection } from '../solver/voxelSections';
import { allNodeKeys, CELL_SIZE, parseNodeKey, type GameModel, type LoadDirection, type Member } from './model';

/** Game point loads are stored in kN; the contract uses newtons. */
const NEWTONS_PER_KILONEWTON = 1e3;
/** Unit vector of each selectable point-load direction, in global axes. */
const LOAD_DIRECTIONS: Record<LoadDirection, Vector3> = {
  '-Z': [0, 0, -1], '+Z': [0, 0, 1], '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0],
};
/**
 * The voxel catalog states stiffness in kN/m^2 (E, G), force in kN (P0) and
 * weight in kN/m; the contract is SI. 1 kN/m^2 = 1e3 Pa and 1 kN/m = 1e3 N/m,
 * so those convert by multiplying by 1e3. Areas (m^2) and second moments
 * (m^4) already agree.
 */
const SI_PER_KILONEWTON_UNIT = NEWTONS_PER_KILONEWTON;

/** Same threshold the voxel solver uses to call a member vertical (frameMath.localAxes). */
const VERTICAL_MEMBER = 0.999;

/** Shear modulus of steel in Pa. Cables carry axial force only, so it is never used. */
const CABLE_PLACEHOLDER_SHEAR_MODULUS = 81e9;

/** Moment connection: all six local axes locked. */
const FIXED_END: MemberEndConnection = { laws: ['locked', 'locked', 'locked', 'locked', 'locked', 'locked'] };
/**
 * The voxel rule for a member end without a moment connection
 * (frameElement.ts releases dofs 4, 5, 10, 11): translations and torsion stay
 * locked, both bending rotations are free. This is not the contract's
 * `pinned` shorthand, which frees torsion as well.
 */
const BENDING_RELEASED_END: MemberEndConnection = { laws: ['locked', 'locked', 'locked', 'locked', 'free', 'free'] };

export interface StructuralModelTranslation {
  model: StructuralModel;
  /** What the shared contract or this translation does not carry about this game model. */
  notes: string[];
}

const beamProperties = (section: BeamSection): MemberProperties => ({
  elasticModulus: section.E * SI_PER_KILONEWTON_UNIT,
  shearModulus: section.G * SI_PER_KILONEWTON_UNIT,
  area: section.A,
  inertiaY: section.Iy,
  inertiaZ: section.Iz,
  torsionConstant: section.J,
  weightPerLength: section.w * SI_PER_KILONEWTON_UNIT,
});

/**
 * Cables are axial only; the contract still requires a full property set, so
 * bending and torsion values are those of a solid round bar of the same area
 * (I = A^2 / 4 pi, J = 2 I). They are ignored for cables.
 */
function cableProperties(): MemberProperties {
  const { E, A, w } = ITEMS.cable;
  const inertia = (A * A) / (4 * Math.PI);
  return {
    elasticModulus: E * SI_PER_KILONEWTON_UNIT,
    shearModulus: CABLE_PLACEHOLDER_SHEAR_MODULUS,
    area: A,
    inertiaY: inertia,
    inertiaZ: inertia,
    torsionConstant: 2 * inertia,
    weightPerLength: w * SI_PER_KILONEWTON_UNIT,
  };
}

/**
 * Local Y the way the voxel solver builds it (frameMath.localAxes): Z x ex
 * for ordinary members, which is horizontal, and global Y for vertical ones.
 * The contract takes Y as the part of `orientation` perpendicular to the
 * member, so passing that vector reproduces the voxel axes. Local Z = X x Y
 * in both.
 */
function voxelLocalY(a: Vector3, b: Vector3): Vector3 {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  if (Math.abs(d[2] / length) > VERTICAL_MEMBER) return [0, 1, 0];
  // (0,0,1) x d = (-dy, dx, 0)
  return [-d[1], d[0], 0];
}

/**
 * Contract fields that describe one catalog member between two points: its
 * kind, resolved SI properties, local axes and, for cables, the catalog
 * pretension as initial strain. Connections are the caller's business.
 */
export function catalogMember(
  type: Member['type'],
  start: Vector3,
  end: Vector3,
): Pick<StructuralMember, 'kind' | 'properties' | 'orientation' | 'initialStrain'> {
  if (type === 'cable') {
    const { E, A, P0 } = ITEMS.cable;
    return { kind: 'cable', properties: cableProperties(), initialStrain: P0 / (E * A) };
  }
  return { kind: 'beam', properties: beamProperties(ITEMS[type]), orientation: voxelLocalY(start, end) };
}

/** Grid key to contract position in metres. */
export function gridPosition(key: string): Vector3 {
  const [i, j, k] = parseNodeKey(key);
  return [i * CELL_SIZE, j * CELL_SIZE, k * CELL_SIZE];
}

export interface TranslationOptions {
  /** Contract analysis fidelity, always written to the model. Defaults to `nonlinear`. */
  fidelity?: AnalysisFidelity;
}

/**
 * Translate the voxel game model to the shared solver contract.
 *
 * - Node ids are grid keys; positions are grid indices times the cell size,
 *   with Z vertical.
 * - Cables are `cable` members, tension-only. Their pretension (P0 in kN) is
 *   sent as initial strain P0 / (E A): E in kN/m^2 times A in m^2 is kN, so
 *   the ratio is dimensionless and needs no conversion.
 * - Other members are `beam`s with catalog sections in SI and the voxel local
 *   axes as `orientation`. Catalog Iy is the second moment about local Y
 *   (frameMath.frameK bends in the local XZ plane with Iy), and Iz in XY.
 * - A non-cable member end is `fixed` where its node has a moment connection
 *   (`joint`); otherwise translations and torsion stay locked and both bending
 *   rotations are free, exactly as the voxel solver condenses them.
 *   Cable ends are axial, so rotational laws mean nothing to them.
 * - A foundation restrains all six degrees of freedom unless it carries an
 *   explicit restraint mask, which is passed through unchanged.
 * - Point loads act along their selected axis, -Z when none is selected.
 *
 * `analysis.fidelity` is always set explicitly (nonlinear unless the caller
 * asks for linear); self-weight stays off. The model carries no `version`: the game has no model
 * revision at this layer.
 */
export function toStructuralModel(
  game: GameModel,
  options: TranslationOptions = {},
): StructuralModelTranslation {
  const positions = new Map<string, Vector3>();
  const nodes = allNodeKeys(game).map((key) => {
    const position = gridPosition(key);
    positions.set(key, position);
    return { id: key, position };
  });

  const endAt = (key: string): MemberEndConnection =>
    game.attrs[key]?.joint ? FIXED_END : BENDING_RELEASED_END;

  const translateMember = (member: Member): StructuralMember => {
    const base = { id: String(member.id), startNodeId: member.a, endNodeId: member.b };
    const section = catalogMember(member.type, positions.get(member.a) ?? gridPosition(member.a), positions.get(member.b) ?? gridPosition(member.b));
    if (member.type === 'cable') return { ...base, ...section };
    return { ...base, ...section, startConnection: endAt(member.a), endConnection: endAt(member.b) };
  };

  const model: StructuralModel = {
    units: 'SI',
    nodes,
    members: game.members.map(translateMember),
    supports: [],
    loads: [],
    analysis: { fidelity: options.fidelity ?? 'nonlinear' },
  };
  for (const [key, attrs] of Object.entries(game.attrs)) {
    if (attrs.found)
      model.supports.push({
        nodeId: key,
        restrained: attrs.restraint ? [...attrs.restraint] : [true, true, true, true, true, true],
      });
    if (attrs.load) {
      const newtons = attrs.load * NEWTONS_PER_KILONEWTON;
      const [x, y, z] = LOAD_DIRECTIONS[attrs.loadDirection ?? '-Z'];
      model.loads.push({
        nodeId: key,
        force: [x * newtons, y * newtons, z * newtons],
        moment: [0, 0, 0],
      });
    }
  }

  const notes: string[] = [
    'Wind, the tower and bridge loads the game generates, and load combinations are not sent, and self-weight is not applied, so this checks the structure under the point loads you placed.',
  ];
  // The turn criteria say a cable card must define its own pretension. The
  // voxel catalog has one value for every cable, so that is what is sent, and
  // the reader is told.
  if (game.members.some((member) => member.type === 'cable'))
    notes.push(
      `Every cable is sent with the same ${ITEMS.cable.P0} kN pretension, taken from the prototype catalog, not from a per-cable value.`,
    );
  return { model, notes };
}
