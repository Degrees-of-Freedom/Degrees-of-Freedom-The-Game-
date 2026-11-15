/**
 * The structure as the Rust solver sees it, without loads: the design load
 * cases supply those (see `designLoadCase`).
 *
 * - Nodes are every analytical endpoint, floating ones included, so the
 *   solver reports an unattached part as its own unsupported component.
 * - Member local axes follow the evaluator's (`orientation` is local z), so
 *   a section's strong and weak axes agree with the design checks.
 * - A beam end is rigid at a printed fixed end or, without a printing, at a
 *   joint; otherwise bending is released and torsion is held. A ball end
 *   also releases torsion at that end. A printed six-axis connection card
 *   is sent with its own axes and laws.
 * - Cables are tension-only, with their printed rest length or else the
 *   card pretension as initial strain. A spring is a two-way axial member
 *   whose EA/L equals its printed stiffness, as in the release adapter.
 * - A foundation restrains its mask, or all six degrees of freedom.
 */
import type { AnalysisMember, AnalysisModel, AnalysisSection, ConnectionLaws, MemberConnection, Vector3 } from '@dof/solver-contract';
import type { FrameConnection } from '../connections';
import type { EvaluatorMember, EvaluatorModel } from '../model';
import type { Context } from '../results';
import { ITEMS } from '../sections';
import { localAxes } from '../vector';
import { sectionFor } from './siSections';

const FIXED = [true, true, true, true, true, true] as const;
const triple = (values: readonly number[]): Vector3 => [values[0], values[1], values[2]];

/** A printed connection card's laws in the contract's form. */
export function printedConnection(law: FrameConnection): MemberConnection {
  const component = (index: number) => {
    const axis = law.laws[index];
    return axis.kind === 'locked' ? 'rigid' as const : axis.kind === 'free' ? 'free' as const : { elastic: axis.stiffness };
  };
  const laws: ConnectionLaws = [component(0), component(1), component(2), component(3), component(4), component(5)];
  return { axes: law.axes, laws };
}

/** End laws of a beam without a printed connection card. */
function endConnection(model: EvaluatorModel, m: EvaluatorMember, end: 'a' | 'b'): MemberConnection | undefined {
  const printed = end === 'a' ? m.endA : m.endB;
  const law = end === 'a' ? m.connectionA : m.connectionB;
  if (law) return printedConnection(law);
  const rigid = printed ? printed === 'fixed' : !!model.attrs[end === 'a' ? m.a : m.b]?.joint;
  if (rigid) return undefined;
  const torsion = printed === 'ball' ? 'free' : 'rigid';
  return { laws: ['rigid', 'rigid', 'rigid', torsion, 'free', 'free'] };
}

export function designModel(model: EvaluatorModel, ctx: Context, version: string): AnalysisModel {
  const sections = new Map<string, AnalysisSection>();
  const position = (key: string) => ctx.pos[ctx.idx.get(key)!];
  const members = model.members.map((m): AnalysisMember => {
    const start = position(m.a), finish = position(m.b);
    const delta = finish.map((v, i) => v - start[i]);
    const length = Math.hypot(...delta);
    const base = { id: String(m.id), startNodeId: m.a, endNodeId: m.b,
      parentId: String(m.parentSpan?.memberId ?? m.id), sectionId: m.type };
    if (ITEMS[m.type].kind === 'spring') {
      const fraction = m.parentSpan ? (m.parentSpan.toQuarter - m.parentSpan.fromQuarter) / 4 : 1;
      const stiffness = m.springStiffnessNPerM ?? ITEMS.spring.stiffnessNPerM;
      const sectionId = 'spring:' + m.id;
      sections.set(sectionId, { id: sectionId, A: 1, E: stiffness * length / fraction });
      return { ...base, sectionId, kind: 'brace', restLength: length };
    }
    if (!sections.has(m.type)) sections.set(m.type, sectionFor(m.type));
    if (m.type === 'cable') {
      const cable = ITEMS.cable;
      return m.restLengthM !== undefined
        ? { ...base, kind: 'cable', restLength: m.restLengthM }
        : { ...base, kind: 'cable', initialStrain: cable.P0 / (cable.E * cable.A) };
    }
    const start_ = endConnection(model, m, 'a'), end_ = endConnection(model, m, 'b');
    return { ...base, kind: 'beam', orientation: triple(localAxes(delta.map(v => v / length))[2]),
      ...(start_ && { start: start_ }), ...(end_ && { end: end_ }) };
  });
  return {
    version,
    nodes: ctx.keys.map((id, i) => ({ id, position: triple(ctx.pos[i]) })),
    sections: [...sections.values()],
    members,
    foundations: ctx.keys.filter(id => model.attrs[id]?.found)
      .map(id => ({ id, nodeId: id, restrained: model.attrs[id].restraint ?? FIXED })),
    loads: [],
  };
}
