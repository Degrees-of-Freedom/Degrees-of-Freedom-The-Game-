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
const capabilities = { id: 'opensees', analysis: 'linear-elastic-static', units: 'SI', memberEndFixities: ['fixed', 'pinned'], memberProperties: { elastic_modulus: 210e9, shear_modulus: 81e9, area: 7.49e-3, second_moment: 4.47e-5, torsion_constant: 7.03e-5 } };
const zero = [0, 0, 0, 0, 0, 0];
function fakeService() {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('/capabilities')) return Response.json(capabilities);
    if (path.endsWith('/health')) return Response.json({ status: 'ok', service: '0.1', opensees: '3.7' });
    return Response.json({ status: 'success', displacements: { j0: zero, e1: [0, 0, -0.001, 0, 0, 0] }, reactions: { j0: [0, 0, 1000, 0, 0, 0] }, stability: { stable: true, freeDofs: 6, mechanisms: 0, translationalMechanisms: 0, rotationalMechanisms: 0, staticIndeterminacy: 0, unstableNodeIds: [], modes: [] }, warnings: [] });
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
    expect(read).toMatchObject({ status: 'found', result: { status: 'success', solver: { version: '0.1/opensees-3.7' }, components: [{ validity: 'unverified' }], foundations: [{ reaction: { validity: 'unverified', value: [0, 0, 1000, 0, 0, 0] } }] } });
  });
  it('records unsupported physics and does not send an altered model to the solver', async () => {
    const db = storage(), fetchMock = fakeService();
    const different = structuredClone(snapshot); different.sections[0].area = 0.5;
    createStructuralStateService(db).write(different);
    const input = parseStructuralAnalysisRequest({ ...request(), snapshot: different });
    const result = await analyzeAndStore(db, createStoredOpenSeesAdapter('http://solver.test', { runId: 'two', purpose: 'preview' }, fetchMock), input, { isCurrent: () => true });
    expect(result).toMatchObject({ status: 'stored', result: { status: 'unsupported', reasonCodes: ['unsupported-input'] } });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('http://solver.test/analyze');
  });
  it('rejects nonlinear analysis, elastic connectors and pinned-pinned frames', () => {
    const nonlinear = structuredClone(request()); nonlinear.analysis.kind = 'geometric-nonlinear-static';
    expect(projectOpenSeesRequest(nonlinear, capabilities.memberProperties)).toMatchObject({ ok: false });
    const elastic = structuredClone(request()); elastic.snapshot.connections[0].laws[3] = { kind: 'elastic', stiffness: 1000 };
    expect(projectOpenSeesRequest(elastic, capabilities.memberProperties)).toMatchObject({ ok: false });
    const pins = structuredClone(request());
    pins.snapshot.connections[0].laws = [{ kind: 'locked' }, { kind: 'locked' }, { kind: 'locked' }, { kind: 'free' }, { kind: 'free' }, { kind: 'free' }];
    pins.snapshot.joints.push({ id: 'tip-joint', position: [0, 0, 2] });
    pins.snapshot.connections.push({ id: 'tip-pin', endpointId: 'b', jointId: 'tip-joint', referenceY: [0, 1, 0], laws: [{ kind: 'locked' }, { kind: 'locked' }, { kind: 'locked' }, { kind: 'free' }, { kind: 'free' }, { kind: 'free' }], capacities: [], state: 'active' });
    expect(projectOpenSeesRequest(pins, capabilities.memberProperties)).toMatchObject({ ok: false });
    const overflow = structuredClone(request()); overflow.snapshot.loadCases[0].loads[0].factor = Number.MAX_VALUE; overflow.analysis.loadPath[0].factors[0].factor = 2;
    expect(projectOpenSeesRequest(overflow, capabilities.memberProperties)).toMatchObject({ ok: false });
    const doubled = structuredClone(request()); doubled.snapshot.loadCases.push({ id: 'case-2', loads: [{ loadId: 'tip', factor: 2 }] }); doubled.analysis.loadPath[0].factors.push({ caseId: 'case-2', factor: 1 });
    const projected = projectOpenSeesRequest(doubled, capabilities.memberProperties);
    expect(projected.ok && projected.model.loads).toEqual([{ nodeId: 'e1', force: [0, 0, -3000], moment: [0, 0, 0] }]);
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
