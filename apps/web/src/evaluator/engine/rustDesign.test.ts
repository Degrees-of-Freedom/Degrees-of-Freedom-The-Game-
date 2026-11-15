import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../game/levels';
import { exampleModel } from '../../game/examples';
import { toEvaluatorInput } from '../../game/analysis';
import { parseStructureLibrary } from '../../game/structureLibrary';
import { wasmSolver } from '../../solver';
import { prepareGeometry } from '../geometry';
import { buildLoads, COMBOS, designLoadCase } from '../loads';
import { DESIGN_FORMULATION } from '../evidence';
import { evaluateStructure, RESERVE_LIMIT } from './rustDesign';

const library = parseStructureLibrary(JSON.parse(readFileSync(new URL('../../../public/structures/catalog.json', import.meta.url), 'utf8')));
const specimen = (prefix: string) => toEvaluatorInput(library.find(r => r.id.startsWith(prefix))!.save.model, LEVELS.library);
const example = (id: 'tower1' | 'bridge1' | 'pickup1') => toEvaluatorInput(exampleModel(id)!, LEVELS[id]);

describe('design load cases', () => {
  // The Rust cases keep self-weight and wind distributed; lumped to the nodes
  // they must be the same physical actions as the kernel's nodal loads.
  it.each(['tower1', 'bridge1', 'pickup1'] as const)('%s matches the lumped kernel loads in total', (id) => {
    const { model, level } = example(id);
    const { ctx } = prepareGeometry(model);
    for (const combo of COMBOS) {
      const lumped = designLoadCase(model, level, ctx, combo).F;
      const kernel = buildLoads(model, level, { ...ctx, eq: new Int32Array(0), nf: 0, bw: 0 } as never, combo).F;
      for (let axis = 0; axis < 3; axis++) {
        let a = 0, b = 0;
        for (let i = axis; i < lumped.length; i += 6) { a += lumped[i]; b += kernel[i]; }
        // Notional sway differs only where a variable load points upwards.
        expect(a).toBeCloseTo(b, 6);
      }
    }
  });
});

describe('Rust structure evaluation', () => {
  it.each(['tower1', 'bridge1', 'pickup1'] as const)('%s balances every combination and records verified evidence', async (id) => {
    const { model, level } = example(id);
    const result = await evaluateStructure(model, level, wasmSolver);
    expect(result.success).toBe(true);
    expect(result.secondOrder).toBe(true);
    expect(result.combos).toHaveLength(COMBOS.length);
    for (const combo of result.combos) {
      expect(combo.components!.every(c => c.verification?.formulation === DESIGN_FORMULATION && c.verification.status === 'verified-nonlinear')).toBe(true);
      for (let axis = 0; axis < 3; axis++) {
        let applied = 0;
        for (let i = axis; i < combo.F.length; i += 6) applied += combo.F[i];
        const reaction = Object.values(combo.reac!).reduce((sum, r) => sum + r[axis], 0);
        expect(Math.abs(reaction + applied)).toBeLessThan(1e-6 * Math.max(1, Math.abs(applied)));
      }
    }
  });

  // With two elements per member, a pin-ended strut can buckle between its
  // ends: the reserve then equals the strut's Euler load over its ultimate
  // compression. The bridge and pick-up references are governed that way.
  it.each(['bridge1', 'pickup1'] as const)('%s reports the Euler reserve of its critical strut', async (id) => {
    const { model, level } = example(id);
    const result = await evaluateStructure(model, level, wasmSolver);
    let euler = Infinity;
    for (const combo of result.combos.filter(c => c.combo.type === 'ULS'))
      for (const [e, force] of combo.ef!) {
        const compression = force.envelope!.Nc;
        if (e.it.kind !== 'beam' || e.rigidA || e.rigidB || compression < 1e-6) continue;
        euler = Math.min(euler, Math.PI ** 2 * e.it.E * Math.min(e.it.Iy, e.it.Iz) / e.L ** 2 / compression);
      }
    expect(result.alphaMin! / euler).toBeGreaterThan(0.98);
    expect(result.alphaMin! / euler).toBeLessThan(1.02);
  });

  it('caps the reserve of a stiff structure at the search limit', async () => {
    const { model, level } = specimen('01');
    expect((await evaluateStructure(model, level, wasmSolver)).alphaMin).toBe(RESERVE_LIMIT);
  });

  it('takes member demand from the engine envelope, not from end-force corrections', async () => {
    const { model, level } = example('tower1');
    const result = await evaluateStructure(model, level, wasmSolver);
    for (const [id, member] of Object.entries(result.members)) {
      const envelopes = result.combos.filter(c => c.combo.type === 'ULS').map(c => c.ef!.get(member.e)!.envelope!);
      expect(member.demand.Nc).toBeCloseTo(Math.max(...envelopes.map(e => e.Nc)), 9);
      expect(member.demand.My).toBeCloseTo(Math.max(...envelopes.map(e => e.My)), 9);
      expect(Number(id)).toBe(member.e.m.id);
    }
  });

  it('reports a slender column that buckles under its loads as buckling, not as a mechanism', async () => {
    const { model, level } = specimen('02');
    const result = await evaluateStructure(model, level, wasmSolver);
    expect(result.mechanism).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.bucklingFactor).toBeGreaterThan(0);
    expect(result.bucklingFactor).toBeLessThan(1);
    expect(result.unresolvedReason).toMatch(/^Buckles under/);
    expect(result.success).toBe(false);
  });

  it('reports a first-order mechanism even when the nonlinear recovery cannot prove it', async () => {
    const { model, level } = specimen('05');
    const result = await evaluateStructure(model, level, wasmSolver);
    expect(result.mechanism).toBe(true);
    expect(result.unstable.size).toBeGreaterThan(0);
  });

  // An 8 m IPE 300 cantilever buckles laterally at about 9 kN at its tip
  // (4.013 sqrt(EIz GJ) / L², Saint-Venant torsion): the factored loads of
  // the library cantilever pass that, and the path stops near there.
  it('explains a lateral-torsional stall as likely buckling', async () => {
    const { model, level } = specimen('03');
    const result = await evaluateStructure(model, level, wasmSolver);
    expect(result.mechanism).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.unresolvedReason).toMatch(/No equilibrium beyond \d+ % .*lateral-torsional/);
  });

  it('keeps floating parts out of the response and reports them', async () => {
    const { model, level } = specimen('19');
    const result = await evaluateStructure(model, level, wasmSolver);
    expect(result.floating.length).toBeGreaterThan(0);
    expect(result.combos[0].components!.some(c => c.status === 'unsupported')).toBe(true);
    expect(result.combos[0].components!.some(c => c.status === 'computed')).toBe(true);
  });

  it('rejects an empty or unfounded model before calling the solver', async () => {
    const calls: unknown[] = [];
    const spy = { analyzeCases: async (...args: unknown[]) => { calls.push(args); throw new Error('unused'); } };
    expect((await evaluateStructure({ members: [], attrs: {}, nextId: 1 }, LEVELS.sandbox, spy)).error).toBe('Nothing built yet.');
    const { model, level } = specimen('20');
    expect((await evaluateStructure(model, level, spy)).error).toMatch(/No foundation/);
    expect(calls).toHaveLength(0);
  });
});
