import type {
  AnalysisMember,
  AnalysisModel,
  AnalysisOptions,
  AnalysisResult,
  ConnectionLaws,
  DetailedAnalysisResult,
  MechanismMode,
  MemberForces,
  StabilityReport,
  StructuralModel,
  Vector6,
} from '@dof/solver-contract';

/**
 * Translation between the original `StructuralModel` contract and the
 * detailed contract of the Rust solver.
 *
 * The original contract carries no sections and no analysis type. The
 * choices made here are the ones the OpenSees service makes, so that the two
 * backends answer the same question for the same model:
 *
 * - one steel section for every member (200 x 200 x 10 mm square hollow
 *   section, from `services/opensees/src/dof_opensees/properties.py`);
 * - linear elastic analysis of the nodal loads only;
 * - a `pinned` end releases all three rotations;
 * - a member pinned at both ends is an axial member.
 */
const STEEL_SECTION = { id: 'steel', E: 210e9, G: 81e9, A: 7.49e-3, Iy: 4.47e-5, Iz: 4.47e-5, J: 7.03e-5 };

const BALL_JOINT: ConnectionLaws = ['rigid', 'rigid', 'rigid', 'free', 'free', 'free'];

/** The detailed contract names its foundations; the original one does not. */
const foundationId = (nodeId: string) => `support:${nodeId}`;

export function toAnalysisModel(
  model: StructuralModel,
): { model: AnalysisModel; options: AnalysisOptions } | { error: string } {
  if (model.units !== 'SI') return { error: 'Only SI units are supported.' };

  // Several supports on one node act together; the detailed contract wants
  // one foundation per node.
  const restrained = new Map<string, boolean[]>();
  for (const support of model.supports) {
    const flags = restrained.get(support.nodeId) ?? [false, false, false, false, false, false];
    restrained.set(support.nodeId, flags.map((flag, i) => flag || support.restrained[i]));
  }

  const members: AnalysisMember[] = model.members.map((member) => {
    const startPinned = member.startFixity === 'pinned';
    const endPinned = member.endFixity === 'pinned';
    const base = { id: member.id, startNodeId: member.startNodeId, endNodeId: member.endNodeId, sectionId: STEEL_SECTION.id };
    if (startPinned && endPinned) return { ...base, kind: 'brace' };
    return {
      ...base,
      kind: 'beam',
      // A beam is exact with one element under nodal loads.
      subdivisions: 1,
      ...(startPinned && { start: { laws: BALL_JOINT } }),
      ...(endPinned && { end: { laws: BALL_JOINT } }),
    };
  });

  return {
    model: {
      nodes: model.nodes.map((node) => ({ id: node.id, position: node.position })),
      sections: [STEEL_SECTION],
      members,
      foundations: [...restrained].map(([nodeId, flags]) => ({
        id: foundationId(nodeId),
        nodeId,
        restrained: flags as [boolean, boolean, boolean, boolean, boolean, boolean],
      })),
      loads: model.loads.map((load, i) => ({ id: `load:${i}`, nodeId: load.nodeId, force: load.force, moment: load.moment })),
    },
    options: { fidelity: 'linear' },
  };
}

const ZERO: Vector6 = [0, 0, 0, 0, 0, 0];

function stabilityReport(detailed: DetailedAnalysisResult): StabilityReport {
  const report: StabilityReport = {
    stable: true,
    freeDofs: 0,
    mechanisms: 0,
    translationalMechanisms: 0,
    rotationalMechanisms: 0,
    staticIndeterminacy: 0,
    unstableNodeIds: [],
    modes: [],
  };
  for (const component of detailed.components) {
    report.stable &&= component.status !== 'unstable';
    report.freeDofs += component.counts.freeDofs;
    report.translationalMechanisms += component.counts.mechanisms;
    report.rotationalMechanisms += component.counts.spinModes;
    report.staticIndeterminacy += component.counts.staticIndeterminacy;
    report.unstableNodeIds.push(...component.unstableNodeIds);
    for (const mode of component.modes) {
      if (mode.kind === 'buckling') continue;
      const kind: MechanismMode['kind'] = mode.kind === 'spin' ? 'rotation' : 'translation';
      report.modes.push({ kind, displacements: mode.displacements });
    }
  }
  report.mechanisms = report.translationalMechanisms + report.rotationalMechanisms;
  return report;
}

function unstableMessage(detailed: DetailedAnalysisResult, report: StabilityReport): string {
  const codes = new Set(detailed.components.flatMap((component) => component.reasonCodes));
  const parts: string[] = [];
  if (report.translationalMechanisms) parts.push(`${report.translationalMechanisms} translational mechanism(s)`);
  if (codes.has('loadedSpinMode') || codes.has('momentOnUnusedRotation'))
    parts.push('a moment acting on a rotation that nothing resists');
  return parts.length ? `The structure is unstable: ${parts.join(' and ')}.` : 'The structure is unstable.';
}

/**
 * Express a detailed result in the original result contract.
 *
 * The original contract has one status for the whole model, so one unstable
 * component makes the result `unstable`, as it does for the OpenSees
 * service. The component-by-component picture is only in the detailed
 * result.
 */
export function fromDetailedResult(model: StructuralModel, detailed: DetailedAnalysisResult): AnalysisResult {
  if (detailed.analysis.status === 'invalid')
    return { status: 'error', message: detailed.analysis.diagnostics[0]?.message ?? 'The model could not be analysed.' };

  const report = stabilityReport(detailed);
  const warnings: string[] = [];
  const unused = model.nodes.filter((node) => detailed.nodes[node.id]?.componentId == null).length;
  if (unused) warnings.push(`${unused} node(s) with no members and no load were left out of the analysis.`);
  if (report.rotationalMechanisms && report.stable)
    warnings.push(
      `${report.rotationalMechanisms} free spin mode(s) were held still: members can rotate about their own axis, but no load acts on that rotation.`,
    );

  if (!report.stable) return { status: 'unstable', message: unstableMessage(detailed, report), stability: report, warnings };
  const unresolved = detailed.components.find((component) => !component.resultsValid);
  if (unresolved)
    return { status: 'error', message: `The solver could not verify a result (${unresolved.reasonCodes.join(', ') || 'unknown reason'}).` };

  const displacements: Record<string, Vector6> = {};
  for (const node of model.nodes) displacements[node.id] = detailed.nodes[node.id]?.displacement ?? ZERO;

  const reactions: Record<string, Vector6> = {};
  for (const support of model.supports)
    reactions[support.nodeId] = detailed.foundations[foundationId(support.nodeId)]?.reaction ?? ZERO;

  const memberForces: Record<string, MemberForces> = {};
  for (const member of model.members) {
    const forces = detailed.members[member.id]?.forces;
    const [start, end] = [forces?.start ?? ZERO, forces?.end ?? ZERO];
    memberForces[member.id] = {
      axial: start[0],
      shear: Math.hypot(start[1], start[2]),
      torsion: Math.abs(start[3]),
      momentStart: Math.hypot(start[4], start[5]),
      momentEnd: Math.hypot(end[4], end[5]),
    };
  }
  return { status: 'success', displacements, reactions, memberForces, stability: report, warnings };
}
