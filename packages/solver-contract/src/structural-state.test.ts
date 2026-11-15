import { describe, expect, it } from 'vitest';
import { parseStructuralSnapshot, parseStructuralAnalysisRequest } from './structural-state';
import { createStructuralStateService } from './structural-state-service';

const rigid = { kind: 'locked' } as const;
const free = { kind: 'free' } as const;
const spring = { kind: 'elastic', stiffness: 1000 } as const;
const base = {
  format: 'dof-structural-state', schemaVersion: 1, modelId: 'model', revisionId: 'r1',
  units: 'SI', globalAxes: 'right-handed-z-up',
  materials: [{ id: 'steel', elasticModulus: 210e9, shearModulus: 81e9, density: 7850 }],
  sections: [{ id: 'tube', area: 0.01, iy: 0.0001, iz: 0.0001, torsionConstant: 0.0002, capacities: [] }],
  joints: [{ id: 'joint', position: [0, 0, 0] }],
  members: [
    { id: 'beam', family: 'frame', start: { id: 'beam-a', position: [0, 0, 0] }, end: { id: 'beam-b', position: [0, 0, 2] }, referenceY: [0, 1, 0], state: 'active', materialId: 'steel', sectionId: 'tube' },
    { id: 'cable', family: 'cable', start: { id: 'cable-a', position: [0, 0, 0] }, end: { id: 'cable-b', position: [2, 0, 0] }, referenceY: [0, 1, 0], state: 'active', materialId: 'steel', sectionId: 'tube', reference: { kind: 'restLength', value: 2 } },
    { id: 'brace', family: 'brace', start: { id: 'brace-a', position: [0, 0, 0] }, end: { id: 'brace-b', position: [0, 1, 0] }, referenceY: [1, 0, 0], state: 'active', materialId: 'steel', sectionId: 'tube' },
    { id: 'spring', family: 'spring', start: { id: 'spring-a', position: [0, 0, 0] }, end: { id: 'spring-b', position: [1, 0, 0] }, referenceY: [0, 1, 0], state: 'active', axialStiffness: 1000, restLength: 1, capacities: [] },
  ],
  connections: [{ id: 'conn', endpointId: 'beam-a', jointId: 'joint', referenceY: [0, 1, 0], laws: [rigid, rigid, rigid, free, spring, rigid], capacities: [], state: 'active' }],
  foundations: [{ id: 'foundation', jointId: 'joint', restrained: [true, true, true, true, true, true], ownerId: 'player' }],
  loads: [{ id: 'gravity', target: { kind: 'endpoint', id: 'beam-b' }, force: [0, 0, -1000], moment: [0, 0, 0], persistent: true }],
  loadCases: [{ id: 'case', loads: [{ loadId: 'gravity', factor: 1 }] }], selfWeight: { enabled: false },
};
const copy = () => structuredClone(base);

describe('solver-neutral structural state', () => {
  it('round trips distinct coincident ends, all member families and six-axis laws', () => {
    const parsed = parseStructuralSnapshot(JSON.parse(JSON.stringify(base)));
    expect(parsed.members.map((m) => m.family)).toEqual(['frame', 'cable', 'brace', 'spring']);
    expect(parsed.connections).toHaveLength(1);
    expect(parsed.connections[0].laws.map((l) => l.kind)).toEqual(['locked', 'locked', 'locked', 'free', 'elastic', 'locked']);
    expect(parsed.members[1].start.position).toEqual(parsed.joints[0].position);
    expect(parsed.connections.some((c) => c.endpointId === 'cable-a')).toBe(false);
    expect(parseStructuralAnalysisRequest({ requestVersion: 1, snapshot: parsed, analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 0, factors: [{ caseId: 'case', factor: 1 }] }] } }).snapshot).toEqual(parsed);
  });
  it('rejects dangling references, multiple connections, invalid frames and unknown fields', () => {
    const missing = copy(); missing.connections[0].jointId = 'missing';
    expect(() => parseStructuralSnapshot(missing)).toThrow();
    const duplicate = copy(); duplicate.connections.push({ ...duplicate.connections[0], id: 'another' });
    expect(() => parseStructuralSnapshot(duplicate)).toThrow();
    const frame = copy(); frame.members[0].referenceY = [0, 0, 1];
    expect(() => parseStructuralSnapshot(frame)).toThrow();
    expect(() => parseStructuralSnapshot({ ...copy(), unexpected: true })).toThrow();
    expect(() => parseStructuralAnalysisRequest({ requestVersion: 1, snapshot: copy(), analysis: { kind: 'linear-static', loadPath: [{ selfWeightFactor: 0, factors: [{ caseId: 'missing', factor: 1 }] }] } })).toThrow();
  });
  it('stores independent immutable revisions and preserves corrupt data', () => {
    const data = new Map<string, string>();
    const store = createStructuralStateService({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } });
    expect(store.write(base)).toEqual({ status: 'saved' });
    expect(store.write(base)).toEqual({ status: 'unchanged' });
    const changed = copy(); changed.members[0].id = 'other';
    expect(store.write(changed).status).toBe('error');
    expect(store.write({ ...base, revisionId: 'r2', parentRevisionId: 'r1' }).status).toBe('saved');
    expect(store.write({ ...base, revisionId: 'r3', parentRevisionId: 'missing' }).status).toBe('error');
    expect(store.read('model', 'r1')).toMatchObject({ status: 'found', snapshot: { revisionId: 'r1' } });
    data.set('dof:structural:v1:model:bad', '{');
    expect(store.write({ ...base, revisionId: 'bad' }).status).toBe('error');
    expect(data.get('dof:structural:v1:model:bad')).toBe('{');
  });
});
