import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, StructuralModel } from '@dof/solver-contract';
import { exampleModel } from '../../game/examples';
import type { LevelId } from '../../game/model';
import { parseStructureLibrary } from '../../game/structureLibrary';
import { toStructuralModel } from '../../game/structuralModel';
import { createOpenSeesSolver } from '../opensees';
import { createWasmSolver } from './wasmSolver';

/**
 * Cross-check of the two contract backends on the same models.
 *
 * Opt-in, because it needs the OpenSees service:
 *   npm run dev:opensees
 *   VITE_OPENSEES_URL=http://127.0.0.1:8000 npm test
 *
 * The two are independent implementations (OpenSees elements and a NumPy
 * eigen-decomposition against this repository's Rust elements and LDLᵀ
 * pivots), so agreement here is evidence for both. It covers linear and
 * corotational nonlinear analysis on hand-built frames, the reference
 * examples and the twenty-structure library.
 */
const liveUrl: string | undefined = import.meta.env.VITE_OPENSEES_URL;

const FIXED = [true, true, true, true, true, true] as const;
const PINNED = [true, true, true, false, false, false] as const;

/** A rigid-jointed space frame with one pinned beam and a truss diagonal. */
const spaceFrame: StructuralModel = {
  units: 'SI',
  nodes: [
    { id: 'a', position: [0, 0, 0] }, { id: 'b', position: [5, 0, 0] }, { id: 'c', position: [5, 4, 0] }, { id: 'd', position: [0, 4, 0] },
    { id: 'e', position: [0, 0, 3] }, { id: 'f', position: [5, 0, 3] }, { id: 'g', position: [5, 4, 3] }, { id: 'h', position: [0, 4, 3] },
  ],
  members: [
    { id: 'c1', startNodeId: 'a', endNodeId: 'e' }, { id: 'c2', startNodeId: 'b', endNodeId: 'f' },
    { id: 'c3', startNodeId: 'c', endNodeId: 'g' }, { id: 'c4', startNodeId: 'd', endNodeId: 'h' },
    { id: 'g1', startNodeId: 'e', endNodeId: 'f' }, { id: 'g2', startNodeId: 'f', endNodeId: 'g', endFixity: 'pinned' },
    { id: 'g3', startNodeId: 'g', endNodeId: 'h' }, { id: 'g4', startNodeId: 'h', endNodeId: 'e' },
    { id: 'brace', startNodeId: 'a', endNodeId: 'f', startFixity: 'pinned', endFixity: 'pinned' },
  ],
  supports: [
    { nodeId: 'a', restrained: FIXED }, { nodeId: 'b', restrained: PINNED },
    { nodeId: 'c', restrained: FIXED }, { nodeId: 'd', restrained: PINNED },
  ],
  loads: [
    { nodeId: 'e', force: [8000, 3000, -40000], moment: [0, 0, 0] },
    { nodeId: 'g', force: [0, -5000, -25000], moment: [500, 0, 1200] },
  ],
  analysis: { fidelity: 'linear' },
};

function expectAgreement(name: string, rust: AnalysisResult, opensees: AnalysisResult, model: StructuralModel, relative = 2e-5) {
  expect(rust.status, name).toBe(opensees.status);
  if (rust.status !== 'success' && rust.status !== 'unstable') throw new Error(`${name}: ${rust.message}`);
  if (opensees.status !== 'success' && opensees.status !== 'unstable') throw new Error(`${name}: ${opensees.message}`);
  const [a, b] = [rust.stability!, opensees.stability!];
  expect(a.stable, name).toBe(b.stable);
  expect(a.translationalMechanisms, `${name} translational mechanisms`).toBe(b.translationalMechanisms);
  // A mechanism's moving nodes are topological and must match. A buckling
  // (load-induced) mode is a shape whose listed nodes depend on each solver's
  // participation cut-off (Rust: negative-pivot direction, OpenSees: an
  // eigenvector), so only the verdict is compared there.
  const buckling = !a.stable && a.translationalMechanisms === 0 && b.translationalMechanisms === 0;
  if (!buckling) expect([...a.unstableNodeIds].sort(), `${name} unstable nodes`).toEqual([...b.unstableNodeIds].sort());
  // Static indeterminacy is physical, so it must match even though the two
  // count free DOFs and spin modes over different internal variables.
  expect(a.staticIndeterminacy, `${name} redundancy`).toBe(b.staticIndeterminacy);
  if (rust.status !== 'success' || opensees.status !== 'success') return;

  const largest = (values: Record<string, readonly number[]>, from: number, to: number) =>
    Math.max(...Object.values(values).flatMap((v) => v.slice(from, to).map(Math.abs)), 0);
  const translation = largest(opensees.displacements, 0, 3);
  for (const node of model.nodes)
    for (let i = 0; i < 3; i++)
      expect(Math.abs(rust.displacements[node.id][i] - opensees.displacements[node.id][i]), `${name} ${node.id} u${i}`).toBeLessThanOrEqual(relative * translation);
  const force = largest(opensees.reactions!, 0, 3);
  const moment = Math.max(largest(opensees.reactions!, 3, 6), force);
  for (const support of model.supports)
    for (let i = 0; i < 6; i++)
      expect(Math.abs(rust.reactions![support.nodeId][i] - opensees.reactions![support.nodeId][i]), `${name} ${support.nodeId} R${i}`).toBeLessThanOrEqual(relative * (i < 3 ? force : moment));
  const axial = Math.max(...Object.values(opensees.memberForces!).map((f) => Math.abs(f.axial)), 1);
  for (const member of model.members) {
    const [p, q] = [rust.memberForces![member.id], opensees.memberForces![member.id]];
    expect(Math.abs(p.axial - q.axial), `${name} ${member.id} axial`).toBeLessThanOrEqual(relative * axial);
    expect(Math.abs(p.momentStart - q.momentStart), `${name} ${member.id} moment`).toBeLessThanOrEqual(relative * Math.max(moment, axial));
  }
}

describe.skipIf(!liveUrl)('Rust solver against the OpenSees service', () => {
  const rust = createWasmSolver(() => readFile(new URL('./dof_solver.wasm', import.meta.url)));
  // The suite body still runs when the suite is skipped, so the address may be absent.
  const opensees = createOpenSeesSolver(liveUrl ?? '');

  it('agrees on a space frame with mixed connections', async () => {
    expectAgreement('space frame', await rust.analyze(spaceFrame), await opensees.analyze(spaceFrame), spaceFrame);
  });

  it('agrees that the same frame with its supports reduced is unstable', async () => {
    const loose = { ...spaceFrame, supports: spaceFrame.supports.map((s) => ({ ...s, restrained: PINNED })), members: spaceFrame.members.filter((m) => m.id !== 'brace').map((m) => ({ ...m, startFixity: 'pinned' as const })) };
    // Two solvers may find different bases and counts for the same mechanism,
    // and list different nodes for it; the verdict is what must agree.
    const [a, b] = [await rust.analyze(loose), await opensees.analyze(loose)];
    expect(a.status).toBe('unstable');
    expect(b.status).toBe('unstable');
  });

  it('agrees within the 1 % nonlinear gate on the stable space frame', async () => {
    // Two independent corotational formulations: equal to well inside the
    // criteria's 1 % gate for nonlinear reference quantities, not to rounding.
    const nonlinear: StructuralModel = { ...spaceFrame, analysis: { fidelity: 'nonlinear' } };
    expectAgreement('nonlinear space frame', await rust.analyze(nonlinear), await opensees.analyze(nonlinear), nonlinear, 1e-2);
  });

  it('agrees on the reference game structures', async () => {
    // Tower I and Bridge I carry no placed point loads (the translation sends
    // only those), so for them this checks stability and redundancy, and the
    // numerical comparison is of zero responses. Pickup I is loaded.
    expect(toStructuralModel(exampleModel('pickup1')!).model.loads.length).toBeGreaterThan(0);
    for (const id of ['tower1', 'bridge1', 'pickup1'] satisfies LevelId[]) {
      const { model } = toStructuralModel(exampleModel(id)!);
      expectAgreement(id, await rust.analyze(model), await opensees.analyze(model), model);
    }
  });

  it('agrees on the twenty library structures at both fidelities', { timeout: 120_000 }, async () => {
    const catalog = parseStructureLibrary(JSON.parse(await readFile(new URL('../../../public/structures/catalog.json', import.meta.url), 'utf8')));
    expect(catalog).toHaveLength(20);
    const unresolved: string[] = [];
    for (const record of catalog) {
      for (const fidelity of ['linear', 'nonlinear'] as const) {
        const { model } = toStructuralModel(record.save.model, { fidelity });
        const [r, o] = [await rust.analyze(model), await opensees.analyze(model)];
        const name = `${record.id} ${fidelity}`;
        // Rust reports `unresolved` when its nonlinear path cannot certify a
        // verdict; OpenSees classifies these two as unstable. Recorded, not
        // hidden: the list is pinned so a change in either direction is seen.
        if (r.status === 'unresolved' && o.status === 'unstable') {
          unresolved.push(name);
          continue;
        }
        // Linear analysis of a prestressed axial member differs by contract
        // reading (see docs/kb/rust-solver.md, "Cross-check with OpenSees"):
        // Rust adds prestress geometric stiffness and uses EA/L0, OpenSees
        // uses EA/L without it. Measured 5.8e-3 on the cable bridge.
        const prestressed = fidelity === 'linear' && model.members.some((m) => (m.initialStrain ?? 0) !== 0);
        expectAgreement(name, r, o, model, fidelity === 'nonlinear' || prestressed ? 1e-2 : 2e-5);
      }
    }
    expect(unresolved).toEqual(['03-cantilever nonlinear', '05-released-portal nonlinear']);
  });

  it('agrees on prestressed linear cables once the initial strain is removed', async () => {
    const catalog = parseStructureLibrary(JSON.parse(await readFile(new URL('../../../public/structures/catalog.json', import.meta.url), 'utf8')));
    for (const id of ['15-cable-bridge', '18-guyed-mast']) {
      const { model } = toStructuralModel(catalog.find((c) => c.id === id)!.save.model, { fidelity: 'linear' });
      const unstrained: StructuralModel = { ...model, members: model.members.map(({ initialStrain: _, ...m }) => m) };
      expectAgreement(id, await rust.analyze(unstrained), await opensees.analyze(unstrained), unstrained);
    }
  });
});
