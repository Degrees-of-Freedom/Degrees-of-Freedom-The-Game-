import { z } from 'zod';
import { parseStructuralAnalysisResult, type MemberEndConnection, type MemberEndFixity, type MemberKind, type MemberProperties, type StructuralAnalysisRequest, type StructuralAnalysisResult, type StructuralMember, type StructuralModel, type Vector6 } from '@dof/solver-contract';
import { createOpenSeesSolver } from './opensees';

const finite = z.number().finite();
const tuple6 = z.tuple([finite, finite, finite, finite, finite, finite]);
const names = z.array(z.string());
/** What `GET /capabilities` of the v2 service returns; only the fields the adapter relies on are checked. */
const capabilitiesSchema = z.object({
  id: z.literal('opensees'), units: z.literal('SI'),
  fidelities: names, memberKinds: z.record(z.string(), z.string()),
  connectionLaws: names, connectionShorthands: names, initialStrain: names, loads: names, results: names,
  defaultMemberProperties: z.object({ shearModulus: finite.positive(), inertiaY: finite.positive(), inertiaZ: finite.positive(), torsionConstant: finite.positive() }),
  limits: z.object({ maxNodes: finite, maxMembers: finite }),
});
export type OpenSeesCapabilities = z.infer<typeof capabilitiesSchema>;
const healthSchema = z.object({ status: z.literal('ok'), service: z.string().min(1), opensees: z.string().min(1) });

const vectorRecord = z.record(z.string(), tuple6);
const stabilityReport = z.object({
  stable: z.boolean(), freeDofs: finite, mechanisms: finite, translationalMechanisms: finite, rotationalMechanisms: finite, staticIndeterminacy: finite,
  unstableNodeIds: names, modes: z.array(z.object({ kind: z.enum(['translation', 'rotation']), displacements: vectorRecord })),
});
const componentSchema = z.object({
  id: z.string().min(1), nodeIds: names, memberIds: names, state: z.enum(['stable', 'marginal', 'unstable', 'unknown']),
  reasonCodes: names, resultsValid: z.boolean(), stability: stabilityReport,
});
const body = {
  analysis: z.object({ modelVersion: z.string().optional(), fidelity: z.enum(['linear', 'nonlinear']), solver: z.string(), runtimeMs: finite, reasonCodes: names }),
  components: z.array(componentSchema), displacements: vectorRecord, reactions: vectorRecord,
  memberForces: z.record(z.string(), z.object({ axial: finite, shear: finite, torsion: finite, momentStart: finite, momentEnd: finite })),
  stability: stabilityReport, warnings: names,
};
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), ...body }),
  z.object({ status: z.literal('unstable'), message: z.string(), ...body }),
  z.object({ status: z.literal('unresolved'), message: z.string(), ...body }),
  z.object({ status: z.literal('unsupported'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
type ServiceComponent = z.infer<typeof componentSchema>;

type Context = { runId: string } & (
  | { purpose: 'preview' }
  | { purpose: 'turn'; turn: { matchId: string; turnId: string; playerId: string; rulesVersion: string } }
  | { purpose: 'benchmark'; benchmark: { fixtureId: string; fixtureVersion: string; hardware: string; operatingSystem: string; runtime: string } }
);

export type OpenSeesProjection = {
  ok: true; model: StructuralModel;
  /** Snapshot joint id to service node id. */
  joints: Map<string, string>;
  /** Snapshot endpoint id to the service node it is placed on (the joint node when connected). */
  ends: Map<string, string>;
  /** Service nodes that exist only for an unconnected member end, mapped to that endpoint. */
  ownNodes: Map<string, string>;
  /** Endpoints whose own motion equals the full six-component motion of their service node. */
  rigidEnds: Set<string>;
};

type End = { nodeId: string; fixity?: MemberEndFixity; connection?: MemberEndConnection; carriesForce: boolean; carriesMoment: boolean; rigid: boolean };

const unit = (v: readonly number[]) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
/** Local Y of a member or connection: the normalised part of `referenceY` perpendicular to the member axis. */
function localY(start: readonly number[], end: readonly number[], referenceY: readonly number[]) {
  const x = unit([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
  const dot = referenceY[0] * x[0] + referenceY[1] * x[1] + referenceY[2] * x[2];
  return unit([referenceY[0] - dot * x[0], referenceY[1] - dot * x[1], referenceY[2] - dot * x[2]]);
}

/**
 * Exact projection of the part of the stored format the v2 service can express; returns an explanation otherwise.
 * Nothing is rounded, defaulted or approximated: a feature that cannot be sent exactly is refused.
 */
export function projectOpenSeesRequest(request: StructuralAnalysisRequest, capabilities: OpenSeesCapabilities): OpenSeesProjection | { ok: false; reason: string } {
  const snapshot = request.snapshot;
  const unsupported = (reason: string) => ({ ok: false as const, reason });
  if (request.analysis.kind !== 'linear-static' || request.analysis.loadPath.length !== 1) return unsupported('Only a single-stage linear static analysis is supported.');
  if (!capabilities.fidelities.includes('linear')) return unsupported('The OpenSees service does not offer linear fidelity.');
  const stage = request.analysis.loadPath[0];
  const selfWeight = stage.selfWeightFactor !== 0;
  let gravity = 0;
  if (selfWeight) {
    if (!capabilities.loads.includes('self-weight')) return unsupported('The OpenSees service does not offer self-weight.');
    const g = snapshot.selfWeight.enabled ? snapshot.selfWeight.gravity : undefined;
    if (!g || g[0] !== 0 || g[1] !== 0 || !(g[2] < 0)) return unsupported('OpenSees applies self-weight along -Z only; gravity in any other direction cannot be represented exactly.');
    if (!(stage.selfWeightFactor > 0)) return unsupported('A negative self-weight factor cannot be represented.');
    gravity = -g[2] * stage.selfWeightFactor;
  }
  const materials = new Map(snapshot.materials.map(m => [m.id, m]));
  const sections = new Map(snapshot.sections.map(s => [s.id, s]));
  const connections = new Map(snapshot.connections.map(c => [c.endpointId, c]));
  const joints = new Map(snapshot.joints.map((j, index) => [j.id, `j${index}`]));
  const ends = new Map<string, string>();
  const ownNodes = new Map<string, string>();
  const rigidEnds = new Set<string>();
  const endInfo = new Map<string, End>();
  const defaults = capabilities.defaultMemberProperties;
  const model: StructuralModel = { units: 'SI', version: snapshot.revisionId, nodes: snapshot.joints.map(j => ({ id: joints.get(j.id)!, position: j.position })), members: [], supports: [], loads: [], analysis: { fidelity: 'linear', selfWeight } };
  for (const member of snapshot.members) {
    if (member.state !== 'active' || member.damage?.length) return unsupported(`Member ${member.id}: removed or damaged members are not supported.`);
    if (member.family === 'spring') return unsupported(`Member ${member.id}: standalone axial springs are not supported.`);
    const kind: MemberKind = member.family === 'frame' ? 'beam' : member.family;
    if (!(kind in capabilities.memberKinds)) return unsupported(`Member ${member.id}: the OpenSees service does not offer ${kind} members.`);
    const axial = kind !== 'beam';
    const length = Math.hypot(member.end.position[0] - member.start.position[0], member.end.position[1] - member.start.position[1], member.end.position[2] - member.start.position[2]);
    let initialStrain = 0;
    if (member.family === 'cable') initialStrain = member.reference.kind === 'initialStrain' ? member.reference.value : length / member.reference.value - 1;
    else initialStrain = member.initialStrain ?? 0;
    if (!Number.isFinite(initialStrain)) return unsupported(`Member ${member.id}: initial strain is not finite.`);
    if (initialStrain !== 0 && !capabilities.initialStrain.includes(kind)) return unsupported(`Member ${member.id}: the OpenSees service does not accept initial strain on a ${kind}.`);
    const material = materials.get(member.materialId), section = sections.get(member.sectionId);
    if (!material || !section) return unsupported(`Member ${member.id}: missing material or section.`);
    // Shear modulus, inertias and torsion constant are used by beams only; an axial member carries the service's own filler values.
    const properties: MemberProperties = {
      elasticModulus: material.elasticModulus, shearModulus: material.shearModulus ?? defaults.shearModulus, area: section.area,
      inertiaY: section.iy ?? defaults.inertiaY, inertiaZ: section.iz ?? defaults.inertiaZ, torsionConstant: section.torsionConstant ?? defaults.torsionConstant,
    };
    if (selfWeight) {
      if (!material.density) return unsupported(`Member ${member.id}: self-weight needs a material density.`);
      properties.weightPerLength = material.density * section.area * gravity;
      if (!Number.isFinite(properties.weightPerLength)) return unsupported(`Member ${member.id}: self-weight is not finite.`);
    }
    const memberY = localY(member.start.position, member.end.position, member.referenceY);
    const sides: End[] = [];
    for (const end of [member.start, member.end]) {
      const conn = connections.get(end.id);
      if (!conn) {
        const nodeId = `e${ends.size}`;
        ends.set(end.id, nodeId); ownNodes.set(nodeId, end.id); model.nodes.push({ id: nodeId, position: end.position });
        sides.push({ nodeId, fixity: axial ? 'pinned' : 'fixed', carriesForce: true, carriesMoment: !axial, rigid: !axial });
        continue;
      }
      if (conn.state !== 'active' || conn.damage?.length) return unsupported(`Connection ${conn.id}: released or damaged connections are not supported.`);
      const kinds = conn.laws.map(l => l.kind);
      const translationsLocked = kinds.slice(0, 3).every(k => k === 'locked');
      const allLocked = kinds.every(k => k === 'locked');
      const nodeId = joints.get(conn.jointId)!;
      ends.set(end.id, nodeId);
      if (axial) {
        if (!translationsLocked) return unsupported(`Connection ${conn.id}: a ${kind} end must lock all three translations; rotational laws mean nothing to it.`);
        sides.push({ nodeId, fixity: 'pinned', carriesForce: true, carriesMoment: false, rigid: false });
        continue;
      }
      const side: End = { nodeId, carriesForce: translationsLocked, carriesMoment: allLocked, rigid: allLocked };
      if (allLocked) side.fixity = 'fixed';
      else if (translationsLocked && kinds.slice(3).every(k => k === 'free')) side.fixity = 'pinned';
      else if (kinds.every(k => k === 'free')) side.fixity = 'free';
      else {
        // Laws are in the connection's own local axes; the service reads them in the member's.
        const connectionY = localY(member.start.position, member.end.position, conn.referenceY);
        if (connectionY[0] * memberY[0] + connectionY[1] * memberY[1] + connectionY[2] * memberY[2] < 1 - 1e-9) return unsupported(`Connection ${conn.id}: its local axes differ from the member's, so its laws cannot be sent exactly.`);
        const elastic = conn.laws.map(l => l.kind === 'elastic' ? l.stiffness : 0);
        side.connection = { laws: kinds as unknown as MemberEndConnection['laws'], ...(elastic.some(v => v > 0) ? { stiffness: elastic as unknown as Vector6 } : {}) };
      }
      const shorthand = side.fixity;
      if ((shorthand && !capabilities.connectionShorthands.includes(shorthand)) || (side.connection && !['locked', 'free', 'elastic'].every(l => capabilities.connectionLaws.includes(l)))) return unsupported(`Connection ${conn.id}: the OpenSees service does not offer this connection form.`);
      sides.push(side);
    }
    sides.forEach((side, index) => { if (side.rigid) rigidEnds.add([member.start, member.end][index].id); endInfo.set([member.start, member.end][index].id, side); });
    const sent: StructuralMember = { id: member.id, startNodeId: sides[0].nodeId, endNodeId: sides[1].nodeId, kind, properties, orientation: [member.referenceY[0], member.referenceY[1], member.referenceY[2]] };
    if (initialStrain !== 0) sent.initialStrain = initialStrain;
    if (sides[0].fixity) sent.startFixity = sides[0].fixity; else sent.startConnection = sides[0].connection;
    if (sides[1].fixity) sent.endFixity = sides[1].fixity; else sent.endConnection = sides[1].connection;
    model.members.push(sent);
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
    if (load.target.kind === 'endpoint') {
      const side = endInfo.get(load.target.id)!;
      if (load.force.some(v => v !== 0) && !side.carriesForce) return unsupported(`Force load ${load.id} on a member end that does not lock all translations cannot be represented exactly.`);
      if (load.moment.some(v => v !== 0) && !side.carriesMoment) return unsupported(`Moment load ${load.id} on a member end that cannot carry moment cannot be represented exactly.`);
    }
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
  if (model.nodes.length > capabilities.limits.maxNodes || model.members.length > capabilities.limits.maxMembers) return unsupported(`The model exceeds the service limits (${capabilities.limits.maxNodes} nodes, ${capabilities.limits.maxMembers} members).`);
  return { ok: true, model, joints, ends, ownNodes, rigidEnds };
}

const REQUIRED_RESULTS = ['components', 'displacements', 'reactions', 'memberForces', 'stability'];
const VALID = 'Adapter does not independently verify equilibrium; the service reported these results as valid.';
const INVALID = 'The service reports no valid results for this component.';
const OMITTED = 'The service omitted this value for a component it reported as valid.';

/** Adapter uses the live service's published capabilities/version and never upgrades its output to verified. */
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
        solver: { id: 'opensees', version, adapterId: 'opensees-snapshot', adapterVersion: '2', fidelity: 'linear-static-experimental' },
        conventions: { memberEndForce: 'not-reported', connectionForce: 'not-reported', connectionRelativeMotion: 'not-reported', residualNormalization: 'not-reported' },
        status, reasonCodes: reason ? [reason] : [], warnings: [], components: [], joints: [], endpoints: [], foundations: [], members: [], connections: [], modes: [], ...body,
      });
      try {
        const [capResponse, healthResponse] = await Promise.all([fetchImpl(`${origin}/capabilities`, { signal }), fetchImpl(`${origin}/health`, { signal })]);
        if (!capResponse.ok || !healthResponse.ok) return finish('error', 'capabilities-unavailable');
        const capability = capabilitiesSchema.safeParse(await capResponse.json());
        const health = healthSchema.safeParse(await healthResponse.json());
        if (!capability.success || !health.success || !REQUIRED_RESULTS.every(r => capability.data.results.includes(r))) return finish('error', 'unsupported-service-profile');
        version = `${health.data.service}/opensees-${health.data.opensees}`;
        const projected = projectOpenSeesRequest(request, capability.data);
        if (!projected.ok) return finish('unsupported', 'unsupported-input', { warnings: [projected.reason] });
        const result = resultSchema.safeParse(await createOpenSeesSolver(origin, fetchImpl).analyze(projected.model, signal));
        if (!result.success) return finish('error', 'invalid-solver-response');
        const raw = result.data;
        if (raw.status === 'error' || raw.status === 'unsupported') return finish(raw.status, 'solver-outcome', { warnings: [raw.message] });
        if (raw.analysis.modelVersion !== undefined && raw.analysis.modelVersion !== request.snapshot.revisionId) return finish('error', 'solver-model-mismatch');

        const ids = new Set(projected.model.nodes.map(n => n.id));
        if ([...Object.keys(raw.displacements), ...Object.keys(raw.reactions)].some(key => !ids.has(key))) return finish('error', 'unknown-result-node');
        const memberIds = new Set(request.snapshot.members.map(m => m.id));
        const nodeComponent = new Map<string, ServiceComponent>(), memberComponent = new Map<string, ServiceComponent>();
        for (const c of raw.components) {
          for (const node of c.nodeIds) { if (!ids.has(node)) return finish('error', 'unknown-result-node'); if (nodeComponent.has(node)) return finish('error', 'invalid-solver-response'); nodeComponent.set(node, c); }
          for (const member of c.memberIds) { if (!memberIds.has(member)) return finish('error', 'unknown-result-member'); if (memberComponent.has(member)) return finish('error', 'invalid-solver-response'); memberComponent.set(member, c); }
        }
        if (memberIds.size !== memberComponent.size) return finish('error', 'incomplete-solver-components');

        // A component's values are usable only if the service says its results are valid and it reached a conclusion.
        const usable = (c: ServiceComponent) => c.resultsValid && c.state !== 'unknown';
        const jointByNode = new Map([...projected.joints].map(([jointId, node]) => [node, jointId]));
        const sets = new Map(raw.components.map(c => [c.id, {
          joints: new Set(c.nodeIds.flatMap(n => jointByNode.has(n) ? [jointByNode.get(n)!] : [])),
          endpoints: new Set(request.snapshot.members.filter(m => c.memberIds.includes(m.id)).flatMap(m => [m.start.id, m.end.id])),
        }]));
        const components = raw.components.map(c => {
          const ok = usable(c);
          const claimedUnstable = !ok && c.state === 'unstable';
          const reasons = [...c.reasonCodes, ...(ok ? ['adapter-does-not-verify-equilibrium'] : ['solver-results-not-valid']), ...(!ok && !claimedUnstable && c.state !== 'unknown' ? ['solver-inconsistent-component'] : [])];
          return { id: c.id, jointIds: [...sets.get(c.id)!.joints], endpointIds: [...sets.get(c.id)!.endpoints], memberIds: [...c.memberIds],
            classification: ok || claimedUnstable ? c.state : 'unknown' as const, validity: ok || claimedUnstable ? 'unverified' as const : 'unavailable' as const, reasonCodes: [...new Set(reasons)] };
        });
        const measure = (component: ServiceComponent, value: Vector6 | undefined) =>
          !usable(component) ? { validity: 'unavailable' as const, reason: INVALID }
            : value ? { validity: 'unverified' as const, value: [...value] as [number, number, number, number, number, number], reason: VALID }
              : { validity: 'unavailable' as const, reason: OMITTED };

        const joints = request.snapshot.joints.flatMap(j => {
          const node = projected.joints.get(j.id)!, component = nodeComponent.get(node);
          return component ? [{ jointId: j.id, componentId: component.id, displacement: measure(component, raw.displacements[node]) }] : [];
        });
        const endpoints = request.snapshot.members.flatMap(m => [m.start, m.end].flatMap(e => {
          const node = projected.ends.get(e.id)!, component = memberComponent.get(m.id)!;
          return projected.rigidEnds.has(e.id) && nodeComponent.get(node) === component ? [{ endpointId: e.id, componentId: component.id, displacement: measure(component, raw.displacements[node]) }] : [];
        }));
        const foundations = request.snapshot.foundations.flatMap(f => {
          const node = projected.joints.get(f.jointId)!, component = nodeComponent.get(node);
          return component ? [{ foundationId: f.id, componentId: component.id, reaction: measure(component, raw.reactions[node]) }] : [];
        });
        const modes = raw.components.flatMap(c => c.stability.modes.map((mode, index) => {
          const jointDisplacements: Record<string, z.infer<typeof tuple6>> = {}, endpointDisplacements: Record<string, z.infer<typeof tuple6>> = {};
          for (const [node, value] of Object.entries(mode.displacements)) {
            const jointId = jointByNode.get(node), endpointId = projected.ownNodes.get(node);
            if (jointId && sets.get(c.id)!.joints.has(jointId)) jointDisplacements[jointId] = value;
            else if (endpointId && sets.get(c.id)!.endpoints.has(endpointId)) endpointDisplacements[endpointId] = value;
          }
          return { id: `${c.id}:mode-${index}`, componentId: c.id, validity: 'unverified' as const, reason: 'Mode shape reported by the service; the adapter does not verify it.', jointDisplacements, endpointDisplacements };
        }));

        const codes = raw.status === 'success' ? [] : [...new Set([`solver-${raw.status}`, ...raw.analysis.reasonCodes])];
        const warnings = [...(raw.status === 'success' ? [] : [raw.message]), ...raw.warnings, 'Experimental OpenSees result; the adapter does not verify equilibrium, so every value is unverified. Member end forces, connection forces and capacity checks are not mapped.'];
        return finish(raw.status, '', { reasonCodes: codes, components, joints, endpoints, foundations, modes, warnings });
      } catch (error) {
        if (signal?.aborted) throw error;
        return finish('error', 'service-unavailable', { warnings: [error instanceof Error ? error.message : String(error)] });
      }
    },
  };
}
