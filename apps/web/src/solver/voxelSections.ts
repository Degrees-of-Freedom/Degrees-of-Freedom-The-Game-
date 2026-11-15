import type { VoxelMemberType } from './voxelInput';
export type BeamType = Exclude<VoxelMemberType, 'cable' | 'spring'>;
export type Section = (typeof ITEMS)[VoxelMemberType];
export type BeamSection = (typeof ITEMS)[BeamType];
export const S = 2; // voxel size [m]
/** Provisional cartridge printing. The placed length is the unloaded length.
 * The schematic coil does not determine its printed stiffness. The spring
 * carries axial translation only; a collar needs external lateral restraint.
 * The game assigns no self-weight to this idealized cartridge. */
export const SPRING = {
  stiffnessNPerM: 50000, initialExtensionM: 0, axialForceLimitN: 5000, strokeLimitM: 0.12,
  coilDiameterM: 0.16, wireDiameterM: 0.012, turns: 8,
} as const;
export const ITEMS = {
  spring: {
    kind: 'spring', label: 'Axial spring', sub: 'Two-way · 50 kN/m',
    color: '#a7afba', cost: 100, maxCells: 4, w: 0, shape: 'helix',
    dim: [SPRING.coilDiameterM + SPRING.wireDiameterM, SPRING.coilDiameterM + SPRING.wireDiameterM],
    ...SPRING,
  },
  shs: {
    kind: 'beam',
    label: 'SHS 100×6',
    sub: 'Steel tube S355',
    color: '#a3adb8',
    cost: 120,
    E: 210e6,
    G: 81e6,
    A: 2.24e-3,
    Iy: 3.2e-6,
    Iz: 3.2e-6,
    J: 5.13e-6,
    Wy: 6.4e-5,
    Wz: 6.4e-5,
    Avy: 1.12e-3,
    Avz: 1.12e-3,
    ft: 355e3,
    fc: 355e3,
    fm: 355e3,
    fv: 205e3,
    alpha: 0.21,
    l0: 0.2,
    w: 0.176,
    dim: [0.1, 0.1],
    shape: 'box',
    maxCells: 3,
  },
  glulam: {
    kind: 'beam',
    label: 'Glulam 200×400',
    sub: 'Timber GL24h',
    color: '#c8955a',
    cost: 180,
    E: 11.5e6,
    G: 0.65e6,
    A: 0.08,
    Iy: 1.0667e-3,
    Iz: 2.667e-4,
    J: 7.33e-4,
    Wy: 5.333e-3,
    Wz: 2.667e-3,
    Avy: 0.0533,
    Avz: 0.0533,
    ft: 12.3e3,
    fc: 15.4e3,
    fm: 15.4e3,
    fv: 2.24e3,
    alpha: 0.1,
    l0: 0.3,
    w: 0.34,
    dim: [0.2, 0.4],
    shape: 'box',
    maxCells: 3,
  },
  ipe: {
    kind: 'beam',
    label: 'IPE 300',
    sub: 'Steel I-beam S355',
    color: '#6a8db3',
    cost: 260,
    E: 210e6,
    G: 81e6,
    A: 5.38e-3,
    Iy: 8.356e-5,
    Iz: 6.04e-6,
    J: 2.01e-7,
    Wy: 5.57e-4,
    Wz: 8.05e-5,
    Avy: 3.2e-3,
    Avz: 2.57e-3,
    ft: 355e3,
    fc: 355e3,
    fm: 355e3,
    fv: 205e3,
    alpha: 0.34,
    l0: 0.2,
    w: 0.422,
    dim: [0.15, 0.3],
    shape: 'I',
    maxCells: 3,
  },
  heb: {
    kind: 'beam',
    label: 'HEB 300',
    sub: 'Heavy steel H-section',
    color: '#45617f',
    cost: 620,
    E: 210e6,
    G: 81e6,
    A: 1.49e-2,
    Iy: 2.517e-4,
    Iz: 8.563e-5,
    J: 1.85e-6,
    Wy: 1.678e-3,
    Wz: 5.71e-4,
    Avy: 1.14e-2,
    Avz: 4.74e-3,
    ft: 355e3,
    fc: 355e3,
    fm: 355e3,
    fv: 205e3,
    alpha: 0.49,
    l0: 0.2,
    w: 1.17,
    dim: [0.3, 0.3],
    shape: 'I',
    maxCells: 3,
  },
  cable: {
    kind: 'cable',
    label: 'Cable Ø24',
    sub: 'Tension only · 25 kN pretension',
    color: '#2b2f36',
    cost: 90,
    E: 160e6,
    A: 3.6e-4,
    NRd: 260,
    P0: 25,
    w: 0.03,
    dim: [0.05, 0.05],
    shape: 'box',
    maxCells: 8,
  },
  joint: {
    kind: 'joint',
    label: 'Moment connection',
    sub: 'Rigid + stronger joint',
    color: '#f39c34',
    cost: 80,
  },
  found: {
    kind: 'found',
    label: 'Foundation',
    sub: 'Fixed support on ground',
    color: '#b9b4aa',
    cost: 400,
  },
  load: {
    kind: 'load',
    label: 'Point load 50 kN',
    sub: 'Sandbox live load',
    color: '#ff5a5f',
    cost: 0,
  },
} as const;

/** Dimensions in metres. Sharp-corner display dimensions do not replace the
 * section table's independently specified area, inertia or torsion constant.
 * Wall/web/flange values are provisional printed playtest dimensions. */
export const SECTION_GEOMETRY = {
  spring: {kind: 'helix', coilDiameter: SPRING.coilDiameterM, wireDiameter: SPRING.wireDiameterM},
  shs: { kind: 'rectangular-hollow', width: 0.100, depth: 0.100, wall: 0.006 },
  glulam: { kind: 'solid-rectangle', width: 0.200, depth: 0.400 },
  ipe: { kind: 'wide-flange', width: 0.150, depth: 0.300, web: 0.0071, flange: 0.0107 },
  heb: { kind: 'wide-flange', width: 0.300, depth: 0.300, web: 0.011, flange: 0.019 },
  cable: { kind: 'cable', diameter: 0.024 },
} as const satisfies Record<VoxelMemberType, { kind: string } & Record<string, number | string>>;

/** Resolve one printed physical definition into SI (N, m, Pa). Native voxel
 * moduli/stresses are kN/m²; areas and second moments are already in m²/m⁴.
 * Cable pretension is referenced to the straight, placed length and positive
 * in tension. An unstressed length is not the current deformed cable length. */
export function resolveMemberLaw(type: Exclude<VoxelMemberType, 'spring'>, referenceLengthM: number) {
  if (!Number.isFinite(referenceLengthM) || referenceLengthM <= 0) {
    throw new RangeError('Physical reference length must be finite and positive.');
  }
  const section = ITEMS[type];
  const elasticModulus = section.E * 1000;
  if (section.kind === 'cable') {
    const initialStrain = section.P0 / (section.E * section.A);
    return {
      kind: 'cable' as const, area: section.A, elasticModulus,
      restLength: referenceLengthM / (1 + initialStrain),
    };
  }
  return {
    kind: 'frame' as const, area: section.A, elasticModulus,
    shearModulus: section.G * 1000, iy: section.Iy, iz: section.Iz, torsionConstant: section.J,
  };
}
