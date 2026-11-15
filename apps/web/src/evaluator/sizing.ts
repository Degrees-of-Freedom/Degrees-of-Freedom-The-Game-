import type { EvaluatorLevel, EvaluatorModel } from './model';
import type { StructureEvaluation } from './results';
import { ITEMS, type BeamType } from './sections';
import { checkMember, govern } from './designChecks';
/** Analyse a model under a level: the engine the sizing loop calls. */
export type Evaluate = (model: EvaluatorModel, level: EvaluatorLevel) => Promise<StructureEvaluation>;

/** Utilisation a resized member must stay within under its current demand. */
const TARGET = 0.95;
/** Re-evaluations allowed after the first sizing round. */
const ROUNDS = 6;

/** Resize beam sections from available supply and reanalyse with `evaluate`,
 * without mutating the input. Each round visits members from the most to the
 * least utilised and picks the cheapest available section whose design
 * checks, under the member's current demand, stay within `TARGET`, else the
 * least utilised one. Demand depends on stiffness (a second-order engine
 * redistributes forces when sections change), so after the first round only
 * members above `TARGET` are resized; the others keep their section while
 * supply lasts. This makes the loop settle instead of oscillating. */
export async function autoDesign(
  input: EvaluatorModel,
  LV: EvaluatorLevel,
  evaluate: Evaluate,
): Promise<{ model: EvaluatorModel; analysis: StructureEvaluation; changed: boolean }> {
  // Work on a copy so callers can commit the complete operation as one undo step.
  const model = {
    ...input,
    members: input.members.map((m) => ({ ...m })),
    attrs: Object.fromEntries(
      Object.entries(input.attrs).map(([k, a]) => [k, { ...a }]),
    ),
  };
  let analysis = await evaluate(model, LV),
    changedAny = false;
  if (!analysis.error && !analysis.mechanism && !analysis.unresolved) {
    const order: BeamType[] = (
      ['shs', 'glulam', 'ipe', 'heb'] as BeamType[]
    ).sort((a, b) => ITEMS[a].cost - ITEMS[b].cost);
    for (let round = 0; round < ROUNDS; round++) {
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
        if (round > 0 && r.util <= TARGET && pool[m.type] > 0) {
          pool[m.type]--;
          continue;
        }
        let best: BeamType | null = null,
          bestU = Infinity,
          fallback: BeamType | null = null;
        for (const t of order) {
          if (pool[t] <= 0) continue;
          const u = govern(
            checkMember(ITEMS[t], r.demand, r.e.L, r.e.rigidA, r.e.rigidB),
          ).util;
          if (u <= TARGET) {
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
      analysis = await evaluate(model, LV);
    }
  }
  return { model, analysis, changed: changedAny };
}
