import { z } from 'zod';
import { structuralAnalysisRequestSchema } from './structural-state.js';

const id = z.string().min(1).max(256);
const finite = z.number().finite();
const vector6 = z.tuple([finite, finite, finite, finite, finite, finite]);
const measurement = <T extends z.ZodType>(value: T) => z.discriminatedUnion('validity', [
  z.strictObject({ validity: z.literal('verified'), value }),
  z.strictObject({ validity: z.literal('unverified'), value, reason: id }),
  z.strictObject({ validity: z.literal('unavailable'), reason: id }),
]);
const displacement = measurement(vector6);
const forces = measurement(z.strictObject({ start: vector6, end: vector6 }));
const scalar = measurement(finite.nonnegative());
const limitState = measurement(id);
const failure = measurement(z.discriminatedUnion('state', [z.strictObject({ state: z.literal('none') }), z.strictObject({ state: z.literal('failed'), limitState: id, utilization: finite.nonnegative() })]));
const state = measurement(z.enum(['active', 'slack', 'failed']));
const checks = z.strictObject({
  converged: z.boolean(),
  forceScale: finite.positive(),
  momentScale: finite.positive(),
  normalizedForceResidual: finite.nonnegative(),
  normalizedMomentResidual: finite.nonnegative(),
  forceTolerance: finite.nonnegative(),
  momentTolerance: finite.nonnegative(),
  compatibilityVerified: z.boolean(),
  activeLawsVerified: z.boolean(),
});
function passesChecks(check: z.infer<typeof checks> | undefined): boolean {
  return !!check?.converged && check.compatibilityVerified && check.activeLawsVerified &&
    check.normalizedForceResidual <= check.forceTolerance &&
    check.normalizedMomentResidual <= check.momentTolerance;
}

const component = z.strictObject({
  id, jointIds: z.array(id), endpointIds: z.array(id), memberIds: z.array(id),
  classification: z.enum(['stable', 'marginal', 'unstable', 'unknown']),
  validity: z.enum(['verified', 'unverified', 'unavailable']),
  reasonCodes: z.array(id), checks: checks.optional(),
});
const mode = z.strictObject({
  id, componentId: id,
  validity: z.enum(['verified', 'unverified']), reason: id.optional(),
  // Shapes need not have a unique sign or basis. Values use the indicated IDs.
  jointDisplacements: z.record(id, vector6),
  endpointDisplacements: z.record(id, vector6),
});

/** Immutable run record. Only verified quantities may be used as verified evidence. */
export const structuralAnalysisResultSchema = z.strictObject({
  format: z.literal('dof-analysis-result'), schemaVersion: z.literal(1),
  runId: id,
  purpose: z.enum(['preview', 'turn', 'benchmark']),
  turn: z.strictObject({ matchId: id, turnId: id, playerId: id, rulesVersion: id }).optional(),
  benchmark: z.strictObject({ fixtureId: id, fixtureVersion: id, hardware: id, operatingSystem: id, runtime: id }).optional(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }),
  request: structuralAnalysisRequestSchema,
  // All reported values describe this zero-based load-path stage.
  resultStage: z.number().int().nonnegative(),
  solver: z.strictObject({ id, version: id, adapterId: id, adapterVersion: id, fidelity: id }),
  conventions: z.strictObject({ memberEndForce: id, connectionForce: id, connectionRelativeMotion: id, residualNormalization: id }),
  status: z.enum(['success', 'unstable', 'unresolved', 'unsupported', 'error']),
  reasonCodes: z.array(id), warnings: z.array(z.string()),
  runtimeMs: finite.nonnegative(),
  components: z.array(component),
  joints: z.array(z.strictObject({ jointId: id, componentId: id, displacement })),
  endpoints: z.array(z.strictObject({ endpointId: id, componentId: id, displacement })),
  foundations: z.array(z.strictObject({ foundationId: id, componentId: id, reaction: displacement })),
  members: z.array(z.strictObject({ memberId: id, componentId: id, endForces: forces, utilization: scalar, activeState: state, governingLimitState: limitState.optional(), failure: failure.optional() })),
  connections: z.array(z.strictObject({ connectionId: id, componentId: id, force: displacement, relativeMotion: displacement, utilization: scalar, governingLimitState: limitState.optional(), failure: failure.optional() })),
  modes: z.array(mode),
}).superRefine((result, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message });
  if ((result.purpose === 'turn') !== !!result.turn || (result.purpose === 'benchmark') !== !!result.benchmark) error('Run purpose and context must agree.');
  if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) error('Finish time precedes start time.');
  if (result.resultStage >= result.request.analysis.loadPath.length) error('Result stage is outside the requested load path.');
  const model = result.request.snapshot;
  const jointIds = new Set(model.joints.map((v) => v.id));
  const memberIds = new Set(model.members.map((v) => v.id));
  const endpointIds = new Set(model.members.flatMap((v) => [v.start.id, v.end.id]));
  const foundationIds = new Set(model.foundations.map((v) => v.id));
  const connectionIds = new Set([...model.connections, ...(model.collars ?? [])].map((v) => v.id));
  const components = new Map(result.components.map((v) => [v.id, v]));
  if (components.size !== result.components.length) error('Duplicate component ID.');
  const assignedJoints = new Set<string>(), assignedEnds = new Set<string>(), assignedMembers = new Set<string>();
  for (const c of result.components) {
    for (const [ids, known, assigned] of [[c.jointIds, jointIds, assignedJoints], [c.endpointIds, endpointIds, assignedEnds], [c.memberIds, memberIds, assignedMembers]] as const) {
      for (const objectId of ids) {
        if (!known.has(objectId) || assigned.has(objectId)) error(`Unknown or multiply assigned component object ${objectId}.`);
        assigned.add(objectId);
      }
    }
    for (const memberId of c.memberIds) {
      const member = model.members.find(v => v.id === memberId);
      if (member && (!c.endpointIds.includes(member.start.id) || !c.endpointIds.includes(member.end.id))) error(`Component ${c.id} must include both endpoints of member ${memberId}.`);
    }
    if (c.validity === 'verified' && (c.classification === 'stable' || c.classification === 'marginal') && !passesChecks(c.checks))
      error(`Verified equilibrium classification for ${c.id} requires passing equilibrium and compatibility checks.`);
    if (c.validity === 'verified' && c.classification === 'unknown') error(`Verified component ${c.id} cannot have unknown classification.`);
    if (c.validity === 'unavailable' && c.classification !== 'unknown') error(`Unavailable component ${c.id} must have unknown classification.`);
    if (c.validity !== 'verified' && !c.reasonCodes.length) error(`Component ${c.id} needs a reason code.`);
  }
  const verified = (v: { validity: string }) => v.validity === 'verified';
  const equilibrium = (componentId: string, value: { validity: string }) => {
    const c = components.get(componentId);
    if (!c) { error(`Unknown component ${componentId}.`); return; }
    if (!verified(value)) return;
    // Marginality describes stability reserve. It does not invalidate a checked equilibrium.
    if (c.validity !== 'verified' || (c.classification !== 'stable' && c.classification !== 'marginal') || !passesChecks(c.checks))
      error(`Verified equilibrium quantity requires verified stable or marginal scope and completed checks: ${componentId}.`);
  };
  const unique = new Set<string>();
  const checkEntry = (kind: string, objectId: string, componentId: string, known: Set<string>, belongs: (c: z.infer<typeof component>) => boolean) => {
    const key = `${kind}:${objectId}`, c = components.get(componentId);
    if (!known.has(objectId) || !c || !belongs(c)) error(`${kind} ${objectId} is missing or outside component ${componentId}.`);
    if (unique.has(key)) error(`Duplicate ${kind} result ${objectId}.`);
    unique.add(key);
  };
  for (const j of result.joints) { checkEntry('joint', j.jointId, j.componentId, jointIds, c => c.jointIds.includes(j.jointId)); equilibrium(j.componentId, j.displacement); }
  for (const e of result.endpoints) { checkEntry('endpoint', e.endpointId, e.componentId, endpointIds, c => c.endpointIds.includes(e.endpointId)); equilibrium(e.componentId, e.displacement); }
  for (const f of result.foundations) { const source = model.foundations.find(v => v.id === f.foundationId); checkEntry('foundation', f.foundationId, f.componentId, foundationIds, c => !!source && c.jointIds.includes(source.jointId)); equilibrium(f.componentId, f.reaction); }
  for (const m of result.members) { checkEntry('member', m.memberId, m.componentId, memberIds, c => c.memberIds.includes(m.memberId)); equilibrium(m.componentId, m.endForces); equilibrium(m.componentId, m.utilization); equilibrium(m.componentId, m.activeState); if (m.governingLimitState) equilibrium(m.componentId, m.governingLimitState); if (m.failure) equilibrium(m.componentId, m.failure); }
  for (const x of result.connections) {
    const source = model.connections.find(v => v.id === x.connectionId);
    const collar = model.collars?.find(v => v.id === x.connectionId);
    checkEntry('connection', x.connectionId, x.componentId, connectionIds, c => source
      ? c.endpointIds.includes(source.endpointId) && c.jointIds.includes(source.jointId)
      : !!collar && c.memberIds.includes(collar.source.memberId) && c.jointIds.includes(collar.source.jointId) && c.jointIds.includes(collar.jointId));
    equilibrium(x.componentId, x.force); equilibrium(x.componentId, x.relativeMotion); equilibrium(x.componentId, x.utilization); if (x.governingLimitState) equilibrium(x.componentId, x.governingLimitState); if (x.failure) equilibrium(x.componentId, x.failure);
  }
  const modeIds = new Set<string>();
  for (const m of result.modes) {
    const c = components.get(m.componentId);
    if (!c || modeIds.has(m.id)) error(`Unknown component or duplicate mode ${m.id}.`);
    modeIds.add(m.id);
    if (m.validity === 'unverified' && !m.reason) error(`Unverified mode ${m.id} needs a reason.`);
    if (m.validity === 'verified' && c?.validity !== 'verified') error(`Mode ${m.id} cannot be verified in an unverified component.`);
    for (const key of Object.keys(m.jointDisplacements)) if (!c?.jointIds.includes(key)) error(`Mode ${m.id} references a joint outside its component.`);
    for (const key of Object.keys(m.endpointDisplacements)) if (!c?.endpointIds.includes(key)) error(`Mode ${m.id} references an endpoint outside its component.`);
  }
  if (result.status === 'success' && result.components.some((c) => c.validity === 'verified' && c.classification === 'unstable')) error('A successful run cannot contain a verified unstable component.');
  if ((result.status === 'unsupported' || result.status === 'error' || result.status === 'unresolved') && !result.reasonCodes.length) error('Unresolved, unsupported and error runs need a reason code.');
  if ((result.status === 'unsupported' || result.status === 'error') && (result.components.length || result.joints.length || result.endpoints.length || result.foundations.length || result.members.length || result.connections.length || result.modes.length)) error('Unsupported/error runs cannot include analysis results.');
});

export type StructuralAnalysisResult = z.infer<typeof structuralAnalysisResultSchema>;
export function parseStructuralAnalysisResult(value: unknown): StructuralAnalysisResult {
  return structuralAnalysisResultSchema.parse(value);
}
