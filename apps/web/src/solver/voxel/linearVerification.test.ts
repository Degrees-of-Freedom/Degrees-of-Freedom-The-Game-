import { describe, expect, it } from 'vitest';
import { analyzeVoxel } from './analyze';
import { solveComponents, componentSystems } from './components';
import { findComponents } from '../../evaluator/geometry';
import { verifyLinearResponse } from './linearVerification';
import { solveCombo } from './frameSolve';
import { alphaCr } from './frameStability';
import type { VoxelLevel, VoxelModel } from '../../evaluator/model';
import { analyzeTurn } from '../../game/turnAnalysis';
import { createTurnGame } from '../../game/turns';

const appliedOnly: VoxelLevel = {
  type: 'sandbox', loadCase: 'applied', appliedSelfWeight: false, q0: 0, budget: Infinity, inv: null,
};

// Two rigidly continuous spans on a pin and a roller. Holding the unloaded
// axial spin at the pin removes its inactive rigid rotation.
function beam(station: number): VoxelModel {
  const middle = `${station},0,0`;
  return {
    members: [
      { id: 1, type: 'ipe', a: '0,0,0', b: middle, endA: 'fixed', endB: 'fixed' },
      { id: 2, type: 'ipe', a: middle, b: '4,0,0', endA: 'fixed', endB: 'fixed' },
    ],
    attrs: {
      '0,0,0': { found: true, restraint: [true, true, true, true, false, false] },
      '4,0,0': { found: true, restraint: [false, true, true, false, false, false] },
      [middle]: { load: 2 },
    },
    nextId: 3,
  };
}

describe('applied linear frame verification', () => {
  it('preserves the conservative design-factor cutoff on both sides of the preview threshold', () => {
    const model: VoxelModel = {
      members: [{ id: 1, a: '0,0,0', b: '0,0,1', endA: 'fixed', endB: 'fixed', type: 'shs' }],
      attrs: {
        '0,0,0': { found: true },
        '0,0,1': { found: true, restraint: [false, true, true, true, true, true] },
      }, nextId: 2,
    };
    const ctx = analyzeVoxel(model, appliedOnly).ctx!;
    const solved = solveCombo(ctx, new Float64Array(ctx.NA * 6));
    if ('fail' in solved) throw Error('Expected a stable elastic stiffness');
    const e = ctx.els[0];
    // One free transverse translation yields K + lambda (6 N / 5L).
    for (const critical of [0.75, 9.99, 10.001, 10.25, 128, 200]) {
      solved.ef.get(e)!.f[6] = -solved.K0[0] * 5 * e.L / (6 * critical);
      const design = alphaCr(ctx, solved)!;
      const screened = alphaCr(ctx, solved, 10);
      expect(screened !== null).toBe(design >= 10);
      expect(design >= 10).toBe(critical >= 10.25);
    }
  });

  it.each([1, 2, 3])('recovers the analytic support split at station %i of four', station => {
    const result = analyzeVoxel(beam(station), appliedOnly);
    const ctx = result.ctx!, combo = result.combos[0];
    const support = (key: string) => combo.reac![ctx.aid[ctx.idx.get(key)!]];
    expect(combo.components![0].verification?.status).toBe('verified-linear');
    expect(support('0,0,0')[2]).toBeCloseTo(2 * (1 - station / 4), 10);
    expect(support('4,0,0')[2]).toBeCloseTo(2 * station / 4, 10);
  });

  it('rechecks signed free-axis and end-law residuals even when global sums are balanced', () => {
    const result = analyzeVoxel(beam(2), appliedOnly);
    const ctx = result.ctx!, combo = result.combos[0], active = ctx.act.map((_, a) => a);
    const left = ctx.aid[ctx.idx.get('0,0,0')!], right = ctx.aid[ctx.idx.get('4,0,0')!];
    combo.reac![left][0] = 3;
    combo.reac![right][0] = -3;
    const report = verifyLinearResponse(ctx, combo, active, ctx.els, Infinity);
    expect(report.residuals!.force).toBeLessThan(1e-10);
    expect(report.residuals!.moment).toBeLessThan(1e-10);
    expect(report.status).toBe('unverified');
    expect(report.residuals!.nodalBalance).toBeGreaterThan(0.1);
    combo.reac![left][0] = combo.reac![right][0] = 0;
    combo.ef!.get(ctx.els[0])!.ul[0] += 0.0001;
    const mismatched = verifyLinearResponse(ctx, combo, active, ctx.els, Infinity);
    expect(mismatched.status).toBe('unverified');
    expect(mismatched.residuals!.compatibility).toBeGreaterThan(1e-9);
    expect(mismatched.residuals!.memberLaw).toBeGreaterThan(1e-5);
  });

  it('balances a lateral load and an independent tip couple at an offset foundation', () => {
    const model: VoxelModel = {
      members: [{ id: 10, a: '3,2,0', b: '3,2,1', endA: 'fixed', endB: 'fixed', type: 'ipe' }],
      attrs: { '3,2,0': { found: true }, '3,2,1': { joint: true } }, nextId: 11,
    };
    const initial = analyzeVoxel(model, appliedOnly);
    const ctx = initial.ctx!, combo = initial.combos[0];
    const base = ctx.aid[ctx.idx.get('3,2,0')!], tip = ctx.aid[ctx.idx.get('3,2,1')!];
    const f = combo.F.slice();
    f[6 * tip] = 1;
    f[6 * tip + 4] = -0.25;
    const { components, labels } = findComponents(ctx.keys, ctx.idx, model.members, ctx.isF);
    const { result } = solveComponents(ctx, componentSystems(ctx, components, labels), components, combo.combo, f, []);
    expect(result.components![0].verification?.status).toBe('verified-linear');
    expect(result.reac![base][0]).toBeCloseTo(-1, 10);
    expect(result.reac![base][4]).toBeCloseTo(-1.75, 10);
    result.reac![base][4] += 0.25;
    const corrupt = verifyLinearResponse(ctx, result, [base, tip], ctx.els, Infinity);
    expect(corrupt.status).toBe('unverified');
    expect(corrupt.residuals!.moment).toBeGreaterThan(1e-5);
  });

  it('keeps signed linear reactions separate from cable and unsupported validity', () => {
    const model = beam(1);
    model.members.push({ id: 3, type: 'cable', a: '7,0,0', b: '7,0,1' });
    model.members.push({ id: 4, type: 'ipe', a: '9,0,0', b: '9,0,1' });
    model.attrs['7,0,0'] = model.attrs['7,0,1'] = { found: true };
    const [combo] = analyzeVoxel(model, appliedOnly).combos;
    expect(combo.components!.find(c => c.memberIds.includes(1))?.verification?.status).toBe('verified-linear');
    expect(combo.components!.find(c => c.memberIds.includes(3))?.verification?.status).toBe('unverified');
    expect(combo.components!.find(c => c.memberIds.includes(4))?.status).toBe('unsupported');
  });

  it('reports a released end force as an incompatible result', () => {
    const model = beam(1);
    model.members[0].endA = 'ball';
    model.attrs['4,0,0'].restraint![3] = true;
    const result = analyzeVoxel(model, appliedOnly);
    const ctx = result.ctx!, combo = result.combos[0], end = ctx.els[0];
    expect(combo.components![0].verification?.status).toBe('verified-linear');
    combo.ef!.get(end)!.f[4] = 0.1;
    const corrupt = verifyLinearResponse(ctx, combo, ctx.act.map((_, a) => a), ctx.els, Infinity);
    expect(corrupt.status).toBe('unverified');
    expect(corrupt.residuals!.releasedAction).toBeGreaterThan(1e-5);
  });

  it('matches card-only gravity and keeps the original turn preview load policy', () => {
    const turn = createTurnGame(23);
    turn.board.loads.push({ cardId: 'test', jointId: '5,3,1', magnitude: 10, owner: 'player-1' });
    const scored = analyzeTurn(turn, 'card-gravity'), original = analyzeTurn(turn);
    const reaction = (analysis: typeof scored) => analysis.combos[0].reac![analysis.ctx!.aid[analysis.ctx!.idx.get('5,3,0')!]][2];
    expect(scored.combos[0].components!.every(c => c.verification?.status === 'verified-linear')).toBe(true);
    expect(reaction(scored)).toBeCloseTo(10, 10);
    expect(reaction(original)).toBeGreaterThan(10);
  });

  it('withholds linear evidence for a compressed pin-ended member with lateral restraints at both tips', () => {
    const model: VoxelModel = {
      members: [{ id: 1, a: '0,0,0', b: '0,0,4', type: 'shs', endA: 'ball', endB: 'ball' }],
      attrs: {
        '0,0,0': { found: true },
        '0,0,4': { load: 50, found: true, restraint: [true, true, false, false, false, false] },
      },
      nextId: 2,
    };
    const [combo] = analyzeVoxel(model, appliedOnly).combos;
    expect(combo.components![0]).toMatchObject({ status: 'computed', verification: {
      status: 'unverified', reason: expect.stringContaining('buckling'),
    } });
  });
});
