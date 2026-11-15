import { z } from 'zod';

/** Versioned solver-neutral reference state. SI units throughout; no solver is implied. */
const id = z.string().min(1).max(256);
const finite = z.number().finite();
const positive = finite.positive();
const vec3 = z.tuple([finite, finite, finite]);
const flags6 = z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean()]);
const capacity = z.strictObject({ name: id, value: positive, unit: z.enum(['N', 'N*m', 'Pa', 'm', 'rad', 'dimensionless']) });
const card = z.strictObject({ instanceId: id, definitionId: id, definitionVersion: id });
const endpoint = z.strictObject({ id, position: vec3 });
// Versioned opaque damage descriptors require a solver that explicitly recognizes them.
const damage = z.strictObject({ definitionId: id, definitionVersion: id, parameters: z.record(id, finite) });
const material = z.strictObject({ id, elasticModulus: positive, shearModulus: positive.optional(), density: positive.optional() });
const section = z.strictObject({ id, area: positive, iy: positive.optional(), iz: positive.optional(), torsionConstant: positive.optional(), capacities: z.array(capacity) });
const memberCommon = {
  id, start: endpoint, end: endpoint, card: card.optional(),
  referenceY: vec3, state: z.enum(['active', 'removed']), damage: z.array(damage).optional(),
};
const member = z.discriminatedUnion('family', [
  z.strictObject({ ...memberCommon, family: z.literal('frame'), materialId: id, sectionId: id, initialStrain: finite.optional() }),
  z.strictObject({ ...memberCommon, family: z.literal('brace'), materialId: id, sectionId: id, initialStrain: finite.optional() }),
  z.strictObject({ ...memberCommon, family: z.literal('cable'), materialId: id, sectionId: id,
    reference: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('restLength'), value: positive }),
      z.strictObject({ kind: z.literal('initialStrain'), value: finite }),
    ]) }),
  // A standalone axial spring is distinct from an elastic connection law.
  z.strictObject({ ...memberCommon, family: z.literal('spring'), axialStiffness: positive, restLength: positive, massPerLength: finite.nonnegative().optional(), capacities: z.array(capacity) }),
]);
const law = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('free') }),
  z.strictObject({ kind: z.literal('locked') }),
  z.strictObject({ kind: z.literal('elastic'), stiffness: positive }),
]);
const connection = z.strictObject({
  id, endpointId: id, jointId: id, card: card.optional(), referenceY: vec3,
  laws: z.tuple([law, law, law, law, law, law]), capacities: z.array(capacity),
  state: z.enum(['active', 'released']), damage: z.array(damage).optional(),
});
/** A through-member collar is separate from that member's two end fittings.
 * This version only supports a fully fixed connection; released collars need
 * a separately implemented relation between the two six-DOF nodes. */
const collar = z.strictObject({
  id, definitionVersion: z.literal('fixed-interior-collar-1'),
  source: z.strictObject({ memberId: id, quarter: z.union([z.literal(1), z.literal(2), z.literal(3)]), jointId: id }),
  jointId: id, card: card.optional(), capacities: z.array(capacity),
  state: z.enum(['active', 'released']),
});
const joint = z.strictObject({ id, position: vec3 });
const foundation = z.strictObject({ id, jointId: id, restrained: flags6, ownerId: id.optional() });
const load = z.strictObject({
  id, target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('joint'), id }),
    z.strictObject({ kind: z.literal('endpoint'), id }),
  ]),
  force: vec3, moment: vec3, persistent: z.boolean(), card: card.optional(),
});
const loadCase = z.strictObject({ id, loads: z.array(z.strictObject({ loadId: id, factor: finite })) });

const rawSnapshot = z.strictObject({
  format: z.literal('dof-structural-state'), schemaVersion: z.literal(1),
  modelId: id, revisionId: id, parentRevisionId: id.optional(),
  units: z.literal('SI'), globalAxes: z.literal('right-handed-z-up'),
  materials: z.array(material), sections: z.array(section), joints: z.array(joint),
  members: z.array(member), connections: z.array(connection), foundations: z.array(foundation),
  collars: z.array(collar).optional(),
  loads: z.array(load), loadCases: z.array(loadCase),
  selfWeight: z.discriminatedUnion('enabled', [
    z.strictObject({ enabled: z.literal(false) }),
    z.strictObject({ enabled: z.literal(true), gravity: vec3 }),
  ]),
});

/** Validation also checks topology without joining equal coordinates implicitly. */
export const structuralSnapshotSchema = rawSnapshot.superRefine((snapshot, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message });
  const unique = <T extends { id: string }>(items: T[], label: string): Map<string, T> => {
    const map = new Map<string, T>();
    for (const item of items) { if (map.has(item.id)) error(`Duplicate ${label} id: ${item.id}`); map.set(item.id, item); }
    return map;
  };
  const materials = unique(snapshot.materials, 'material');
  const sections = unique(snapshot.sections, 'section');
  const joints = unique(snapshot.joints, 'joint');
  const members = unique(snapshot.members, 'member');
  unique([...snapshot.connections, ...(snapshot.collars ?? [])], 'connection');
  unique(snapshot.foundations, 'foundation');
  const loads = unique(snapshot.loads, 'load');
  unique(snapshot.loadCases, 'load case');
  const endpoints = unique(snapshot.members.flatMap((m) => [m.start, m.end]), 'endpoint');
  const cards = new Set<string>();
  for (const item of [...snapshot.members, ...snapshot.connections, ...(snapshot.collars ?? []), ...snapshot.loads]) {
    if (!item.card) continue;
    if (cards.has(item.card.instanceId)) error(`Card instance ${item.card.instanceId} is deployed more than once.`);
    cards.add(item.card.instanceId);
  }
  if (snapshot.parentRevisionId === snapshot.revisionId) error('A revision cannot be its own parent.');
  const attached = new Set<string>();
  const samePoint = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
  const validFrame = (a: number[], b: number[], y: number[]) => {
    const x = b.map((v, i) => v - a[i]);
    const cross = [x[1]*y[2]-x[2]*y[1], x[2]*y[0]-x[0]*y[2], x[0]*y[1]-x[1]*y[0]];
    return Math.hypot(...x) > 0 && Math.hypot(...y) > 0 && Math.hypot(...cross) > 1e-12 * Math.hypot(...x) * Math.hypot(...y);
  };
  for (const m of snapshot.members) {
    if (!validFrame(m.start.position, m.end.position, m.referenceY)) error(`Member ${m.id} has zero length or an invalid reference direction.`);
    if (m.family !== 'spring') {
      const mat = materials.get(m.materialId), sec = sections.get(m.sectionId);
      if (!mat || !sec) error(`Member ${m.id} has a missing material or section.`);
      if (m.family === 'frame' && (!mat?.shearModulus || !sec?.iy || !sec?.iz || !sec?.torsionConstant)) error(`Frame ${m.id} requires G, Iy, Iz and J.`);
      if (snapshot.selfWeight.enabled && !mat?.density && m.state === 'active') error(`Member ${m.id} requires density for self-weight.`);
    } else if (snapshot.selfWeight.enabled && m.state === 'active' && m.massPerLength === undefined) error(`Spring ${m.id} requires mass per length for self-weight.`);
  }
  for (const c of snapshot.connections) {
    const end = endpoints.get(c.endpointId), j = joints.get(c.jointId);
    if (!end || !j) error(`Connection ${c.id} has a missing endpoint or joint.`);
    else if (!samePoint(end.position, j.position)) error(`Connection ${c.id} must attach coincident reference points.`);
    if (attached.has(c.endpointId)) error(`Endpoint ${c.endpointId} has multiple connectors.`);
    attached.add(c.endpointId);
    const owner = snapshot.members.find((m) => m.start.id === c.endpointId || m.end.id === c.endpointId);
    if (owner && !validFrame(owner.start.position, owner.end.position, c.referenceY)) error(`Connection ${c.id} has an invalid reference direction.`);
  }
  const collarSources = new Set<string>();
  for (const c of snapshot.collars ?? []) {
    const parent = members.get(c.source.memberId), source = joints.get(c.source.jointId), target = joints.get(c.jointId);
    const key = `${c.source.memberId}:${c.source.quarter}`;
    if (!parent || parent.family !== 'frame' || !source || !target)
      error(`Collar ${c.id} needs a frame source and existing source and target joints.`);
    else {
      const point = parent.start.position.map((v, i) => v + (parent.end.position[i] - v) * c.source.quarter / 4);
      if (!samePoint(point, source.position) || !samePoint(point, target.position))
        error(`Collar ${c.id} must join its exact original station to a coincident target.`);
    }
    if (collarSources.has(key)) error(`Original member port ${key} has multiple collars.`);
    collarSources.add(key);
  }
  for (const f of snapshot.foundations) if (!joints.has(f.jointId)) error(`Foundation ${f.id} has a missing joint.`);
  for (const l of snapshot.loads) if (!(l.target.kind === 'joint' ? joints : endpoints).has(l.target.id)) error(`Load ${l.id} has a missing target.`);
  for (const lc of snapshot.loadCases) {
    const ids = new Set<string>();
    for (const item of lc.loads) {
      if (!loads.has(item.loadId)) error(`Load case ${lc.id} references a missing load.`);
      if (ids.has(item.loadId)) error(`Load case ${lc.id} repeats load ${item.loadId}.`);
      ids.add(item.loadId);
    }
  }
});

export type StructuralSnapshot = z.infer<typeof structuralSnapshotSchema>;
/** Parse untrusted JSON into a detached, validated analytical state. */
export function parseStructuralSnapshot(value: unknown): StructuralSnapshot {
  return structuralSnapshotSchema.parse(value);
}

/** An explicit analysis request; adapters must reject unsupported options and features. */
export const structuralAnalysisRequestSchema = z.strictObject({
  requestVersion: z.literal(1),
  snapshot: structuralSnapshotSchema,
  analysis: z.strictObject({
    kind: z.enum(['linear-static', 'geometric-nonlinear-static']),
    // Each ordered stage specifies absolute factors for all active cases.
    loadPath: z.array(z.strictObject({ selfWeightFactor: finite, factors: z.array(z.strictObject({ caseId: id, factor: finite })) })).min(1),
  }),
}).superRefine((request, ctx) => {
  const cases = new Set(request.snapshot.loadCases.map((c) => c.id));
  for (const step of request.analysis.loadPath) {
    if (!request.snapshot.selfWeight.enabled && step.selfWeightFactor !== 0) ctx.addIssue({ code: 'custom', message: 'Self-weight is disabled in this snapshot.' });
    const seen = new Set<string>();
    for (const factor of step.factors) {
      if (!cases.has(factor.caseId) || seen.has(factor.caseId)) ctx.addIssue({ code: 'custom', message: `Missing or duplicate load case ${factor.caseId}.` });
      seen.add(factor.caseId);
    }
  }
});
export type StructuralAnalysisRequest = z.infer<typeof structuralAnalysisRequestSchema>;
export function parseStructuralAnalysisRequest(value: unknown): StructuralAnalysisRequest {
  return structuralAnalysisRequestSchema.parse(value);
}
