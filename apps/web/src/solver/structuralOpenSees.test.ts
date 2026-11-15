import { describe, expect, it, vi } from 'vitest';
import { analyzeAndStore, createAnalysisResultsStore, createStructuralStateService, parseStructuralAnalysisRequest } from '@dof/solver-contract';
import { createStoredOpenSeesAdapter, projectOpenSeesRequest } from './structuralOpenSees';
import { runStoredOpenSees } from './runStoredOpenSees';
import { exampleStructuralRequest } from './exampleStructuralRequest';

const snapshot = {
  format: 'dof-structural-state', schemaVersion: 1, modelId: 'm', revisionId: 'r1', units: 'SI', globalAxes: 'right-handed-z-up',
  materials: [{ id: 'steel', elasticModulus: 210e9, shearModulus: 81e9 }],
  sections: [{ id: 'section', area: 7.49e-3, iy: 4.47e-5, iz: 4.47e-5, torsionConstant: 7.03e-5, capacities: [] }],
  joints: [{ id: 'foundation-joint', position: [0, 0, 0] }],
  members: [{ id: 'beam', family: 'frame', start: { id: 'a', position: [0, 0, 0] }, end: { id: 'b', position: [0, 0, 2] }, referenceY: [0, 1, 0], state: 'active', materialId: 'steel', sectionId: 'section' }],
  connections: [{ id: 'fixed', endpointId: 'a', jointId: 'foundation-joint', referenceY: [0, 1, 0], laws: Array(6).fill({ kind: 'locked' }), capacities: [], state: 'active' }],
  foundations: [{ id: 'f', jointId: 'foundation-joint', restrained: [true, true, true, true, true, true] }],
  loads: [{ id: 'tip', target: { kind: 'endpoint', id: 'b' }, force: [0, 0, -1000], moment: [0, 0, 0], persistent: true }],
  loadCases: [{ id: 'case', loads: [{ loadId: 'tip', factor: 1 }] }], selfWeight: { enabled: false },
};
const request = () => parseStructuralAnalysisRequest({ requestVersion: 1, snapshot, analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 0, factors: [{ caseId: 'case', factor: 1 }] }] } });
const capabilities = {
  id: 'opensees' as const, name: 'OpenSees static analysis', solver: 'opensees-3.7', units: 'SI' as const, fidelities: ['linear', 'nonlinear'], defaultFidelity: 'nonlinear',
  memberKinds: { beam: 'Elastic beam-column.', brace: 'Axial, two-way.', cable: 'Axial, tension only.' },
  connectionLaws: ['locked', 'free', 'elastic'], connectionShorthands: ['fixed', 'pinned', 'free'], connectionPatterns: [],
  initialStrain: ['brace', 'cable'], loads: ['nodal-force', 'nodal-moment', 'self-weight'],
  results: ['components', 'displacements', 'reactions', 'memberForces', 'stability'],
  defaultMemberProperties: { elasticModulus: 210e9, shearModulus: 81e9, area: 7.49e-3, inertiaY: 4.47e-5, inertiaZ: 4.47e-5, torsionConstant: 7.03e-5, weightPerLength: 588 },
  limits: { maxNodes: 1000, maxMembers: 1000, maxModes: 8, defaultTimeoutMs: 30000 },
};
const zero = [0, 0, 0, 0, 0, 0];
const stability = (stable: boolean, unstableNodeIds: string[] = [], modes: unknown[] = []) => ({ stable, freeDofs: 6, mechanisms: stable ? 0 : 1, translationalMechanisms: stable ? 0 : 1, rotationalMechanisms: 0, staticIndeterminacy: 0, unstableNodeIds, modes });
/** A v2 service. It answers every model with one component holding all nodes and members, in the requested state. */
function fakeService(outcome: 'success' | 'unstable' | 'unresolved' = 'success', echoVersion?: string) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/capabilities')) return Response.json(capabilities);
    if (path.endsWith('/health')) return Response.json({ status: 'ok', service: '0.2', opensees: '3.7' });
    const model = JSON.parse(String(init?.body)) as { version?: string; nodes: { id: string }[]; members: { id: string }[] };
    const nodeIds = model.nodes.map(n => n.id);
    const analysis = (reasonCodes: string[]) => ({ modelVersion: echoVersion ?? model.version, fidelity: 'linear', solver: 'opensees-3.7', runtimeMs: 3, reasonCodes });
    const component = (state: string, resultsValid: boolean, reasonCodes: string[], st: ReturnType<typeof stability>) => ({ id: nodeIds[0], nodeIds, memberIds: model.members.map(m => m.id), state, reasonCodes, resultsValid, stability: st });
    if (outcome === 'success') return Response.json({ status: 'success', analysis: analysis([]), components: [component('stable', true, [], stability(true))], displacements: { j0: zero, e1: [0, 0, -0.001, 0, 0, 0] }, reactions: { j0: [0, 0, 1000, 0, 0, 0] }, memberForces: {}, stability: stability(true), warnings: [] });
    const unstable = stability(false, ['e1'], [{ kind: 'translation', displacements: { e1: [1, 0, 0, 0, 0, 0] } }]);
    if (outcome === 'unstable') return Response.json({ status: 'unstable', message: 'Component j0 is a mechanism.', analysis: analysis(['internal_mechanism']), components: [component('unstable', false, ['internal_mechanism'], unstable)], displacements: {}, reactions: {}, memberForces: {}, stability: unstable, warnings: ['mechanism found'] });
    return Response.json({ status: 'unresolved', message: 'Component j0 did not converge.', analysis: analysis(['not_converged']), components: [component('unknown', false, ['not_converged'], stability(false))], displacements: {}, reactions: {}, memberForces: {}, stability: stability(false), warnings: [] });
  });
}
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
describe('stored OpenSees integration', () => {
  const liveUrl: string | undefined = import.meta.env.VITE_OPENSEES_URL;
  it.skipIf(!liveUrl)('stores the cantilever result from a live OpenSees service', async () => {
    const outcome = await runStoredOpenSees(storage(), exampleStructuralRequest, { baseUrl: liveUrl!, runId: 'live', isCurrent: () => true });
    expect(outcome.status).toBe('stored');
    if (outcome.status !== 'stored') throw new Error(JSON.stringify(outcome));
    expect(outcome.result.status).toBe('success');
    expect(outcome.result.foundations[0].reaction.validity).toBe('unverified');
    const reaction = outcome.result.foundations[0].reaction;
    if (reaction.validity === 'unavailable') throw new Error('Missing foundation reaction');
    expect(reaction.value[0]).toBeCloseTo(-1000, 4);
  });

  it('accepts the workspace cantilever example', async () => {
    const input = parseStructuralAnalysisRequest(exampleStructuralRequest);
    const outcome = await runStoredOpenSees(storage(), input, { baseUrl: 'http://solver.test', runId: 'example', isCurrent: () => true, fetchImpl: fakeService() });
    expect(outcome).toMatchObject({ status: 'stored', result: { status: 'success' } });
  });
  it('projects, solves, persists and retrieves an unverified result for the saved revision', async () => {
    const db = storage(), fetchMock = fakeService();
    const outcome = await runStoredOpenSees(db, request(), { baseUrl: 'http://solver.test', runId: 'one', isCurrent: () => true, fetchImpl: fetchMock });
    expect(outcome.status).toBe('stored');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('http://solver.test/analyze');
    const read = createAnalysisResultsStore(db).readRun('m', 'one');
    expect(read).toMatchObject({ status: 'found', result: { status: 'success', solver: { version: '0.2/opensees-3.7' }, components: [{ validity: 'unverified' }], foundations: [{ reaction: { validity: 'unverified', value: [0, 0, 1000, 0, 0, 0] } }] } });
  });
  it('records unsupported physics and does not send an altered model to the solver', async () => {
    const db = storage(), fetchMock = fakeService();
    // Self-weight in a direction other than -Z has no exact OpenSees form.
    const different = { ...structuredClone(snapshot), materials: [{ id: 'steel', elasticModulus: 210e9, shearModulus: 81e9, density: 7850 }], selfWeight: { enabled: true, gravity: [1, 0, -9.81] } };
    createStructuralStateService(db).write(different);
    const input = parseStructuralAnalysisRequest({ requestVersion: 1, snapshot: different, analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 1, factors: [{ caseId: 'case', factor: 1 }] }] } });
    const result = await analyzeAndStore(db, createStoredOpenSeesAdapter('http://solver.test', { runId: 'two', purpose: 'preview' }, fetchMock), input, { isCurrent: () => true });
    expect(result).toMatchObject({ status: 'stored', result: { status: 'unsupported', reasonCodes: ['unsupported-input'] } });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('http://solver.test/analyze');
  });
  const pinLaws = [{ kind: 'locked' }, { kind: 'locked' }, { kind: 'locked' }, { kind: 'free' }, { kind: 'free' }, { kind: 'free' }] as const;
  it('rejects nonlinear analysis, misaligned connectors, moments on pins and non-finite loads', () => {
    const nonlinear = structuredClone(request()); nonlinear.analysis.kind = 'geometric-nonlinear-static';
    expect(projectOpenSeesRequest(nonlinear, capabilities)).toMatchObject({ ok: false });
    // Connection laws are in the connection's axes; a rolled connection cannot be sent in the member's.
    const rolled = structuredClone(request()); rolled.snapshot.connections[0].laws[3] = { kind: 'elastic', stiffness: 1000 }; rolled.snapshot.connections[0].referenceY = [1, 0, 0];
    expect(projectOpenSeesRequest(rolled, capabilities)).toMatchObject({ ok: false, reason: expect.stringContaining('local axes') });
    const pinnedMoment = structuredClone(request()); pinnedMoment.snapshot.connections[0].laws = [...pinLaws];
    pinnedMoment.snapshot.loads[0] = { ...pinnedMoment.snapshot.loads[0], target: { kind: 'endpoint', id: 'a' }, force: [0, 0, 0], moment: [0, 1, 0] };
    expect(projectOpenSeesRequest(pinnedMoment, capabilities)).toMatchObject({ ok: false, reason: expect.stringContaining('Moment load') });
    const overflow = structuredClone(request()); overflow.snapshot.loadCases[0].loads[0].factor = Number.MAX_VALUE; overflow.analysis.loadPath[0].factors[0].factor = 2;
    expect(projectOpenSeesRequest(overflow, capabilities)).toMatchObject({ ok: false });
    const doubled = structuredClone(request()); doubled.snapshot.loadCases.push({ id: 'case-2', loads: [{ loadId: 'tip', factor: 2 }] }); doubled.analysis.loadPath[0].factors.push({ caseId: 'case-2', factor: 1 });
    const projected = projectOpenSeesRequest(doubled, capabilities);
    expect(projected.ok && projected.model.loads).toEqual([{ nodeId: 'e1', force: [0, 0, -3000], moment: [0, 0, 0] }]);
    const tooMany = projectOpenSeesRequest(request(), { ...capabilities, limits: { ...capabilities.limits, maxNodes: 1 } });
    expect(tooMany).toMatchObject({ ok: false, reason: expect.stringContaining('limits') });
  });
  it('sends per-member properties, orientation, pins and elastic connections that v1 refused', () => {
    const custom = structuredClone(request()); custom.snapshot.sections[0].area = 0.5; custom.snapshot.sections[0].iy = 1e-4;
    custom.snapshot.connections[0].laws[3] = { kind: 'elastic', stiffness: 1000 };
    const sent = projectOpenSeesRequest(custom, capabilities);
    expect(sent.ok && sent.model).toMatchObject({ version: 'r1', analysis: { fidelity: 'linear', selfWeight: false } });
    expect(sent.ok && sent.model.members[0]).toMatchObject({
      kind: 'beam', orientation: [0, 1, 0], properties: { area: 0.5, inertiaY: 1e-4, inertiaZ: 4.47e-5, elasticModulus: 210e9, shearModulus: 81e9 },
      startConnection: { laws: ['locked', 'locked', 'locked', 'elastic', 'locked', 'locked'], stiffness: [0, 0, 0, 1000, 0, 0] }, endFixity: 'fixed',
    });
    // Two pinned ends were refused when the service substituted a truss; v2 keeps the beam.
    const pins = structuredClone(request());
    pins.snapshot.connections[0].laws = [...pinLaws];
    pins.snapshot.joints.push({ id: 'tip-joint', position: [0, 0, 2] });
    pins.snapshot.connections.push({ id: 'tip-pin', endpointId: 'b', jointId: 'tip-joint', referenceY: [0, 1, 0], laws: [...pinLaws], capacities: [], state: 'active' });
    const pinned = projectOpenSeesRequest(pins, capabilities);
    expect(pinned.ok && pinned.model.members[0]).toMatchObject({ kind: 'beam', startFixity: 'pinned', endFixity: 'pinned' });
    expect(pinned.ok && [...pinned.rigidEnds]).toEqual([]);
  });
  const cableRequest = (reference: object, selfWeightFactor = 0, gravity = [0, 0, -9.81]) => parseStructuralAnalysisRequest({
    requestVersion: 1,
    snapshot: {
      ...snapshot, revisionId: 'cable',
      materials: [{ id: 'steel', elasticModulus: 210e9, density: 7850 }], sections: [{ id: 'wire', area: 1e-4, capacities: [] }],
      joints: [{ id: 'p', position: [0, 0, 0] }, { id: 'q', position: [3, 0, 4] }],
      members: [{ id: 'cable', family: 'cable', start: { id: 'ca', position: [0, 0, 0] }, end: { id: 'cb', position: [3, 0, 4] }, referenceY: [0, 1, 0], state: 'active', materialId: 'steel', sectionId: 'wire', reference }],
      connections: [
        { id: 'ka', endpointId: 'ca', jointId: 'p', referenceY: [0, 1, 0], laws: [...pinLaws], capacities: [], state: 'active' },
        { id: 'kb', endpointId: 'cb', jointId: 'q', referenceY: [0, 1, 0], laws: Array(6).fill({ kind: 'locked' }), capacities: [], state: 'active' },
      ],
      foundations: [{ id: 'fp', jointId: 'p', restrained: [true, true, true, false, false, false] }, { id: 'fq', jointId: 'q', restrained: [true, true, true, false, false, false] }],
      loads: [], loadCases: [{ id: 'case', loads: [] }], selfWeight: { enabled: true, gravity },
    },
    analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor, factors: [{ caseId: 'case', factor: 1 }] }] },
  });
  it('sends cables with pretension and -Z self-weight, and keeps refusing other gravity or negative factors', () => {
    const byStrain = projectOpenSeesRequest(cableRequest({ kind: 'initialStrain', value: 0.001 }), capabilities);
    expect(byStrain.ok && byStrain.model.members[0]).toMatchObject({ kind: 'cable', initialStrain: 0.001, startFixity: 'pinned', endFixity: 'pinned' });
    expect(byStrain.ok && byStrain.model.members[0].properties?.weightPerLength).toBeUndefined();
    expect(byStrain.ok && [...byStrain.rigidEnds]).toEqual([]);
    // A 5 m chord with a 4.9 m rest length is pre-strained by 5 / 4.9 - 1.
    const byRest = projectOpenSeesRequest(cableRequest({ kind: 'restLength', value: 4.9 }, 2), capabilities);
    expect(byRest.ok && byRest.model.members[0].initialStrain).toBeCloseTo(5 / 4.9 - 1, 12);
    expect(byRest.ok && byRest.model).toMatchObject({ analysis: { fidelity: 'linear', selfWeight: true } });
    expect(byRest.ok && byRest.model.members[0].properties?.weightPerLength).toBeCloseTo(2 * 7850 * 1e-4 * 9.81, 9);
    expect(projectOpenSeesRequest(cableRequest({ kind: 'restLength', value: 4.9 }, 1, [0, 1, -9.81]), capabilities)).toMatchObject({ ok: false });
    expect(projectOpenSeesRequest(cableRequest({ kind: 'restLength', value: 4.9 }, -1), capabilities)).toMatchObject({ ok: false });
    expect(projectOpenSeesRequest(cableRequest({ kind: 'initialStrain', value: 0.001 }), { ...capabilities, memberKinds: { beam: 'x' } })).toMatchObject({ ok: false });
    expect(projectOpenSeesRequest(cableRequest({ kind: 'initialStrain', value: 0.001 }), { ...capabilities, initialStrain: [] })).toMatchObject({ ok: false });
  });
  it('maps an unstable service result without inventing values', async () => {
    const adapter = createStoredOpenSeesAdapter('http://solver.test', { runId: 'u', purpose: 'preview' }, fakeService('unstable'));
    const result = await adapter.analyze(request());
    expect(result).toMatchObject({
      status: 'unstable', reasonCodes: ['solver-unstable', 'internal_mechanism'],
      components: [{ id: 'j0', classification: 'unstable', validity: 'unverified', jointIds: ['foundation-joint'], endpointIds: ['a', 'b'], memberIds: ['beam'] }],
      joints: [{ jointId: 'foundation-joint', displacement: { validity: 'unavailable' } }],
      foundations: [{ foundationId: 'f', reaction: { validity: 'unavailable' } }],
      endpoints: [{ endpointId: 'a', displacement: { validity: 'unavailable' } }, { endpointId: 'b', displacement: { validity: 'unavailable' } }],
      modes: [{ componentId: 'j0', validity: 'unverified', endpointDisplacements: { b: [1, 0, 0, 0, 0, 0] }, jointDisplacements: {} }],
    });
    expect(JSON.stringify(result.joints)).not.toContain('"value"');
    expect(result.warnings).toContain('Component j0 is a mechanism.');
  });
  it('maps an unresolved service result as unknown and unavailable', async () => {
    const adapter = createStoredOpenSeesAdapter('http://solver.test', { runId: 'n', purpose: 'preview' }, fakeService('unresolved'));
    const result = await adapter.analyze(request());
    expect(result).toMatchObject({
      status: 'unresolved', reasonCodes: ['solver-unresolved', 'not_converged'],
      components: [{ classification: 'unknown', validity: 'unavailable', reasonCodes: ['not_converged', 'solver-results-not-valid'] }],
      foundations: [{ reaction: { validity: 'unavailable' } }],
    });
    expect(result.warnings).toContain('Component j0 did not converge.');
  });
  it('rejects a reply for a different model revision', async () => {
    const adapter = createStoredOpenSeesAdapter('http://solver.test', { runId: 'm', purpose: 'preview' }, fakeService('success', 'other'));
    expect(await adapter.analyze(request())).toMatchObject({ status: 'error', reasonCodes: ['solver-model-mismatch'] });
  });
  it('does not persist stale or mismatched solver replies', async () => {
    const db = storage(); createStructuralStateService(db).write(snapshot);
    const base = createStoredOpenSeesAdapter('http://solver.test', { runId: 'three', purpose: 'preview' }, fakeService());
    expect(await analyzeAndStore(db, base, request(), { isCurrent: () => false })).toEqual({ status: 'stale' });
    expect(createAnalysisResultsStore(db).read('m')).toEqual({ status: 'missing' });
    const bad = { analyze: async () => ({ ...await base.analyze(request()), request: { ...request(), analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 0, factors: [] }] } } }) };
    expect(await analyzeAndStore(db, bad, request(), { isCurrent: () => true })).toMatchObject({ status: 'error' });
    expect(createAnalysisResultsStore(db).read('m')).toEqual({ status: 'missing' });
  });
});
