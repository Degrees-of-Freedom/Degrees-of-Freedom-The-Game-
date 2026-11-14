import { describe, expect, it, vi } from 'vitest';
import type { AnalysisBody, AnalysisResult, StabilityReport, StructuralModel } from '@dof/solver-contract';
import { createOpenSeesSolver } from './opensees';

const cantilever: StructuralModel = {
  units: 'SI',
  nodes: [{ id: 'a', position: [0, 0, 0] }, { id: 'b', position: [3, 0, 0] }],
  members: [{ id: 'm', startNodeId: 'a', endNodeId: 'b' }],
  supports: [{ nodeId: 'a', restrained: [true, true, true, true, true, true] }],
  loads: [{ nodeId: 'b', force: [0, 0, -1000], moment: [0, 0, 0] }],
};

const stabilityReport: StabilityReport = {
  stable: true, freeDofs: 6, mechanisms: 0, translationalMechanisms: 0, rotationalMechanisms: 0,
  staticIndeterminacy: 0, unstableNodeIds: [], modes: [],
};
const body: AnalysisBody = {
  analysis: { fidelity: 'nonlinear', solver: 'OpenSeesPy test', runtimeMs: 12, reasonCodes: [] },
  components: [{
    id: 'a', nodeIds: ['a', 'b'], memberIds: ['m'], state: 'stable', reasonCodes: [], resultsValid: true,
    stability: stabilityReport,
  }],
  displacements: { a: [0, 0, 0, 0, 0, 0] },
  reactions: {},
  memberForces: {},
  stability: stabilityReport,
  warnings: [],
};

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

describe('OpenSees solver adapter', () => {
  it('posts the model as JSON to /analyze and returns the service result', async () => {
    const result: AnalysisResult = { status: 'success', ...body };
    const fetchMock = respond(result);
    const solver = createOpenSeesSolver('http://solver.test/', fetchMock);

    expect(await solver.analyze(cantilever)).toEqual(result);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://solver.test/analyze');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(cantilever);
  });

  it('passes through result bodies sent with an error status code', async () => {
    const rejection = { status: 'error', message: 'Invalid model: units: Input should be SI' };
    expect(await createOpenSeesSolver('http://solver.test', respond(rejection, 422)).analyze(cantilever)).toEqual(rejection);
  });

  it('reports an unexpected body as an error result', async () => {
    const result = await createOpenSeesSolver('http://solver.test', respond('<html>Bad gateway</html>', 502)).analyze(cantilever);
    expect(result).toEqual({ status: 'error', message: expect.stringContaining('HTTP 502') });
  });

  it('rejects a body that has a known status but the wrong shape', async () => {
    const badComponent = { ...body.components[0], state: 'fine' };
    const malformed = [
      { status: 'success' },
      { ...body, status: 'success', stability: { stable: true } },
      { ...body, status: 'success', analysis: { ...body.analysis, fidelity: 'quick' } },
      { ...body, status: 'success', components: [badComponent] },
      { ...body, status: 'success', components: [{ ...body.components[0], reasonCodes: ['mystery'] }] },
      { ...body, status: 'success', components: [{ ...body.components[0], resultsValid: 'yes' }] },
      { ...body, status: 'success', warnings: 'none' },
      { ...body, status: 'unstable' },
      { ...body, status: 'unresolved' },
      { status: 'unstable', message: 'moves', warnings: [] },
      { status: 'error' },
    ];
    for (const body of malformed) {
      const result = await createOpenSeesSolver('http://solver.test', respond(body)).analyze(cantilever);
      expect(result).toEqual({ status: 'error', message: expect.stringContaining('unexpected response') });
    }
  });

  it('accepts unstable and unresolved results that carry a body and a message', async () => {
    for (const status of ['unstable', 'unresolved'] as const) {
      const result: AnalysisResult = { status, message: 'explained', ...body };
      expect(await createOpenSeesSolver('http://solver.test', respond(result)).analyze(cantilever)).toEqual(result);
    }
  });

  it('reports an unreachable service as an error result', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const result = await createOpenSeesSolver('http://solver.test', offline).analyze(cantilever);
    expect(result).toEqual({ status: 'error', message: expect.stringContaining('Could not reach') });
  });

  it('rejects when the caller aborts', async () => {
    const controller = new AbortController();
    const hanging = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = createOpenSeesSolver('http://solver.test', hanging).analyze(cantilever, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
  });

  // Opt-in check against a running service:
  //   VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test
  const liveUrl: string | undefined = import.meta.env.VITE_OPENSEES_URL;
  it.skipIf(!liveUrl)('analyses a cantilever on a live service', async () => {
    const result = await createOpenSeesSolver(liveUrl!).analyze(cantilever);
    if (result.status !== 'success') throw new Error(`Expected success, got ${JSON.stringify(result)}`);
    // Tip deflection P L^3 / (3 E I) with the service's steel section.
    expect(result.displacements.b[2]).toBeCloseTo(-9.5877e-4, 7);
    expect(result.memberForces?.m.momentStart).toBeCloseTo(3000, 6);
    expect(result.stability?.stable).toBe(true);
  });
});
