import type { VoxelLevel, VoxelModel } from './voxelInput';
import type { VoxelAnalysis } from './voxelResults';
import { analyzeVoxel } from './voxel';
import { ITEMS, type BeamType } from './voxelSections';
import { checkMember, govern } from './voxelDesignChecks';
/** Resize beam sections from available supply and reanalyse, without mutating the input. */
export function autoDesignVoxel(
  input: VoxelModel,
  LV: VoxelLevel,
): { model: VoxelModel; analysis: VoxelAnalysis; changed: boolean } {
  // Work on a copy so callers can commit the complete operation as one undo step.
  const model = {
    ...input,
    members: input.members.map((m) => ({ ...m })),
    attrs: Object.fromEntries(
      Object.entries(input.attrs).map(([k, a]) => [k, { ...a }]),
    ),
  };
  let analysis = analyzeVoxel(model, LV),
    changedAny = false;
  if (!analysis.error && !analysis.mechanism) {
    const order: BeamType[] = (
      ['shs', 'glulam', 'ipe', 'heb'] as BeamType[]
    ).sort((a, b) => ITEMS[a].cost - ITEMS[b].cost);
    for (let round = 0; round < 4; round++) {
      if (analysis.error || analysis.mechanism) break;
      const pool = Object.fromEntries(
        order.map((t) => [t, LV.inv ? LV.inv[t] || 0 : Infinity]),
      );
      const beams = model.members.filter((m) => ITEMS[m.type].kind === 'beam');
      const analysed = beams.filter((m) => analysis.members[m.id]);
      beams
        .filter((m) => !analysis.members[m.id])
        .forEach((m) => pool[m.type]--);
      analysed.sort(
        (a, b) => analysis.members[b.id].util - analysis.members[a.id].util,
      );
      let changed = false;
      for (const m of analysed) {
        const r = analysis.members[m.id];
        let best: BeamType | null = null,
          bestU = Infinity,
          fallback: BeamType | null = null;
        for (const t of order) {
          if (pool[t] <= 0) continue;
          const u = govern(
            checkMember(ITEMS[t], r.demand, r.e.L, r.e.rigidA, r.e.rigidB),
          ).util;
          if (u <= 0.95) {
            best = t;
            break;
          }
          if (u < bestU) {
            bestU = u;
            fallback = t;
          }
        }
        const t = best || fallback || m.type;
        pool[t]--;
        if (t !== m.type) {
          m.type = t;
          changed = true;
        }
      }
      if (!changed) break;
      changedAny = true;
      analysis = analyzeVoxel(model, LV);
    }
  }
  return { model, analysis, changed: changedAny };
}
