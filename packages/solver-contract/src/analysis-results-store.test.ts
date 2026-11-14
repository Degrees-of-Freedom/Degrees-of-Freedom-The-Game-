import { describe, expect, it } from 'vitest';
import { createStructuralStateService } from './structural-state-service';
import { createAnalysisResultsStore } from './analysis-results-store';
import { parseStructuralAnalysisResult } from './analysis-result';

const snapshot = {
  format: 'dof-structural-state', schemaVersion: 1, modelId: 'm', revisionId: 'r1', units: 'SI', globalAxes: 'right-handed-z-up',
  materials: [{ id: 'steel', elasticModulus: 210e9, shearModulus: 81e9 }],
  sections: [{ id: 'tube', area: 0.01, iy: 0.0001, iz: 0.0001, torsionConstant: 0.0002, capacities: [] }],
  joints: [{ id: 'j', position: [0, 0, 0] }],
  members: [{ id: 'beam', family: 'frame', start: { id: 'a', position: [0, 0, 0] }, end: { id: 'b', position: [0, 0, 2] }, referenceY: [0, 1, 0], state: 'active', materialId: 'steel', sectionId: 'tube' }],
  connections: [{ id: 'c', endpointId: 'a', jointId: 'j', referenceY: [0, 1, 0], laws: Array(6).fill({ kind: 'locked' }), capacities: [], state: 'active' }],
  foundations: [{ id: 'f', jointId: 'j', restrained: [true, true, true, true, true, true] }],
  loads: [{ id: 'load', target: { kind: 'endpoint', id: 'b' }, force: [0, 0, -100], moment: [0, 0, 0], persistent: true }],
  loadCases: [{ id: 'lc', loads: [{ loadId: 'load', factor: 1 }] }], selfWeight: { enabled: false },
};
const zero = [0, 0, 0, 0, 0, 0];
const run = {
  format: 'dof-analysis-result', schemaVersion: 1, runId: 'run-1', purpose: 'turn', turn: { matchId: 'match', turnId: 'turn-1', playerId: 'p1', rulesVersion: '1' },
  startedAt: '2026-11-14T12:00:00Z', finishedAt: '2026-11-14T12:00:01Z',
  request: { requestVersion: 1, snapshot, analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 0, factors: [{ caseId: 'lc', factor: 1 }] }] } },
  resultStage: 0,
  solver: { id: 'reference', version: '1', adapterId: 'adapter', adapterVersion: '1', fidelity: 'linear' },
  conventions: { memberEndForce: 'on-member', connectionForce: 'on-endpoint', connectionRelativeMotion: 'endpoint-minus-joint', residualNormalization: 'separate-scales-v1' },
  status: 'success', reasonCodes: [], warnings: [], runtimeMs: 42,
  components: [{ id: 'component', jointIds: ['j'], endpointIds: ['a', 'b'], memberIds: ['beam'], classification: 'stable', validity: 'verified', reasonCodes: [], checks: { converged: true, forceScale: 100, momentScale: 1, normalizedForceResidual: 1e-8, normalizedMomentResidual: 1e-8, forceTolerance: 1e-5, momentTolerance: 1e-5, compatibilityVerified: true, activeLawsVerified: true } }],
  joints: [{ jointId: 'j', componentId: 'component', displacement: { validity: 'verified', value: zero } }],
  endpoints: [], foundations: [{ foundationId: 'f', componentId: 'component', reaction: { validity: 'verified', value: [0, 0, 100, 0, 0, 0] } }],
  members: [{ memberId: 'beam', componentId: 'component', endForces: { validity: 'verified', value: { start: zero, end: zero } }, utilization: { validity: 'unavailable', reason: 'not computed' }, activeState: { validity: 'unverified', value: 'active', reason: 'experimental' } }],
  connections: [], modes: [],
};
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
describe('analysis result storage', () => {
  it('persists full run provenance against a saved revision and isolates read values', () => {
    const db = memory(), states = createStructuralStateService(db), store = createAnalysisResultsStore(db);
    expect(store.write(run).status).toBe('error');
    expect(states.write(snapshot).status).toBe('saved');
    expect(store.write(run).status).toBe('saved');
    expect(store.write(run).status).toBe('unchanged');
    const read = store.readRun('m', 'run-1');
    expect(read.status).toBe('found');
    if (read.status !== 'found') throw new Error('missing result');
    expect(read.result.members[0].utilization).toEqual({ validity: 'unavailable', reason: 'not computed' });
    read.result.warnings.push('local mutation');
    expect(store.readRun('m', 'run-1')).toMatchObject({ status: 'found', result: { warnings: [] } });
    expect(store.write({ ...run, runtimeMs: 43 }).status).toBe('error');
    expect(store.write({ ...run, runId: 'run-2', request: { ...run.request, snapshot: { ...snapshot, loads: [{ ...snapshot.loads[0], force: [0, 0, -200] }] } } }).status).toBe('error');
    expect(store.read('m')).toMatchObject({ status: 'found', results: [{ runId: 'run-1' }] });
  });
  it('retains verified equilibrium in a marginal component', () => {
    const marginal = structuredClone(run);
    marginal.components[0].classification = 'marginal';
    expect(parseStructuralAnalysisResult(marginal).foundations[0].reaction.validity).toBe('verified');
  });
  it('rejects verified values without valid scoped equilibrium checks and rejects unknown IDs', () => {
    const bad = structuredClone(run); bad.components[0].checks.normalizedForceResidual = 1;
    expect(() => parseStructuralAnalysisResult(bad)).toThrow();
    const unknown = structuredClone(run); unknown.foundations[0].foundationId = 'wrong';
    expect(() => parseStructuralAnalysisResult(unknown)).toThrow();
    const badVerified = { ...structuredClone(run), components: [{ ...run.components[0], validity: 'unverified', reasonCodes: ['approximation'] }] };
    expect(() => parseStructuralAnalysisResult(badVerified)).toThrow();
    expect(() => parseStructuralAnalysisResult({ ...run, status: 'unsupported', reasonCodes: ['feature'], runtimeMs: 0 })).toThrow();
  });
  it('stores unresolved partial outcomes without inventing values and protects corrupt collections', () => {
    const db = memory(), states = createStructuralStateService(db), store = createAnalysisResultsStore(db);
    states.write(snapshot);
    const partial = { ...run, runId: 'partial', status: 'unresolved', reasonCodes: ['timeout'], components: [{ id: 'component', jointIds: ['j'], endpointIds: ['a', 'b'], memberIds: ['beam'], classification: 'unknown', validity: 'unavailable', reasonCodes: ['timeout'] }], joints: [], endpoints: [], foundations: [{ foundationId: 'f', componentId: 'component', reaction: { validity: 'unavailable', reason: 'timeout' } }], members: [], connections: [], modes: [] };
    const mixed = { ...run, runId: 'mixed', status: 'unresolved', reasonCodes: ['timeout'], components: [...run.components, { id: 'unknown', jointIds: [], endpointIds: [], memberIds: [], classification: 'unknown', validity: 'unavailable', reasonCodes: ['timeout'] }] };
    expect(store.write(mixed)).toEqual({ status: 'saved' });
    expect(store.readRun('m', 'mixed')).toMatchObject({ status: 'found', result: { foundations: [{ reaction: { validity: 'verified' } }] } });
    expect(store.write(partial)).toEqual({ status: 'saved' });
    expect(store.readRun('m', 'partial')).toMatchObject({ status: 'found', result: { foundations: [{ reaction: { validity: 'unavailable' } }] } });
    const key = 'dof:analysis-results:v1:m';
    db.setItem(key, '{ corrupt');
    expect(store.read('m').status).toBe('error');
    expect(store.write(run).status).toBe('error');
    expect(db.getItem(key)).toBe('{ corrupt');
  });
});
