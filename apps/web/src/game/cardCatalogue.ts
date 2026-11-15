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
export const CABLE_CATALOGUE = 'shared-table-cables-1' as const;
export const HOLLOW_CATALOGUE = 'shared-table-hollow-1' as const;
export const RELEASE_CATALOGUE = 'grow-dusk-release-1' as const;
export const PLAY_REVISION = 'grow-dusk-play-2' as const;
export const PLAY_SPRING_REFERENCE = {id: 'k0-play-2', stiffnessNPerM: SPRING.stiffnessNPerM,
  unit: 'N/m', source: 'Existing authored axial-spring playtest reference'} as const;
export type ScoredCatalogue = typeof HOLLOW_CATALOGUE | typeof RELEASE_CATALOGUE | typeof SCORED_CATALOGUE | typeof PLANAR_CATALOGUE | typeof TRUSS_CATALOGUE | typeof SPRING_CATALOGUE | typeof JOINT_CATALOGUE | typeof CABLE_CATALOGUE;
export type CatalogueId = typeof LEGACY_CATALOGUE | ScoredCatalogue;
export function isScoredCatalogue(catalogue: unknown): catalogue is ScoredCatalogue {
  return catalogue === HOLLOW_CATALOGUE || catalogue === RELEASE_CATALOGUE || catalogue === SCORED_CATALOGUE || catalogue === PLANAR_CATALOGUE || catalogue === TRUSS_CATALOGUE || catalogue === SPRING_CATALOGUE || catalogue === JOINT_CATALOGUE || catalogue === CABLE_CATALOGUE;
}

const legacyTypes = ['shs', 'glulam', 'ipe', 'heb', 'cable'] as const;
const scoredTypes = ['shs', 'glulam', 'ipe', 'heb'] as const;

/** Plain member names for gameplay. Technical section printings remain in
 * the property inspector; a vertical beam is the same physical member. */
export function memberName(type: MemberType) {
  const names: Record<MemberType, string> = {heb: 'Beam / column', ipe: 'Steel beam', shs: 'Square tube',
    chs: 'Round tube', glulam: 'Timber beam', cable: 'Cable', spring: 'Spring'};
  return names[type];
}

export function memberDeckTypes(catalogue: CatalogueId): readonly (MemberType | AssemblyId)[] {
  if (catalogue === HOLLOW_CATALOGUE) return ['chs','shs'];
  if (catalogue === RELEASE_CATALOGUE) return ['heb', 'cable', 'spring'];
  if (catalogue === CABLE_CATALOGUE) return legacyTypes;
  if (catalogue === SPRING_CATALOGUE) return [...scoredTypes, 'spring'];
  if (catalogue === TRUSS_CATALOGUE) return [...scoredTypes, PLANAR.id, TRICHORD.id];
  if (catalogue === PLANAR_CATALOGUE) return [...scoredTypes, PLANAR.id];
  return catalogue === LEGACY_CATALOGUE ? legacyTypes : scoredTypes;
}

interface Printing {
  definitionId: string;
  definitionVersion: typeof CARD_DEFINITION_VERSION | typeof RELEASE_CATALOGUE | typeof PLAY_REVISION;
  label: string;
}

export type CardDefinition =
  | Printing & { kind: 'element'; type: MemberType; assembly?: AssemblyId; maxSteps: number; springStiffnessNPerM?: number }
  | Printing & { kind: 'load'; magnitude: number }
  | Printing & { kind: 'connection'; profile: keyof typeof CONNECTION_PROFILES; rotationsToLock?: 1 | 2 | 3 };

/** Choices remain relative to global axes for the lifetime of the connection. */
export function connectionChoices(card: Extract<CardDefinition, {kind:'connection'}>): readonly ConnectionProfile[] {
  if (card.rotationsToLock === 1) return ['lock-x', 'lock-y', 'lock-z'];
  if (card.rotationsToLock === 2) return ['lock-xy', 'lock-xz', 'lock-yz'];
  return [card.profile];
}

const printings: CardDefinition[] = [];
for (const type of [...legacyTypes, 'spring', 'chs'] as const) {
  for (const maxSteps of [1, 2, 3, 4]) {
    printings.push({
      definitionId: `element/${type}/axis-${maxSteps}`, definitionVersion: CARD_DEFINITION_VERSION,
      kind: 'element', type, maxSteps, label: `${type === 'spring' ? 'Axial spring' : type.toUpperCase()} · ≤${maxSteps} cells/axis`,
    });
  }
}
export const GRAVITY_CARDS_KN = [5, 10, 20, 50] as const;
for (const maxSteps of [1, 2, 3, 4]) printings.push({
  definitionId: 'element/tension-cable-25/axis-' + maxSteps, definitionVersion: CARD_DEFINITION_VERSION,
  kind: 'element', type: 'cable', maxSteps, label: 'Cable Ø24 · ≤' + maxSteps + ' cells/axis',
});
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

/** Count, reach, section law and strength interactions are pinned by this manifest.
 * Both ordered decks are shuffled by the replayable LCG Fisher–Yates in turns.ts. */
export const RELEASE_MANIFEST = {
  version: RELEASE_CATALOGUE, shuffle: 'fisher-yates-lcg32-1',
  capacity: 'card-strength-1', clash: 'reference-solids-1', springStrokeFraction: 0.10,
  boardMax: [15, 15, 12], setup: [[5, 7, 0], [10, 7, 0]], cellSizeM: 2,
} as const;

function authoredReleaseDecks() {
  const elementsLoads: CardDefinition[] = [], connections: CardDefinition[] = [];
  const version = RELEASE_CATALOGUE;
  const reaches = [5, 5, 7, 10];
  for (const family of ['heb', 'cable', 'spring-quarter', 'spring-half'] as const) {
    for (const maxSteps of family === 'heb' ? [5,5,5,5,7,7,7,7,10,10,10,10] : reaches) {
      const spring = family === 'spring-quarter' || family === 'spring-half';
      const name = family === 'heb' ? 'HEB 300' : family === 'cable' ? 'Cable Ø24' :
        family === 'spring-quarter' ? 'Quarter spring' : 'Half spring';
      elementsLoads.push({ definitionId: `element/${family}/reach-${maxSteps}`, definitionVersion: version,
        kind: 'element', type: spring ? 'spring' : family, maxSteps,
        ...(spring && {springStiffnessNPerM: family === 'spring-quarter' ? 12_500 : 25_000}),
        label: `${name} · ≤${maxSteps} cells` });
    }
  }
  for (const [magnitude, count] of [[5,12],[10,8],[20,4]]) {
    for (let i = 0; i < count; ++i) elementsLoads.push({ kind: 'load', magnitude,
      definitionId: 'gravity/' + magnitude + 'kN', definitionVersion: version, label: magnitude + ' kN down' });
  }
  for (const rotationsToLock of [3, 2, 1] as const) {
    for (let i = 0; i < (rotationsToLock === 3 ? 32 : 8); ++i) connections.push({
      kind: 'connection', rotationsToLock, profile: rotationsToLock === 3 ? 'fixed' : rotationsToLock === 2 ? 'lock-xy' : 'lock-x',
      definitionId: 'connection/lock-' + rotationsToLock, definitionVersion: version,
      label: rotationsToLock === 3 ? 'Fixed connector' : rotationsToLock === 2 ? 'Lock two axes' : 'Lock one axis',
    });
  }
  return [elementsLoads, connections] as const;
}
const releaseDecks = authoredReleaseDecks();
const releaseDefinitions = new Map(releaseDecks.flat().map(card => [card.definitionId, Object.freeze(card)]));

/** The revised mix contains 18 standard members, four cables and two springs.
 * Old release decks and their printed labels remain frozen for exact replay. */
function revisedReleaseDecks() {
  const elements: CardDefinition[] = [];
  const families = [
    ['heb', 'Beam / column', 18], ['cable', 'Cable', 4],
  ] as const;
  for (const [type, name, count] of families) for (let i = 0; i < count; i++) {
    const maxSteps = [5, 5, 7, 10][i % 4];
    elements.push({ kind: 'element', type, maxSteps, definitionVersion: PLAY_REVISION,
      definitionId: `element/${type}/reach-${maxSteps}`, label: `${name} · ≤${maxSteps} cells` });
  }
  for (const [name, factor, family] of [['Quarter spring', 0.25, 'spring-quarter'], ['Half spring', 0.5, 'spring-half']] as const) {
    const stiffness = factor * PLAY_SPRING_REFERENCE.stiffnessNPerM;
    elements.push({ kind: 'element', type: 'spring', maxSteps: 5, springStiffnessNPerM: stiffness,
      definitionVersion: PLAY_REVISION, definitionId: `element/${family}/reach-5`, label: `${name} · ≤5 cells` });
  }
  return [elements, releaseDecks[1].map(card => ({...card, definitionVersion: PLAY_REVISION})),
    releaseDecks[0].filter(card => card.kind === 'load').map(card => ({...card, definitionVersion: PLAY_REVISION}))] as const;
}
const playDecks = revisedReleaseDecks();
const playDefinitions = new Map(playDecks.flat().map(card => [card.definitionId, Object.freeze(card)]));

export function createReleaseDecks(revision?: typeof PLAY_REVISION) {
  const instances = (deck: readonly CardDefinition[], name: string) =>
    deck.map((card, index) => ({ ...card, id: name + '-' + index }));
  if (revision === PLAY_REVISION) return [instances(playDecks[0], 'member'), instances(playDecks[1], 'connector'),
    instances(playDecks[2], 'load')] as const;
  return [instances(releaseDecks[0], 'piece'), instances(releaseDecks[1], 'connector')] as const;
}

/** Unknown or future revisions cannot silently acquire current mechanics. */
export function resolveCardDefinition(definitionId: string, version: string): Readonly<CardDefinition> {
  const definition = version === PLAY_REVISION ? playDefinitions.get(definitionId) : version === RELEASE_CATALOGUE ? releaseDefinitions.get(definitionId) :
    version === CARD_DEFINITION_VERSION ? definitions.get(definitionId) : undefined;
  if (!definition) {
    throw new Error(`Unsupported card definition ${definitionId} at ${version}.`);
  }
  return definition;
}

export function printedCards(index: number, catalogue: CatalogueId) {
  if (catalogue === RELEASE_CATALOGUE) throw new Error('The release uses its finite authored decks.');
  const types = memberDeckTypes(catalogue);
  const type = types[index % types.length];
  // Even-sized catalogues shift the reach after each pass through the families
  // so each family can draw all four reaches. Five-family deals already cycle.
  const rotateReach = catalogue === HOLLOW_CATALOGUE || catalogue === SCORED_CATALOGUE || catalogue === TRUSS_CATALOGUE || catalogue === JOINT_CATALOGUE;
  const reachIndex = rotateReach ? index + Math.floor(index / types.length) : index;
  const maxSteps = 1 + reachIndex % 4;
  const load = GRAVITY_CARDS_KN[index % GRAVITY_CARDS_KN.length];
  const profile = catalogue === JOINT_CATALOGUE ? jointPrintings[index % jointPrintings.length] : index % 2 === 0 ? 'fixed' : 'ball';
  return {
    element: { id: 'element-' + index, ...resolveCardDefinition(`element/${type === 'cable' && catalogue === CABLE_CATALOGUE ? 'tension-cable-25' : type}/axis-${maxSteps}`, CARD_DEFINITION_VERSION) },
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
    if (card.rotationsToLock) return `Locks all translations and ${card.rotationsToLock} of the three ${card.definitionVersion === PLAY_REVISION ? 'member-local' : 'global'} rotational axes. All incoming physical freedoms must match the shared joint.`;
    if (card.profile === 'hinge-diagonal') return 'Allows rotation about the horizontal 45° axis pointing equally along global +X and +Y. All other motions are locked.';
    if (card.profile === 'guided-x') return 'Slides along global X with zero transferred X force. Locks the other five motions.';
    if (card.profile === 'seat-20' || card.profile === 'seat-80') return `Global vertical stiffness is ${card.profile === 'seat-20' ? 20 : 80} MN/m in tension and compression. The other five motions are locked.`;
    if (card.profile === 'semi-rigid') return 'Relative rotation about global Z transfers 8 MN·m per radian. The other five motions are locked.';
    return card.profile === 'ball'
      ? 'Locks three translations and releases three rotations at one end. Existing joint permissions must match.'
      : 'Locks all three translations and rotations at one end. Existing joint permissions must match.';
  }
  const section = ITEMS[card.type];
  if (card.definitionVersion === RELEASE_CATALOGUE || card.definitionVersion === PLAY_REVISION) {
    const reach = `Maximum straight-line reach ${card.maxSteps * S} m (${card.maxSteps} grid units).`;
    if (card.type === 'cable') return 'Cable Ø24 · E 160 GPa, metallic area 360 mm², tensile limit 260 kN. Rest length equals the placed span. Slack carries zero tension. ' + reach;
    if (card.type === 'spring') return `Axial spring · ${card.springStiffnessNPerM! / 1000} kN/m, strength 5 kN, verified stroke within 10% of its placed span. ${reach}`;
    return `${section.label} · ${section.sub}. ${reach}`;
  }
  const reach = `Up to ${card.maxSteps * S} m on each grid axis, including diagonals.`;
  if (card.type === 'chs') return 'CHS 100×6 · steel circular annulus, 100 mm outside diameter and 6 mm wall. Quarter load and connection ports preserve the continuous section. ' + reach;
  if (section.kind === 'spring') return 'Axial spring · 50 kN/m in tension and compression, 5 kN printed limit. The placed span is unloaded. Three sliding collars expose the original quarters. Attached pieces must provide transverse restraint. ' + reach;
  if (card.assembly === TRICHORD.id) return 'Four-panel trichord truss · three SHS 100×6 chords on a 500 mm equilateral triangle. Welded rings and pin-ended diagonals brace all three faces. External tips and 25%, 50% and 75% branch joints lie on the first chord. ' + reach;
  if (card.assembly === PLANAR.id) return 'Four-panel planar truss · 500 mm deep · two continuous SHS 100×6 chords, welded posts and pin-ended alternating diagonals. External connectors fit the lower chord tips. Branch ports lie on its 25%, 50% and 75% joints. ' + reach;
  if (section.kind === 'cable') {
    if (card.definitionId.startsWith('element/tension-cable-25/')) return 'Cable Ø24 · E 160 GPa · metallic area 360 mm² · 260 kN tensile limit. The installed straight length gives 25 kN initial tension between stationary ends. Original quarter clamps retain their share of the material rest length. Slack carries zero force. ' + reach;
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
