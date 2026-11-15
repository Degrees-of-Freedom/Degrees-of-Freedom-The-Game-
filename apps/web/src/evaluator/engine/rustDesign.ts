/**
 * Structure evaluation on the Rust solver: the engine behind the editor,
 * the challenge levels, auto-design and the structure library.
 *
 * Every design combination of `loads.ts` becomes one Rust load case. The
 * analysis is geometrically nonlinear, so second-order (P-Δ) moments are in
 * the cut forces and no amplification factor is applied afterwards. Ultimate
 * combinations also run the solver's linearised stability reserve search
 * about the verified state. Its lower bound is the buckling factor α_cr the
 * objectives report, capped at `RESERVE_LIMIT` (shown as "> 128"). With two
 * elements per member it includes a strut buckling between its ends, which
 * the voxel kernel's one-element screen could not see. Design checks,
 * objectives and stars then run on the projected responses, as for any
 * engine.
 *
 * Only verified components contribute forces, reactions and displacements.
 * Units in the evaluation are kN, kN m and m; the solver's are SI.
 */
import type {
  AnalysisComponent, AnalysisLoadCase, AnalysisOptions, DetailedAnalysisResult, LoadCaseSolver,
} from '@dof/solver-contract';
import { allNodeKeys, prepareGeometry } from '../geometry';
import { COMBOS, designLoadCase, type DesignLoadCase } from '../loads';
import type { EvaluatorLevel, EvaluatorModel } from '../model';
import type { Combo, ComponentResponse, Context, LoadCombo, StructureEvaluation } from '../results';
import { checkDesign } from '../designChecks';
import { evaluateObjectives } from '../objectives';
import { DESIGN_FORMULATION } from '../evidence';
import { vecToLocal } from '../vector';
import { designModel } from './designModel';
import { GRAVITY, SI_PER_KILO } from './siSections';

/** Largest load multiplier the reserve search tries, as the voxel screen did. */
export const RESERVE_LIMIT = 128;
/** Residual, force and moment imbalance a result must meet to be used. */
const RESIDUAL_GATE = 1e-5;

const OPTIONS: AnalysisOptions = {
  fidelity: 'nonlinear', memberFields: true, subdivisions: 2, residualGate: RESIDUAL_GATE,
  gravity: [0, 0, -GRAVITY],
  // Factored combinations and the reserve search need more than the
  // single-case default; the browser worker's time limit still applies.
  maxTotalIterations: 4000, maxRequestIterations: 40000,
};

function caseFor(ctx: Context, load: DesignLoadCase, id: string): AnalysisLoadCase {
  const loads = [...load.nodal].map(([a, force]) => {
    const nodeId = ctx.keys[ctx.act[a]];
    return { id: `load:${nodeId}`, nodeId, force: force.map(v => v * SI_PER_KILO) as [number, number, number] };
  });
  return {
    id,
    loads,
    memberLoads: [...load.members].map(([e, perMetre]) => ({
      id: `member:${e.m.id}`, memberId: String(e.m.id), force: perMetre.map(v => v * SI_PER_KILO) as [number, number, number],
    })),
    ...(load.selfWeightFactor ? { gravity: [0, 0, -GRAVITY * load.selfWeightFactor] } : { selfWeight: false }),
  };
}

function scopeFor(scope: AnalysisComponent): ComponentResponse {
  const { residual, forceImbalance: force, momentImbalance: moment } = scope.convergence;
  const gated = [residual, force, moment].every(n => n !== null && Number.isFinite(n) && n >= 0 && n <= RESIDUAL_GATE);
  const valid = scope.resultsValid && scope.convergence.converged && gated &&
    (scope.status === 'stable' || scope.status === 'marginal');
  const reason = scope.reasonCodes.join(', ') || (valid ? 'Verified nonlinear equilibrium.' : 'Nonlinear equilibrium unavailable.');
  // A first-order mechanism is reported as one even when the solver could
  // not also prove it through finite deformation: the editor asks whether the
  // structure moves freely. A load-induced instability has no verified
  // response and is reported through the buckling factor, not as a mechanism.
  const status: ComponentResponse['status'] = valid ? 'computed'
    : scope.flags.unsupported ? 'unsupported'
      : scope.flags.excessiveDeformation ? 'excessive-displacement'
        : scope.flags.mechanism ? 'mechanism'
          : 'unresolved';
  return {
    status, nodes: [...scope.nodeIds], memberIds: scope.memberIds.map(Number), reason,
    ...(scope.flags.excessiveDeformation && { excessiveDeformation: true }),
    ...(status === 'mechanism' && scope.unstableNodeIds.length > 0 && {
      instabilityWitness: { nodes: [...scope.unstableNodeIds], memberIds: [], reason },
    }),
    verification: valid
      ? { formulation: DESIGN_FORMULATION, status: 'verified-nonlinear', nonlinear: { residual: residual!, force: force!, moment: moment! } }
      : { formulation: DESIGN_FORMULATION, status: 'unverified', reason },
  };
}

/** One combination's response in evaluator units, from verified components only. */
function project(ctx: Context, combo: LoadCombo, load: DesignLoadCase, result: DetailedAnalysisResult): Combo {
  const components = result.components.map(scopeFor);
  const out: Combo = { combo, F: load.F, vis: load.vis, components,
    partialDisplacements: new Map(), ef: new Map(), reac: {} };
  if (result.analysis.status !== 'ok' || !components.some(c => c.status === 'computed')) out.fail = true;
  const verified = new Set(components.filter(c => c.status === 'computed').flatMap(c => c.nodes));
  let maxD = 0;
  for (let a = 0; a < ctx.NA; a++) {
    const key = ctx.keys[ctx.act[a]];
    if (!verified.has(key)) continue;
    const u = result.nodes[key]?.displacement;
    if (u) {
      out.partialDisplacements!.set(a, Float64Array.from(u));
      maxD = Math.max(maxD, Math.hypot(u[0], u[1], u[2]));
    }
    const support = result.foundations[key];
    if (support?.valid && support.reaction) out.reac![a] = Float64Array.from(support.reaction, v => v / SI_PER_KILO);
  }
  if (verified.size) out.maxD = maxD;
  // A complete response also fills the dense vector the panel and viewer use.
  const supported = components.filter(c => c.status !== 'unsupported');
  if (supported.length && supported.every(c => c.status === 'computed')) {
    out.u = new Float64Array(6 * ctx.NA);
    for (const [a, u] of out.partialDisplacements!) out.u.set(u, 6 * a);
  }
  for (const e of ctx.els) {
    const member = result.members[String(e.m.id)];
    const forces = member?.forces;
    if (!forces || !verified.has(e.m.a) || !verified.has(e.m.b)) continue;
    // Start forces are on the positive face; the evaluator's start actions are outward.
    const f = Float64Array.from([...forces.start.map(v => -v / SI_PER_KILO), ...forces.end.map(v => v / SI_PER_KILO)]);
    const ua = result.nodes[e.m.a]?.displacement, ub = result.nodes[e.m.b]?.displacement;
    if (!ua || !ub) continue;
    const ul = vecToLocal(Float64Array.from([...ua, ...ub]), e.R);
    const stations = member.stations?.map(s => ({ fraction: s.fraction, forces: s.forces.map(v => v / SI_PER_KILO) }));
    const cuts = stations?.length ? stations.map(s => s.forces) : [forces.start, forces.end].map(s => s.map(v => v / SI_PER_KILO));
    const envelope = { Nt: 0, Nc: 0, Vy: 0, Vz: 0, My: 0, Mz: 0 };
    for (const [N, Vy, Vz, , My, Mz] of cuts) {
      envelope.Nt = Math.max(envelope.Nt, N);
      envelope.Nc = Math.max(envelope.Nc, -N);
      envelope.Vy = Math.max(envelope.Vy, Math.abs(Vy));
      envelope.Vz = Math.max(envelope.Vz, Math.abs(Vz));
      envelope.My = Math.max(envelope.My, Math.abs(My));
      envelope.Mz = Math.max(envelope.Mz, Math.abs(Mz));
    }
    out.ef!.set(e, {
      f, ul, envelope,
      ...(stations && { stations }),
      ...(member.deflection && { sag: member.deflection.maxFromChord }),
      ...(e.cable && { slack: member.state === 'slack', cableTension: forces.end[0] / SI_PER_KILO }),
    });
  }
  return out;
}

/** Global buckling factor of an ultimate combination: the smallest reserve
 * of its verified components. Null when a reserve is unavailable. */
function reserveOf(result: DetailedAnalysisResult): number | null {
  let factor = Infinity;
  for (const scope of result.components) {
    if (!scope.resultsValid || !(scope.status === 'stable' || scope.status === 'marginal')) continue;
    if (!scope.reserve) return null;
    factor = Math.min(factor, scope.reserve.lower);
  }
  return factor;
}

/**
 * Evaluate `model` under `level` with the Rust solver. Resolves with an
 * evaluation in every case: rejected input, a timeout or solver failure
 * appear as `error` or unresolved components. Rejects only on abort.
 */
export async function evaluateStructure(
  model: EvaluatorModel, level: EvaluatorLevel, solver: LoadCaseSolver, signal?: AbortSignal,
): Promise<StructureEvaluation> {
  const t0 = performance.now();
  const keys = allNodeKeys(model);
  const out: StructureEvaluation = {
    members: {}, nodes: {}, found: {}, objectives: [], combos: [], floating: [],
    unstable: new Set<string>(), mechanism: false, designChecksAvailable: level.loadCase !== 'applied',
  };
  if (!keys.length) {
    out.error = 'Nothing built yet.';
    return out;
  }
  const { ctx, floating } = prepareGeometry(model, keys);
  out.floating = floating;
  if (!ctx.isF.some(Boolean)) {
    out.error = 'No foundation — place at least one foundation on the ground.';
    return out;
  }
  out.ctx = ctx;
  const appliedLabel = level.appliedSelfWeight === false ? 'Applied loads only' : 'Applied loads + self-weight';
  const combos: LoadCombo[] = level.loadCase === 'applied'
    ? [{ name: appliedLabel, short: appliedLabel, type: 'SLS', dir: [0, 0, 0] }]
    : COMBOS;
  const loads = combos.map(combo => designLoadCase(model, level, ctx, combo));
  const structure = designModel(model, ctx, `evaluator/${model.nextId}`);
  const cases = loads.map((load, i) => caseFor(ctx, load, String(i)));
  const uls = combos.flatMap((c, i) => c.type === 'ULS' ? [i] : []);
  const sls = combos.flatMap((c, i) => c.type === 'ULS' ? [] : [i]);
  const results: DetailedAnalysisResult[] = new Array(combos.length);
  const run = async (indices: number[], options: AnalysisOptions) => {
    if (!indices.length) return;
    const answer = await solver.analyzeCases(structure, indices.map(i => cases[i]), options, signal);
    answer.cases.forEach(({ result }, j) => (results[indices[j]] = result));
  };
  // Linearised buckling about each verified ultimate state: one factorisation
  // per probe. It subsumes the solver's 1.25 margin probe, which is skipped.
  await run(uls, { ...OPTIONS, reserveSearch: RESERVE_LIMIT, reserveMethod: 'linearized', stabilityMargin: 1 });
  await run(sls, OPTIONS);
  const invalid = results.find(r => r.analysis.status !== 'ok');
  if (invalid) out.error = invalid.analysis.diagnostics.map(d => d.message).join(' ') || 'The structural solver could not analyse this model.';

  out.alpha = [];
  out.secondOrder = true;
  let buckling = Infinity;
  let stalled: { fraction: number; combo: string } | undefined;
  let deformed: { metres: number; combo: string } | undefined;
  let buckledUnder = '';
  combos.forEach((combo, i) => {
    const projected = project(ctx, combo, loads[i], results[i]);
    projected.components!.forEach((scope, j) => {
      const raw = results[i].components[j];
      if (scope.status === 'excessive-displacement' && !raw.flags.mechanism) {
        // A converged but excessively deformed equilibrium without a
        // first-order mechanism: typically a post-buckled member.
        out.unresolved = true;
        const metres = raw.maxDisplacement ?? 0;
        if (!deformed || metres > deformed.metres) deformed = { metres, combo: combo.short };
        for (const key of scope.nodes) out.unstable.add(key);
      } else if (scope.status === 'mechanism' || scope.status === 'excessive-displacement') {
        out.mechanism = true;
        for (const key of scope.instabilityWitness?.nodes ?? scope.nodes) out.unstable.add(key);
      } else if (scope.status === 'unresolved' && raw.flags.loadInducedInstability) {
        // Buckling below the combination's full load: its critical factor
        // is the buckling factor the objectives judge.
        const factor = raw.criticalLoadFactor ?? raw.convergence.loadFractionReached;
        if (factor < buckling) buckledUnder = combo.short;
        buckling = Math.min(buckling, factor);
        for (const key of raw.unstableNodeIds) out.unstable.add(key);
      } else if (scope.status === 'unresolved') {
        out.unresolved = true;
        const fraction = raw.convergence.loadFractionReached;
        if (raw.reasonCodes.includes('noConvergence') && fraction < 1 && (!stalled || fraction < stalled.fraction))
          stalled = { fraction, combo: combo.short };
      }
    });
    if (combo.type === 'ULS') out.alpha!.push(reserveOf(results[i]));
    out.combos.push(projected);
  });
  if (out.error) out.unresolved = true;
  if (buckling < Infinity) out.bucklingFactor = buckling;
  if (out.unresolved && buckling < Infinity)
    out.unresolvedReason = `Buckles under the ${buckledUnder} loads (α<sub>cr</sub> = ${buckling.toFixed(2)}): brace or stiffen the compressed members.`;
  else if (stalled)
    out.unresolvedReason = `No equilibrium beyond ${Math.round(stalled.fraction * 100)} % of the ${stalled.combo} loads. ` +
      'This is usually buckling (lateral-torsional for an open section): brace or stiffen the members.';
  else if (deformed)
    out.unresolvedReason = `Deforms excessively under the ${deformed.combo} loads (largest movement ${deformed.metres.toFixed(2)} m). ` +
      'This is usually a buckled member: brace or stiffen it.';
  else if (out.alpha.some(a => a === null)) {
    out.unresolved = true;
    out.unresolvedReason = 'The stability reserve could not be resolved within the iteration budget.';
  }
  const aMin = Math.min(buckling, ...out.alpha.map(a => a ?? Infinity));
  if (out.designChecksAvailable && !out.mechanism && !out.unresolved) {
    out.alphaMin = aMin;
    out.amp = 1;
  }
  const design = checkDesign(model, ctx, out, new Map());
  evaluateObjectives(model, level, ctx, out, aMin, 1, design);
  out.time = performance.now() - t0;
  return out;
}
