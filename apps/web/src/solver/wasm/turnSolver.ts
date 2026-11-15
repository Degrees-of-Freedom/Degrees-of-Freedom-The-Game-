import type { AnalysisComponent, AnalysisModel, AnalysisSection, ConnectionLaws, DetailedAnalysisResult, MemberConnection, Vector3 } from '@dof/solver-contract';
import { sectionFor } from '../../game/analysisModel';
import type { FrameConnection } from '../frameConnections';
import { localAxes, vecToLocal } from '../frameMath';
import { prepareTurnGeometry } from '../voxel';
import type { VoxelMember, VoxelModel } from '../voxelInput';
import type { Combo, ComponentResponse, Context, Element, VoxelAnalysis } from '../voxelResults';
import { RELEASE_SOLVER } from '../voxelVerification';
import { createPreparedWasmSolver, type WasmSource } from './wasmSolver';

const fixed = [true, true, true, true, true, true] as const;
const ball = ['rigid', 'rigid', 'rigid', 'free', 'free', 'free'] as const;
const triple = (values: readonly number[]): Vector3 => [values[0], values[1], values[2]];

function attachment(end: VoxelMember['endA'], law?: FrameConnection): MemberConnection | undefined {
  if (!law) return end === 'ball' ? { laws: ball } : undefined;
  const component = (index: number) => {
    const axis = law.laws[index];
    return axis.kind === 'locked' ? 'rigid' : axis.kind === 'free' ? 'free' : { elastic: axis.stiffness };
  };
  const laws: ConnectionLaws = [component(0), component(1), component(2), component(3), component(4), component(5)];
  return { axes: law.axes, laws };
}

/** SI model of the explicit turn topology. An axial cartridge is a two-way
 * corotational bar with EA/L equal to its printed stiffness. Series segments
 * receive the inverse fraction of that stiffness. No beam properties are
 * assigned to a cartridge, and no rotational stiffness is added at a collar. */
export function turnReferenceModel(input: VoxelModel, ctx: Context, version: string): AnalysisModel {
  const sections = new Map<string, AnalysisSection>();
  const position = (key: string) => ctx.pos[ctx.idx.get(key)!];
  const nodes = ctx.keys.map((id, i) => ({ id, position: triple(ctx.pos[i]) }));
  const members: AnalysisModel['members'] = input.members.map(m => {
    const start = position(m.a), finish = position(m.b);
    const delta = finish.map((v, i) => v - start[i]);
    const length = Math.hypot(...delta);
    const base = { id: String(m.id), startNodeId: m.a, endNodeId: m.b,
      parentId: String(m.parentSpan?.memberId ?? m.id), sectionId: m.type };
    if (m.type === 'spring') {
      const fraction = m.parentSpan ? (m.parentSpan.toQuarter - m.parentSpan.fromQuarter) / 4 : 1;
      if (!(m.springStiffnessNPerM! > 0)) throw new Error('Spring printing has no stiffness.');
      const sectionId = 'spring:' + m.id;
      sections.set(sectionId, {id: sectionId, A: 1, E: m.springStiffnessNPerM! * length / fraction});
      return {...base, sectionId, kind: 'brace', restLength: length};
    }
    if (!sections.has(m.type)) sections.set(m.type, sectionFor(m.type));
    if (m.type === 'cable') {
      if (!(m.restLengthM! > 0)) throw new Error('Cable printing has no unstressed length.');
      return { ...base, kind: 'cable', restLength: m.restLengthM };
    }
    const orientation = triple(localAxes(delta.map(v => v / length))[2]);
    return { ...base, kind: 'beam', orientation, start: attachment(m.endA, m.connectionA), end: attachment(m.endB, m.connectionB) };
  });
  return { version, nodes, sections: [...sections.values()], members,
    foundations: ctx.keys.filter(id => input.attrs[id]?.found).map(id => ({ id, nodeId: id, restrained: input.attrs[id].restraint ?? fixed })),
    loads: ctx.keys.filter(id => input.attrs[id]?.load).map(id => ({ id: 'gravity:' + id, nodeId: id, force: [0, 0, -1000 * input.attrs[id].load!] })) };
}

function springStrokeExceeded(e: Element, result: DetailedAnalysisResult): boolean {
  if (e.it.kind !== 'spring') return false;
  const a = result.nodes[e.m.a]?.displacement, b = result.nodes[e.m.b]?.displacement;
  if (!a || !b) return true;
  const currentLength = Math.hypot(...e.ex.map((x, i) => e.L*x + b[i] - a[i]));
  return Math.abs(currentLength - e.L) > 0.1*e.L + 1e-12*e.L;
}

function scopeResponse(scope: AnalysisComponent, result: DetailedAnalysisResult, ctx: Context, model: AnalysisModel): ComponentResponse {
  const memberIds = scope.memberIds.map(Number);
  const ids = new Set(memberIds);
  const parts = ctx.els.filter(e => ids.has(e.m.id));
  const {residual, forceImbalance: force, momentImbalance: moment} = scope.convergence;
  const exceeded = scope.resultsValid && parts.some(e => springStrokeExceeded(e, result));
  const serviceabilityOnly = scope.flags.excessiveDeformation && !scope.flags.loadInducedInstability && !scope.flags.mechanism;
  const valid = !exceeded && scope.resultsValid && (scope.status !== 'unstable' || serviceabilityOnly) && scope.status !== 'unknown' &&
    scope.convergence.converged && [residual, force, moment].every(n => n !== null && Number.isFinite(n) && n >= 0 && n <= 1e-5);
  const reason = exceeded ? 'A spring exceeded its printed 10% stroke envelope.'
    : scope.reasonCodes.join(', ') || (valid ? 'Verified nonlinear equilibrium.' : 'Nonlinear equilibrium unavailable.');
  const status = valid ? 'computed' : scope.flags.unsupported ? 'unsupported' : exceeded || scope.flags.excessiveDeformation
    ? 'excessive-displacement' : scope.status === 'unstable' && (scope.flags.mechanism || scope.flags.loadInducedInstability) ? 'mechanism' : 'unresolved';
  const nodes = [...scope.unstableNodeIds];
  const witnessed = parts.filter(e => nodes.includes(e.m.a) || nodes.includes(e.m.b)).map(e => e.m.id);
  const tangent = scope.unstableTangent;
  // A single analytical parent may buckle between immovable end stations.
  if (tangent && !witnessed.length && memberIds.length === 1) witnessed.push(memberIds[0]);
  let comparison: NonNullable<ComponentResponse['instabilityWitness']>['comparison'];
  if (tangent && status === 'mechanism' && witnessed.length) {
    const nodeIds = new Set(scope.nodeIds), sections = new Set<string>();
    const byId = (a:{id:string}, b:{id:string}) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    const members = model.members.filter(m => ids.has(Number(m.id))).sort(byId);
    members.forEach(m => sections.add(m.sectionId));
    const topology = JSON.stringify([RELEASE_SOLVER, model.nodes.filter(n => nodeIds.has(n.id)).sort(byId), members,
      model.sections.filter(s => sections.has(s.id)).sort(byId), model.foundations.filter(s => nodeIds.has(s.nodeId)).sort(byId)]);
    comparison = {topology, ...tangent};
  }
  return { status, nodes: [...scope.nodeIds], memberIds, reason,
    ...(scope.flags.excessiveDeformation && {excessiveDeformation:true}),
    ...(status === 'mechanism' && witnessed.length > 0 && {instabilityWitness: {nodes, memberIds: witnessed, reason, comparison}}),
    verification: valid ? {formulation: RELEASE_SOLVER, status: 'verified-nonlinear', nonlinear: {residual: residual!, force: force!, moment: moment!}}
      : {formulation: RELEASE_SOLVER, status: 'unverified', reason} };
}

/** Adopt only quantities computed by the Rust kernel. The game view and card
 * strengths use kN, kN m and m. Rust reports N and N m on the positive cut
 * face; the legacy view's start actions are outward nodal actions. */
function project(input: VoxelModel, ctx: Context, result: DetailedAnalysisResult, model: AnalysisModel): VoxelAnalysis {
  const components = result.components.map(c => scopeResponse(c, result, ctx, model));
  const combo: Combo = { combo: {name: 'Card gravity', short: 'Gravity', type: 'SLS', dir: [0, 0, -1]},
    components, F: new Float64Array(6*ctx.NA), vis: [], partialDisplacements: new Map(), ef: new Map(), reac: {} };
  const analysis: VoxelAnalysis = { ctx, combos: [combo], members: {}, nodes: {}, found: {}, objectives: [],
    ...(result.analysis.modelVersion && {reference:{modelVersion:result.analysis.modelVersion,
      solverVersion:result.analysis.solverVersion, fidelity:'nonlinear' as const}}),
    appliedGravityKN:Object.values(input.attrs).reduce((sum, a) => sum + (a.load ?? 0), 0),
    mechanism: components.some(c => c.status === 'mechanism'), unresolved: components.some(c => c.status === 'unresolved' || c.status === 'excessive-displacement'),
    floating: components.filter(c => c.status === 'unsupported').flatMap(c => c.nodes),
    unstable: new Set(components.flatMap(c => c.instabilityWitness?.nodes ?? [])), designChecksAvailable: false };
  if (result.analysis.status !== 'ok') analysis.error = result.analysis.diagnostics.map(d => d.message).join(' ') || 'Browser solver unavailable.';
  const verified = new Set(components.filter(c => c.status === 'computed').flatMap(c => c.nodes));
  for (const [key, i] of ctx.idx) {
    const active = ctx.aid[i];
    if (active < 0) continue;
    const load = input.attrs[key]?.load ?? 0;
    combo.F[6*active + 2] = -load;
    if (load) combo.vis.push({a: active, v: [0,0,-load], kind: 'gravity'});
    if (!verified.has(key)) continue;
    const u = result.nodes[key]?.displacement;
    if (u) combo.partialDisplacements!.set(active, Float64Array.from(u));
    const support = result.foundations[key];
    if (support?.valid && support.reaction) combo.reac![active] = Float64Array.from(support.reaction, v => v/1000);
  }
  for (const e of ctx.els) {
    const member = result.members[String(e.m.id)];
    const forces = member?.forces;
    if (!forces || !verified.has(e.m.a) || !verified.has(e.m.b)) continue;
    const f = Float64Array.from([...forces.start.map(v => -v/1000), ...forces.end.map(v => v/1000)]);
    const ug = Float64Array.from([...result.nodes[e.m.a].displacement!, ...result.nodes[e.m.b].displacement!]);
    const ul = vecToLocal(ug, e.R);
    const samples = member.stations?.flatMap((s,i,all) =>
      s.motion && (i === 0 || s.fraction !== all[i-1].fraction) ? [{fraction:s.fraction, motion:[...s.motion]}] : []);
    if (samples?.length) {
      const actual = Float64Array.from([...samples[0].motion, ...samples[samples.length-1].motion]);
      ul.set(vecToLocal(actual, e.R));
    }
    const chord = e.ex.map((v,i) => v*e.L + ug[6+i] - ug[i]);
    const verticalTransferKN = member.stations?.[0] ? member.stations[0].globalForce[2]/1000 :
      e.it.kind !== 'beam' ? forces.end[0]/1000 * chord[2]/Math.hypot(...chord) : undefined;
    combo.ef!.set(e, {f, ul, motionSamples:samples, verticalTransferKN, stations: member.stations?.map(s => ({fraction: s.fraction, forces: s.forces.map(v => v/1000)})),
      ...(e.cable && { slack: member.state === 'slack', cableTension: forces.end[0]/1000 })});
  }
  return analysis;
}

export function createTurnSolver(source?: WasmSource) {
  const solver = createPreparedWasmSolver(source);
  // A pass, retry or before/after comparison may have identical physical
  // inputs. Reuse only a byte-for-byte match of the complete SI model. The
  // cache is scoped to this WASM instance and holds just the last response.
  let previous: { key: string; result: DetailedAnalysisResult } | undefined;
  return {
    prepare: solver.prepare,
    analyze(input: VoxelModel, version: string) {
      const {ctx} = prepareTurnGeometry(input);
      const model = turnReferenceModel(input, ctx, version);
      const key = JSON.stringify(model);
      if (previous?.key === key) return project(input, ctx, previous.result, model);
      let hash = 2166136261;
      for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
      model.version = version + '/' + (hash >>> 0).toString(16);
      const result = solver.analyzePrepared(model, {fidelity: 'nonlinear', subdivisions: 2, failure: 'report', residualGate: 1e-5, memberFields:true});
      if (result.analysis.status === 'ok' && result.analysis.solverVersion !== '0.2.0') throw new Error('Unsupported browser solver version.');
      if (result.analysis.status === 'ok') previous = {key, result};
      return project(input, ctx, result, model);
    },
  };
}
