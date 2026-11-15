import { z } from 'zod';
import { parseStructuralAnalysisResult, type StructuralAnalysisRequest, type StructuralAnalysisResult, type StructuralModel, type Vector6 } from '@dof/solver-contract';
import { createOpenSeesSolver } from './opensees';

const tuple6 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const capabilitiesSchema = z.object({
  id: z.literal('opensees'), analysis: z.literal('linear-elastic-static'), units: z.literal('SI'),
  memberEndFixities: z.array(z.string()),
  memberProperties: z.object({ elastic_modulus: z.number().finite(), shear_modulus: z.number().finite(), area: z.number().finite(), second_moment: z.number().finite(), torsion_constant: z.number().finite() }),
});
const healthSchema = z.object({ status: z.literal('ok'), service: z.string().min(1), opensees: z.string().min(1) });
const vectorRecord = z.record(z.string(), tuple6);
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), displacements: vectorRecord, warnings: z.array(z.string()), reactions: vectorRecord.optional(), stability: z.object({ stable: z.boolean() }).optional() }),
  z.object({ status: z.literal('unstable'), message: z.string(), warnings: z.array(z.string()), stability: z.object({ stable: z.boolean() }) }),
  z.object({ status: z.literal('unsupported'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);

type Profile = z.infer<typeof capabilitiesSchema>['memberProperties'];
type Context = { runId: string } & (
  | { purpose: 'preview' }
  | { purpose: 'turn'; turn: { matchId: string; turnId: string; playerId: string; rulesVersion: string } }
  | { purpose: 'benchmark'; benchmark: { fixtureId: string; fixtureVersion: string; hardware: string; operatingSystem: string; runtime: string } }
);

/** Exact projection of a deliberately narrow subset; returns an explanation otherwise. */
export function projectOpenSeesRequest(request: StructuralAnalysisRequest, properties: Profile): { ok: true; model: StructuralModel; joints: Map<string, string>; ends: Map<string, string>; pinnedEnds: Set<string> } | { ok: false; reason: string } {
  const snapshot = request.snapshot;
  const unsupported = (reason: string) => ({ ok: false as const, reason });
  if (request.analysis.kind !== 'linear-static' || request.analysis.loadPath.length !== 1) return unsupported('Only a single-stage linear static analysis is supported.');
  const stage = request.analysis.loadPath[0];
  if (stage.selfWeightFactor !== 0) return unsupported('OpenSees does not implement self-weight in this interface.');
  const materials = new Map(snapshot.materials.map(m => [m.id, m]));
  const sections = new Map(snapshot.sections.map(s => [s.id, s]));
  const connections = new Map(snapshot.connections.map(c => [c.endpointId, c]));
  const joints = new Map(snapshot.joints.map((j, index) => [j.id, `j${index}`]));
  const ends = new Map<string, string>();
  const pinnedEnds = new Set<string>();
  const model: StructuralModel = { units: 'SI', nodes: snapshot.joints.map(j => ({ id: joints.get(j.id)!, position: j.position })), members: [], supports: [], loads: [] };
  for (const member of snapshot.members) {
    if (member.state !== 'active' || member.damage?.length || member.family !== 'frame' || (member.initialStrain ?? 0) !== 0) return unsupported(`Member ${member.id}: only undamaged frame members with zero initial strain are supported.`);
    const material = materials.get(member.materialId), section = sections.get(member.sectionId);
    if (!material || !section || material.elasticModulus !== properties.elastic_modulus || material.shearModulus !== properties.shear_modulus || section.area !== properties.area || section.iy !== properties.second_moment || section.iz !== properties.second_moment || section.torsionConstant !== properties.torsion_constant)
      return unsupported(`Member ${member.id}: properties differ from the running OpenSees service.`);
    const fixities: ('fixed' | 'pinned')[] = [];
    for (const end of [member.start, member.end]) {
      const conn = connections.get(end.id);
      if (!conn) {
        const nodeId = `e${ends.size}`;
        ends.set(end.id, nodeId); model.nodes.push({ id: nodeId, position: end.position }); fixities.push('fixed');
        continue;
      }
      if (conn.state !== 'active' || conn.damage?.length) return unsupported(`Connection ${conn.id}: released or damaged connections are not supported.`);
      const kinds = conn.laws.map(l => l.kind);
      const fixed = kinds.every(k => k === 'locked');
      const pinned = kinds.slice(0, 3).every(k => k === 'locked') && kinds.slice(3).every(k => k === 'free');
      if (!fixed && !pinned) return unsupported(`Connection ${conn.id}: only fully fixed or three-axis pin laws are supported.`);
      ends.set(end.id, joints.get(conn.jointId)!); fixities.push(fixed ? 'fixed' : 'pinned');
      if (pinned) pinnedEnds.add(end.id);
    }
    if (fixities.every(f => f === 'pinned')) return unsupported(`Member ${member.id}: OpenSees would substitute an axial truss for a pinned frame.`);
    model.members.push({ id: member.id, startNodeId: ends.get(member.start.id)!, endNodeId: ends.get(member.end.id)!, startFixity: fixities[0], endFixity: fixities[1] });
  }
  if (snapshot.connections.some(c => !ends.has(c.endpointId))) return unsupported('Connection references an unsupported member end.');
  const foundations = new Set<string>();
  for (const f of snapshot.foundations) {
    if (foundations.has(f.jointId)) return unsupported('Multiple foundations on one joint cannot be represented exactly.');
    foundations.add(f.jointId); model.supports.push({ nodeId: joints.get(f.jointId)!, restrained: f.restrained });
  }
  const cases = new Map(snapshot.loadCases.map(c => [c.id, c]));
  const factors = new Map<string, number>();
  for (const caseFactor of stage.factors) for (const load of cases.get(caseFactor.caseId)!.loads) {
    const factor = (factors.get(load.loadId) ?? 0) + caseFactor.factor * load.factor;
    if (!Number.isFinite(factor)) return unsupported(`Load ${load.loadId}: combined factor is not finite.`);
    factors.set(load.loadId, factor);
  }
  const nodeLoads = new Map<string, { force: [number, number, number]; moment: [number, number, number] }>();
  for (const load of snapshot.loads) {
    const factor = factors.get(load.id) ?? 0;
    if (!factor) continue;
    if (load.target.kind === 'endpoint' && pinnedEnds.has(load.target.id) && load.moment.some(v => v !== 0)) return unsupported(`Moment load ${load.id} on a pinned member end cannot be represented exactly.`);
    const nodeId = load.target.kind === 'joint' ? joints.get(load.target.id)! : ends.get(load.target.id)!;
    const scaled = (v: readonly [number, number, number]): [number, number, number] => [v[0] * factor, v[1] * factor, v[2] * factor];
    const force = scaled(load.force), moment = scaled(load.moment);
    if (![...force, ...moment].every(Number.isFinite)) return unsupported(`Load ${load.id}: scaled values are not finite.`);
    const sum: { force: [number, number, number]; moment: [number, number, number] } = nodeLoads.get(nodeId) ?? { force: [0, 0, 0], moment: [0, 0, 0] };
    for (let axis = 0; axis < 3; axis++) { sum.force[axis] += force[axis]; sum.moment[axis] += moment[axis]; }
    if (![...sum.force, ...sum.moment].every(Number.isFinite)) return unsupported(`Combined loads at ${nodeId} are not finite.`);
    nodeLoads.set(nodeId, sum);
  }
  model.loads = [...nodeLoads].map(([nodeId, value]) => ({ nodeId, ...value }));
  return { ok: true, model, joints, ends, pinnedEnds };
}

/** Adapter uses the live service's published properties/version and never upgrades its output to verified. */
export function createStoredOpenSeesAdapter(baseUrl: string, context: Context, fetchImpl: typeof fetch = fetch) {
  const origin = baseUrl.replace(/\/+$/, '');
  return {
    async analyze(request: StructuralAnalysisRequest, signal?: AbortSignal): Promise<StructuralAnalysisResult> {
      const started = new Date(), start = performance.now();
      let version = 'unknown';
      const finish = (status: StructuralAnalysisResult['status'], reason: string, body: Partial<StructuralAnalysisResult> = {}): StructuralAnalysisResult => parseStructuralAnalysisResult({
        format: 'dof-analysis-result', schemaVersion: 1, ...context,
        startedAt: started.toISOString(), finishedAt: new Date().toISOString(), runtimeMs: Math.max(0, performance.now() - start),
        request, resultStage: 0,
        solver: { id: 'opensees', version, adapterId: 'opensees-snapshot', adapterVersion: '1', fidelity: 'linear-static-experimental' },
        conventions: { memberEndForce: 'not-reported', connectionForce: 'not-reported', connectionRelativeMotion: 'not-reported', residualNormalization: 'not-reported' },
        status, reasonCodes: reason ? [reason] : [], warnings: [], components: [], joints: [], endpoints: [], foundations: [], members: [], connections: [], modes: [], ...body,
      });
      try {
        const [capResponse, healthResponse] = await Promise.all([fetchImpl(`${origin}/capabilities`, { signal }), fetchImpl(`${origin}/health`, { signal })]);
        if (!capResponse.ok || !healthResponse.ok) return finish('error', 'capabilities-unavailable');
        const capability = capabilitiesSchema.safeParse(await capResponse.json());
        const health = healthSchema.safeParse(await healthResponse.json());
        if (!capability.success || !health.success || !['fixed', 'pinned'].every(v => capability.data.memberEndFixities.includes(v))) return finish('error', 'unsupported-service-profile');
        version = `${health.data.service}/opensees-${health.data.opensees}`;
        const projected = projectOpenSeesRequest(request, capability.data.memberProperties);
        if (!projected.ok) return finish('unsupported', 'unsupported-input', { warnings: [projected.reason] });
        const result = resultSchema.safeParse(await createOpenSeesSolver(origin, fetchImpl).analyze(projected.model, signal));
        if (!result.success) return finish('error', 'invalid-solver-response');
        const raw = result.data;
        if (raw.status === 'error' || raw.status === 'unsupported') return finish(raw.status, 'solver-outcome', { warnings: [raw.message] });
        const ids = new Set(projected.model.nodes.map(n => n.id));
        if (raw.status === 'success' && [...Object.keys(raw.displacements), ...Object.keys(raw.reactions ?? {})].some(key => !ids.has(key))) return finish('error', 'unknown-result-node');
        const componentId = 'whole-model';
        const classification: 'stable' | 'unstable' | 'unknown' = raw.status === 'unstable' ? 'unstable' : raw.stability?.stable === true ? 'stable' : 'unknown';
        const component = { id: componentId, jointIds: request.snapshot.joints.map(j => j.id), endpointIds: request.snapshot.members.flatMap(m => [m.start.id, m.end.id]), memberIds: request.snapshot.members.map(m => m.id), classification, validity: 'unverified' as const, reasonCodes: ['legacy-whole-model-no-residuals'] };
        const unverified = (value: Vector6) => ({ validity: 'unverified' as const, value: [...value] as [number, number, number, number, number, number], reason: 'Legacy service does not report component equilibrium verification.' });
        const joints = raw.status === 'success' ? request.snapshot.joints.flatMap(j => { const value = raw.displacements[projected.joints.get(j.id)!]; return value ? [{ jointId: j.id, componentId, displacement: unverified(value) }] : []; }) : [];
        const endpoints = raw.status === 'success' ? request.snapshot.members.flatMap(m => [m.start, m.end]).flatMap(e => { const value = raw.displacements[projected.ends.get(e.id)!]; return value && !projected.pinnedEnds.has(e.id) ? [{ endpointId: e.id, componentId, displacement: unverified(value) }] : []; }) : [];
        const foundations = raw.status === 'success' ? request.snapshot.foundations.flatMap(f => { const value = raw.reactions?.[projected.joints.get(f.jointId)!]; return value ? [{ foundationId: f.id, componentId, reaction: unverified(value) }] : []; }) : [];
        return finish(raw.status, '', { components: [component], joints, endpoints, foundations, warnings: [...raw.warnings, 'Experimental OpenSees whole-model result; residuals, per-component verification, mode shapes, end actions and capacity checks are not available.'] });
      } catch (error) {
        if (signal?.aborted) throw error;
        return finish('error', 'service-unavailable', { warnings: [error instanceof Error ? error.message : String(error)] });
      }
    },
  };
}
