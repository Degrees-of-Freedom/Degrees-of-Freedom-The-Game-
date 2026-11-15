import { CONNECTION_PROFILES, connectionLabel, type ConnectionProfile } from './jointFreedom';
import type { MemberType } from './model';
import { ITEMS, S, SECTION_GEOMETRY, SPRING } from '../solver/voxelSections';
import { PLANAR, TRICHORD, type AssemblyId } from './assembly';

/** Changing printed rules or mechanics requires a new version and replay path.
 * An instance ID names one physical card. Its definition ID is shared by all
 * copies of the same printing. A hand or board never owns the definition. */
export const CARD_DEFINITION_VERSION = 'playtest-1' as const;
export const LEGACY_CATALOGUE = 'shared-table-legacy-1' as const;
export const SCORED_CATALOGUE = 'shared-table-frame-1' as const;
export const PLANAR_CATALOGUE = 'shared-table-planar-1' as const;
export const TRUSS_CATALOGUE = 'shared-table-trusses-1' as const;
export const SPRING_CATALOGUE = 'shared-table-springs-1' as const;
export const JOINT_CATALOGUE = 'shared-table-joints-1' as const;
export type ScoredCatalogue = typeof SCORED_CATALOGUE | typeof PLANAR_CATALOGUE | typeof TRUSS_CATALOGUE | typeof SPRING_CATALOGUE | typeof JOINT_CATALOGUE;
export type CatalogueId = typeof LEGACY_CATALOGUE | ScoredCatalogue;
export function isScoredCatalogue(catalogue: unknown): catalogue is ScoredCatalogue {
  return catalogue === SCORED_CATALOGUE || catalogue === PLANAR_CATALOGUE || catalogue === TRUSS_CATALOGUE || catalogue === SPRING_CATALOGUE || catalogue === JOINT_CATALOGUE;
}

const legacyTypes = ['shs', 'glulam', 'ipe', 'heb', 'cable'] as const;
const scoredTypes = ['shs', 'glulam', 'ipe', 'heb'] as const;

export function memberDeckTypes(catalogue: CatalogueId): readonly (MemberType | AssemblyId)[] {
  if (catalogue === SPRING_CATALOGUE) return [...scoredTypes, 'spring'];
  if (catalogue === TRUSS_CATALOGUE) return [...scoredTypes, PLANAR.id, TRICHORD.id];
  if (catalogue === PLANAR_CATALOGUE) return [...scoredTypes, PLANAR.id];
  return catalogue === LEGACY_CATALOGUE ? legacyTypes : scoredTypes;
}

interface Printing {
  definitionId: string;
  definitionVersion: typeof CARD_DEFINITION_VERSION;
  label: string;
}

export type CardDefinition =
  | Printing & { kind: 'element'; type: MemberType; assembly?: AssemblyId; maxSteps: number }
  | Printing & { kind: 'load'; magnitude: number }
  | Printing & { kind: 'connection'; profile: keyof typeof CONNECTION_PROFILES };

const printings: CardDefinition[] = [];
for (const type of [...legacyTypes, 'spring'] as const) {
  for (const maxSteps of [1, 2, 3, 4]) {
    printings.push({
      definitionId: `element/${type}/axis-${maxSteps}`, definitionVersion: CARD_DEFINITION_VERSION,
      kind: 'element', type, maxSteps, label: `${type === 'spring' ? 'Axial spring' : type.toUpperCase()} · ≤${maxSteps} cells/axis`,
    });
  }
}
export const GRAVITY_CARDS_KN = [5, 10, 20, 50] as const;
for (const [assembly, name] of [[PLANAR.id, 'Planar truss'], [TRICHORD.id, 'Trichord truss']] as const) {
  for (const maxSteps of [1, 2, 3, 4]) printings.push({
    definitionId: 'element/' + assembly + '/axis-' + maxSteps, definitionVersion: CARD_DEFINITION_VERSION,
    kind: 'element', type: 'shs', assembly, maxSteps, label: name + ' · ≤' + maxSteps + ' cells/axis',
  });
}
for (const magnitude of GRAVITY_CARDS_KN) {
  printings.push({
    definitionId: `gravity/${magnitude}kN`, definitionVersion: CARD_DEFINITION_VERSION,
    kind: 'load', magnitude, label: `${magnitude} kN down`,
  });
}
const jointPrintings: ConnectionProfile[] = ['fixed', 'ball', 'hinge-diagonal', 'guided-x', 'seat-20', 'seat-80', 'semi-rigid'];
for (const profile of jointPrintings) {
  printings.push({
    definitionId: `connection/${profile}`, definitionVersion: CARD_DEFINITION_VERSION,
    kind: 'connection', profile, label: connectionLabel(profile),
  });
}
const definitions = new Map(printings.map(card => [card.definitionId, Object.freeze(card)] as const));

/** Unknown or future revisions cannot silently acquire current mechanics. */
export function resolveCardDefinition(definitionId: string, version: string): Readonly<CardDefinition> {
  const definition = definitions.get(definitionId);
  if (version !== CARD_DEFINITION_VERSION || !definition) {
    throw new Error(`Unsupported card definition ${definitionId} at ${version}.`);
  }
  return definition;
}

export function printedCards(index: number, catalogue: CatalogueId) {
  const types = memberDeckTypes(catalogue);
  const type = types[index % types.length];
  // Even-sized catalogues shift the reach after each pass through the families
  // so each family can draw all four reaches. Five-family deals already cycle.
  const rotateReach = catalogue === SCORED_CATALOGUE || catalogue === TRUSS_CATALOGUE || catalogue === JOINT_CATALOGUE;
  const reachIndex = rotateReach ? index + Math.floor(index / types.length) : index;
  const maxSteps = 1 + reachIndex % 4;
  const load = GRAVITY_CARDS_KN[index % GRAVITY_CARDS_KN.length];
  const profile = catalogue === JOINT_CATALOGUE ? jointPrintings[index % jointPrintings.length] : index % 2 === 0 ? 'fixed' : 'ball';
  return {
    element: { id: 'element-' + index, ...resolveCardDefinition(`element/${type}/axis-${maxSteps}`, CARD_DEFINITION_VERSION) },
    load: { id: 'load-' + index, ...resolveCardDefinition(`gravity/${load}kN`, CARD_DEFINITION_VERSION) },
    connection: { id: 'connection-' + index, ...resolveCardDefinition(`connection/${profile}`, CARD_DEFINITION_VERSION) },
  };
}

/** Reviewed linear response applies to component/load states that pass the
 * numerical gate. Family membership alone cannot verify a reaction or capacity. */
export function describePrinting(card: CardDefinition): string {
  if (card.kind === 'load') {
    return `One persistent ${card.magnitude} kN force in global −Z at the selected joint.`;
  }
  if (card.kind === 'connection') {
    if (card.profile === 'hinge-diagonal') return 'Allows rotation about the horizontal 45° axis pointing equally along global +X and +Y. All other motions are locked.';
    if (card.profile === 'guided-x') return 'Slides along global X with zero transferred X force. Locks the other five motions.';
    if (card.profile === 'seat-20' || card.profile === 'seat-80') return `Global vertical stiffness is ${card.profile === 'seat-20' ? 20 : 80} MN/m in tension and compression. The other five motions are locked.`;
    if (card.profile === 'semi-rigid') return 'Relative rotation about global Z transfers 8 MN·m per radian. The other five motions are locked.';
    return card.profile === 'ball'
      ? 'Locks three translations and releases three rotations at one end. Existing joint permissions must match.'
      : 'Locks all three translations and rotations at one end. Existing joint permissions must match.';
  }
  const section = ITEMS[card.type];
  const reach = `Up to ${card.maxSteps * S} m on each grid axis, including diagonals.`;
  if (section.kind === 'spring') return 'Axial spring · 50 kN/m in tension and compression, 5 kN printed limit. The placed span is unloaded. Three sliding collars expose the original quarters. Attached pieces must provide transverse restraint. ' + reach;
  if (card.assembly === TRICHORD.id) return 'Four-panel trichord truss · three SHS 100×6 chords on a 500 mm equilateral triangle. Welded rings and pin-ended diagonals brace all three faces. External tips and 25%, 50% and 75% branch joints lie on the first chord. ' + reach;
  if (card.assembly === PLANAR.id) return 'Four-panel planar truss · 500 mm deep · two continuous SHS 100×6 chords, welded posts and pin-ended alternating diagonals. External connectors fit the lower chord tips. Branch ports lie on its 25%, 50% and 75% joints. ' + reach;
  if (section.kind === 'cable') {
    return `${section.label} · E ${section.E / 1e6} GPa · area ${section.A * 1e6} mm². Reference tension ${section.P0} kN. Experimental two-end cable. ${reach}`;
  }
  return `${section.label} · ${section.sub} · E ${section.E / 1e6} GPa · G ${section.G / 1e6} GPa · area ${Math.round(section.A * 1e6)} mm². ${reach}`;
}

/** Provisional geometry and constitutive assumptions awaiting family-specific
 * extraction, quarter-load-transfer and capacity fixtures. None are in a deck.
 * Local Y/Z offsets are in metres. Normalized chord stations refer to the
 * original parent span; exposed assembly ports lie on physical chord joints. */
export const CANDIDATE_FAMILIES = {
  roundHss: {
    id: 'chs-100x6', version: CARD_DEFINITION_VERSION, capability: 'candidate',
    section: { kind: 'round-hollow', outerDiameter: 0.1, wall: 0.006 },
    material: 'S355', ePa: ITEMS.shs.E * 1000, gPa: ITEMS.shs.G * 1000,
  },
  spring: {
    id: 'axial-spring-50', version: CARD_DEFINITION_VERSION, capability: 'candidate',
    ...SPRING,
    law: 'Linear axial extension about the placed rest length, in tension and compression.',
    quarterLaw: 'Four equal series segments of 4k joined at physical guided collars. Transverse supports and collar constraints require validation.',
  },
  planar: {
    id: 'planar-four-panel', version: CARD_DEFINITION_VERSION, capability: 'candidate',
    panels: 4, chordOffsetsYZ: [[0, 0], [0, 0.5]], chordSection: 'shs', webSection: 'shs',
    topology: 'Continuous chords, pin-ended transverse posts at every station, alternating pin-ended diagonals.',
    ports: 'Lower chord joint at each original quarter station.',
  },
  trichord: {
    id: 'triangular-four-panel', version: CARD_DEFINITION_VERSION, capability: 'candidate',
    panels: 4, chordOffsetsYZ: [[0, 0], [0.5, 0], [0.25, Math.sqrt(3) / 4]], chordSection: 'shs', webSection: 'shs',
    topology: 'Continuous chords, triangular rings at all five stations, alternating pin-ended diagonals on each face.',
    ports: 'Joint on first chord at each original quarter station.',
  },
} as const;

export const physicalCatalogue = {
  version: CARD_DEFINITION_VERSION,
  source: 'Existing voxel playtest properties, with provisional nominal section details; SI geometry, right-handed global Z up.',
  geometry: SECTION_GEOMETRY,
  assemblies: { [PLANAR.id]: PLANAR, [TRICHORD.id]: TRICHORD },
  candidates: CANDIDATE_FAMILIES,
} as const;
