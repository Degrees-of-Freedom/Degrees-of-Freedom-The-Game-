import type { VoxelLevel, VoxelModel } from './model';
import type { VoxelAnalysis } from './results';
import { ITEMS, type BeamType } from './sections';
import { checkMember, govern } from './designChecks';
/** Analyse a model under a level: the engine the sizing loop calls. */
export type Evaluate = (model: VoxelModel, level: VoxelLevel) => VoxelAnalysis;

/** Resize beam sections from available supply and reanalyse with `evaluate`,
 * without mutating the input. Up to four rounds; each round visits members
 * from the most to the least utilised and picks the cheapest available
 * section whose design checks, under the member's current demand, stay at
 * or below 95 %, else the least utilised one. */
export function autoDesign(
  input: VoxelModel,
  LV: VoxelLevel,
  evaluate: Evaluate,
): { model: VoxelModel; analysis: VoxelAnalysis; changed: boolean } {
  // Work on a copy so callers can commit the complete operation as one undo step.
  const model = {
    ...input,
    members: input.members.map((m) => ({ ...m })),
    attrs: Object.fromEntries(
      Object.entries(input.attrs).map(([k, a]) => [k, { ...a }]),
    ),
  };
  let analysis = evaluate(model, LV),
    changedAny = false;
  if (!analysis.error && !analysis.mechanism && !analysis.unresolved) {
    const order: BeamType[] = (
      ['shs', 'glulam', 'ipe', 'heb'] as BeamType[]
    ).sort((a, b) => ITEMS[a].cost - ITEMS[b].cost);
    for (let round = 0; round < 4; round++) {
      if (analysis.error || analysis.mechanism || analysis.unresolved) break;
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
      analysis = evaluate(model, LV);
    }
  }
  return { model, analysis, changed: changedAny };
}
