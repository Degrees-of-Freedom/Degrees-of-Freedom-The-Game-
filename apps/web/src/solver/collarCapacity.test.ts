import { describe, expect, it } from 'vitest';
import { analyzeVoxel } from './voxel';
import { assessCardCapacity, type CapacityCheck, type CollarLoad } from './voxelCapacity';
import type { VoxelModel } from './voxelInput';
import type { AttachmentSite } from '../game/attachmentSites';

function verified(check: CapacityCheck) {
  if (check.status !== 'verified') throw new Error(check.reason);
  return check;
}

/** Independent mechanics fixture: an 8 m continuous HEB has one ideal fixed
 * collar and two free loaded arms. Source and receiving-joint loads deliberately
 * share a solver node while retaining separate physical attribution. */
function fixture(quarter: 1 | 2 | 3, directSourceKN = 0, receivingJointKN = 0, rotated = false) {
  const positions: NonNullable<VoxelModel['positions']> = rotated
    ? { left: [2, 0, 1], collar: [2, quarter, 1], right: [2, 4, 1] }
    : { left: [0, 2, 1], collar: [quarter, 2, 1], right: [4, 2, 1] };
  const model: VoxelModel = {
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

  it('withholds the collar if either adjoining segment loses verified response', () => {
    const { model, analysis, site } = fixture(2);
    const first = analysis.ctx!.els.find(e => e.m.id === -12)!;
    analysis.combos[0].ef!.delete(first);
    const report = assessCardCapacity(model, analysis, [{ memberId: 3, end: site, profile: 'fixed' }]);
    expect(report.members[3].status).toBe('unavailable');
    expect(report.connections['3:q2'].status).toBe('unavailable');
    expect(report.connections['3:q2']).not.toHaveProperty('utilization');
  });
});
