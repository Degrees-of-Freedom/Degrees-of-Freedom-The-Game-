import { CONNECTION_PROFILES } from './jointFreedom';
import type { MemberType } from './model';
import { ITEMS, S, SECTION_GEOMETRY } from '../solver/voxelSections';

/** Changing printed rules or mechanics requires a new version and replay path.
 * An instance ID names one physical card. Its definition ID is shared by all
 * copies of the same printing. A hand or board never owns the definition. */
export const CARD_DEFINITION_VERSION = 'playtest-1' as const;
export const LEGACY_CATALOGUE = 'shared-table-legacy-1' as const;
export const SCORED_CATALOGUE = 'shared-table-frame-1' as const;
export type CatalogueId = typeof LEGACY_CATALOGUE | typeof SCORED_CATALOGUE;

const legacyTypes = ['shs', 'glulam', 'ipe', 'heb', 'cable'] as const;
const scoredTypes = ['shs', 'glulam', 'ipe', 'heb'] as const;

export function memberDeckTypes(catalogue: CatalogueId): readonly MemberType[] {
  return catalogue === SCORED_CATALOGUE ? scoredTypes : legacyTypes;
}

interface Printing {
  definitionId: string;
  definitionVersion: typeof CARD_DEFINITION_VERSION;
  label: string;
}

export type CardDefinition =
  | Printing & { kind: 'element'; type: MemberType; maxSteps: number }
  | Printing & { kind: 'load'; magnitude: number }
  | Printing & { kind: 'connection'; profile: keyof typeof CONNECTION_PROFILES };

const printings: CardDefinition[] = [];
for (const type of legacyTypes) {
  for (const maxSteps of [1, 2, 3, 4]) {
    printings.push({
      definitionId: `element/${type}/axis-${maxSteps}`, definitionVersion: CARD_DEFINITION_VERSION,
      kind: 'element', type, maxSteps, label: `${type.toUpperCase()} · ≤${maxSteps} cells/axis`,
    });
  }
}
export const GRAVITY_CARDS_KN = [5, 10, 20, 50] as const;
for (const magnitude of GRAVITY_CARDS_KN) {
  printings.push({
    definitionId: `gravity/${magnitude}kN`, definitionVersion: CARD_DEFINITION_VERSION,
    kind: 'load', magnitude, label: `${magnitude} kN down`,
  });
}
for (const profile of ['fixed', 'ball'] as const) {
  printings.push({
    definitionId: `connection/${profile}`, definitionVersion: CARD_DEFINITION_VERSION,
    kind: 'connection', profile, label: profile === 'fixed' ? 'Fixed / moment' : 'Ball joint',
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
  // Shift the reach once per four-card block in the scored deck so each of
  // its four families is dealt at all four printed reaches. Legacy shuffling
  // retains the original five-family pattern and all its instance identities.
  const reachIndex = catalogue === SCORED_CATALOGUE ? index + Math.floor(index / types.length) : index;
  const maxSteps = 1 + reachIndex % 4;
  const load = GRAVITY_CARDS_KN[index % GRAVITY_CARDS_KN.length];
  const profile = index % 2 === 0 ? 'fixed' : 'ball';
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
    return card.profile === 'ball'
      ? 'Locks three translations and releases three rotations at one end. Existing joint permissions must match.'
      : 'Locks all three translations and rotations at one end. Existing joint permissions must match.';
  }
  const section = ITEMS[card.type];
  const reach = `Up to ${card.maxSteps * S} m on each grid axis, including diagonals.`;
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
    stiffnessNPerM: 50000, initialExtensionM: 0, axialForceLimitN: 5000,
    coilDiameterM: 0.16, wireDiameterM: 0.012, turns: 8,
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
  candidates: CANDIDATE_FAMILIES,
} as const;
