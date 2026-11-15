import { describe, expect, it } from 'vitest';
import { analyzeVoxel } from '../solver/voxel/analyze';
import { assessCardCapacity, type CapacityCheck, type CollarLoad } from './capacity';
import type { EvaluatorModel } from './model';
import type { AttachmentSite } from '../game/attachmentSites';
import type { Frame } from '../game/jointFreedom';

function verified(check: CapacityCheck) {
  if (check.status !== 'verified') throw new Error(check.reason);
  return check;
}

/** Independent mechanics fixture: an 8 m continuous HEB has one ideal fixed
 * collar and two free loaded arms. Source and receiving-joint loads deliberately
 * share a solver node while retaining separate physical attribution. */
function fixture(quarter: 1 | 2 | 3, directSourceKN = 0, receivingJointKN = 0, rotated = false) {
  const positions: NonNullable<EvaluatorModel['positions']> = rotated
    ? { left: [2, 0, 1], collar: [2, quarter, 1], right: [2, 4, 1] }
    : { left: [0, 2, 1], collar: [quarter, 2, 1], right: [4, 2, 1] };
  const model: EvaluatorModel = {
    nextId: 4, positions,
    attrs: {
      left: { load: 3 }, right: { load: 5 },
      collar: { found: true, locked: true, load: directSourceKN + receivingJointKN },
    },
    members: [
      { id: -12, type: 'heb', a: 'left', b: 'collar', endA: 'fixed', endB: 'fixed', parentSpan: { memberId: 3, fromQuarter: 0, toQuarter: quarter } },
      { id: -13, type: 'heb', a: 'collar', b: 'right', endA: 'fixed', endB: 'fixed', parentSpan: { memberId: 3, fromQuarter: quarter, toQuarter: 4 } },
    ],
  };
  const analysis = analyzeVoxel(model, { type: 'sandbox', q0: 0, budget: Infinity, inv: null, loadCase: 'applied', appliedSelfWeight: false });
  const site = `q${quarter}` as AttachmentSite;
  const direct: CollarLoad[] = directSourceKN ? [{ memberId: 3, end: site, force: [0, 0, -directSourceKN] }] : [];
  const report = assessCardCapacity(model, analysis, [{ memberId: 3, end: site, profile: 'fixed' }], direct);
  return { model, analysis, report, site };
}

function solve(model: EvaluatorModel) {
  return analyzeVoxel(model, { type: 'sandbox', q0: 0, budget: Infinity, inv: null, loadCase: 'applied', appliedSelfWeight: false });
}

describe('fixed interior collar capacity', () => {
  it.each([1, 2, 3] as const)('recovers one signed external resultant at original quarter %i', quarter => {
    const { report } = fixture(quarter);
    const check = verified(report.connections[`3:q${quarter}`]);
    // Opposing arm moments subtract. Adding their absolute values would
    // overestimate demand and treating both cuts as cards would double count.
    const moment = 3 * (2 * quarter) - 5 * (8 - 2 * quarter);
    expect(check.station).toBe(quarter / 4);
    expect(check.actions.Vz).toBeCloseTo(8, 8);
    expect(check.actions.My).toBeCloseTo(moment, 8);
    expect(check.utilization).toBeCloseTo(Math.hypot(8 / 700, moment / 220), 8);
    expect(Object.keys(report.connections)).toEqual([`3:q${quarter}`]);
    expect(Object.keys(report.members)).toEqual(['3']);
  });

  it('includes a direct source-port load while excluding a receiving-joint load', () => {
    const source = verified(fixture(1, 7).report.connections['3:q1']);
    const receiving = verified(fixture(1, 0, 11).report.connections['3:q1']);
    const both = verified(fixture(1, 7, 11).report.connections['3:q1']);
    expect(source.actions.Vz).toBeCloseTo(15, 8);
    expect(receiving.actions.Vz).toBeCloseTo(8, 8);
    expect(both.actions.Vz).toBeCloseTo(15, 8);
    expect(source.actions.My).toBeCloseTo(-24, 8);
    expect(both.utilization).toBeCloseTo(Math.hypot(15 / 700, 24 / 220), 8);
  });

  it('transforms direct global source actions into the rotated parent frame', () => {
    const { report } = fixture(3, 7, 11, true);
    const check = verified(report.connections['3:q3']);
    expect(check.actions.N).toBeCloseTo(0, 8);
    expect(check.actions.Vy).toBeCloseTo(0, 8);
    expect(check.actions.Vz).toBeCloseTo(15, 8);
    expect(check.actions.My).toBeCloseTo(8, 8);
    expect(check.utilization).toBeCloseTo(Math.hypot(15 / 700, 8 / 220), 8);
  });

  it('checks an interior source in its saved local frame and respects its effective transfer law', () => {
    const { model, analysis } = fixture(3, 7, 11, true);
    const axes: Frame = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]];
    const attachment = { memberId: 3, end: 'q3' as const, profile: 'fixed' as const, axes };
    const loads: CollarLoad[] = [{ memberId: 3, end: 'q3', force: [0, 0, -7] }];
    const fixed = assessCardCapacity(model, analysis, [{ ...attachment, transferProfile: 'fixed' }], loads);
    expect(verified(fixed.connections['3:q3']).utilization).toBeCloseTo(Math.hypot(15 / 700, 8 / 220), 8);
    // An incompatible saved transfer law must not be treated as an end-B law
    // or silently promoted to fixed just because the source is an interior port.
    const incompatible = assessCardCapacity(model, analysis, [{ ...attachment, transferProfile: 'lock-x' }], loads);
    expect(incompatible.connections['3:q3']).toMatchObject({
      status: 'unavailable', reason: expect.stringContaining('released component'),
    });
  });

  it('withholds the collar if either adjoining segment loses verified response', () => {
    const { model, analysis, site } = fixture(2);
    const first = analysis.ctx!.els.find(e => e.m.id === -12)!;
    analysis.combos[0].ef!.delete(first);
    const report = assessCardCapacity(model, analysis, [{ memberId: 3, end: site, profile: 'fixed' }]);
    expect(report.members[3].status).toBe('unavailable');
    expect(report.connections['3:q2'].status).toBe('unavailable');
    expect(report.connections['3:q2']).not.toHaveProperty('utilization');
  });

  it('carries an incoming branch through the source collar by identity, independent of coincidence', () => {
    const { model } = fixture(1);
    model.positions!.branch = [1, 3, 1];
    model.attrs.branch = { load: 4 };
    model.members.push({ id: 4, type: 'heb', a: 'collar', b: 'branch', endA: 'fixed', endB: 'fixed' });
    const analysis = solve(model);
    const attachment = { memberId: 3, end: 'q1' as const, profile: 'fixed' as const, jointId: 'collar' };
    const branch = { memberId: 4, end: 'a' as const, profile: 'fixed' as const };
    const source = assessCardCapacity(model, analysis, [attachment, { ...branch, jointId: 'port:3:1' }]);
    const receiving = assessCardCapacity(model, analysis, [attachment, { ...branch, jointId: 'collar' }]);
    const sourceCheck = verified(source.connections['3:q1']);
    expect(sourceCheck.actions.Vz).toBeCloseTo(12, 8);
    expect(sourceCheck.actions.T).toBeCloseTo(8, 8);
    expect(sourceCheck.actions.My).toBeCloseTo(-24, 8);
    expect(sourceCheck.utilization).toBeCloseTo(Math.hypot(12 / 700, Math.hypot(8, 24) / 220), 8);
    const receivingCheck = verified(receiving.connections['3:q1']);
    expect(receivingCheck.actions.Vz).toBeCloseTo(8, 8);
    expect(receivingCheck.actions.T).toBeCloseTo(0, 8);
    const branchAxes: Frame = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]];
    const corrected = assessCardCapacity(model, analysis, [attachment, {
      ...branch, profile: 'lock-z', transferProfile: 'fixed', axes: branchAxes, jointId: 'port:3:1',
    }]);
    // The correction sleeve carries the originally released branch moment.
    // It still crosses the source collar, while the original card's own check
    // retains its saved local release rather than charging that moment twice.
    expect(verified(corrected.connections['4:a']).utilization).toBeCloseTo(4 / 400, 8);
    expect(verified(corrected.connections['3:q1']).actions.T).toBeCloseTo(8, 8);
    const incompatible = assessCardCapacity(model, analysis, [attachment, {
      ...branch, profile: 'lock-z', axes: branchAxes, jointId: 'port:3:1',
    }]);
    expect(incompatible.connections['3:q1']).toMatchObject({
      status: 'unavailable', reason: expect.stringContaining('released component'),
    });
  });

  it('recovers nested collar demands once and refuses a cyclic source attribution', () => {
    const { model } = fixture(1);
    model.positions!.lower = [1, 1, 1];
    model.positions!.upper = [1, 3, 1];
    model.attrs.lower = { load: 2 };
    model.attrs.upper = { load: 6 };
    model.members.push(
      { id: -16, type: 'heb', a: 'lower', b: 'collar', endA: 'fixed', endB: 'fixed', parentSpan: { memberId: 4, fromQuarter: 0, toQuarter: 2 } },
      { id: -18, type: 'heb', a: 'collar', b: 'upper', endA: 'fixed', endB: 'fixed', parentSpan: { memberId: 4, fromQuarter: 2, toQuarter: 4 } },
    );
    const analysis = solve(model);
    const root = { memberId: 3, end: 'q1' as const, profile: 'fixed' as const, jointId: 'collar' };
    const nested = { memberId: 4, end: 'q2' as const, profile: 'fixed' as const, jointId: 'port:3:1' };
    const report = assessCardCapacity(model, analysis, [root, nested]);
    const rootCheck = verified(report.connections['3:q1']);
    expect(rootCheck.actions.Vz).toBeCloseTo(16, 8);
    expect(rootCheck.actions.T).toBeCloseTo(8, 8);
    expect(rootCheck.actions.My).toBeCloseTo(-24, 8);
    const nestedCheck = verified(report.connections['4:q2']);
    expect(nestedCheck.actions.Vz).toBeCloseTo(8, 8);
    expect(Object.keys(report.connections)).toEqual(['3:q1', '4:q2']);
    const cycle = assessCardCapacity(model, analysis, [{ ...root, jointId: 'port:4:2' }, nested]);
    for (const key of ['3:q1', '4:q2']) {
      expect(cycle.connections[key]).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('Cyclic') });
      expect(cycle.connections[key]).not.toHaveProperty('utilization');
    }
  });
});
