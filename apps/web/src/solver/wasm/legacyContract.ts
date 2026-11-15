import type {
  AnalysisMember,
  AnalysisModel,
  AnalysisOptions,
  AnalysisResult,
  ComponentResult,
  ConnectionLaws,
  DetailedAnalysisResult,
  MechanismMode,
  MemberForces,
  ReasonCode,
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

  // The original contract (v2) carries a result per component; entries for
  // a component without verified results are left out, never zeroed.
  const components: ComponentResult[] = detailed.components.map((component) => ({
    id: component.id,
    nodeIds: component.nodeIds,
    memberIds: component.memberIds,
    state: component.status,
    reasonCodes: reasonCodesOf(component),
    resultsValid: component.resultsValid,
    stability: componentStability(component),
    ...(component.criticalLoadFactor != null && { loadFactor: component.criticalLoadFactor }),
    ...(component.convergence.residual != null && { residual: component.convergence.residual }),
  }));
  const valid = new Set(detailed.components.filter((component) => component.resultsValid).map((component) => component.id));
  const validNode = (id: string) => valid.has(detailed.nodes[id]?.componentId ?? '');

  const displacements: Record<string, Vector6> = {};
  for (const node of model.nodes)
    if (validNode(node.id)) displacements[node.id] = detailed.nodes[node.id]?.displacement ?? ZERO;

  const reactions: Record<string, Vector6> = {};
  for (const support of model.supports)
    if (validNode(support.nodeId))
      reactions[support.nodeId] = detailed.foundations[foundationId(support.nodeId)]?.reaction ?? ZERO;

  const memberForces: Record<string, MemberForces> = {};
  for (const member of model.members) {
    if (!validNode(member.startNodeId)) continue;
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
  const body = {
    analysis: {
      fidelity: detailed.analysis.fidelity ?? ('linear' as const),
      solver: `Rust dof-solver ${detailed.analysis.solverVersion}`,
      runtimeMs: detailed.analysis.runtimeMs ?? 0,
      reasonCodes: [...new Set(components.flatMap((component) => component.reasonCodes))],
      ...(model.version !== undefined && { modelVersion: model.version }),
    },
    components,
    displacements,
    reactions,
    memberForces,
    stability: report,
    warnings,
  };
  if (!report.stable) return { status: 'unstable', message: unstableMessage(detailed, report), ...body };
  if (components.some((component) => component.state === 'unknown'))
    return { status: 'unresolved', message: 'The solver could not verify a result for every part of the structure.', ...body };
  return { status: 'success', ...body };
}

/**
 * The detailed contract names its reasons in camelCase and adds some the
 * original contract does not have. Map what has an equivalent from the
 * component flags; the rest stay in the detailed result.
 */
function reasonCodesOf(component: DetailedAnalysisResult['components'][number]): ReasonCode[] {
  const codes: ReasonCode[] = [];
  if (component.flags.unsupported) codes.push('unsupported_component');
  else if (component.flags.mechanism)
    codes.push(component.counts.rigidBodyModes > 0 && component.counts.internalMechanisms === 0 ? 'rigid_body_mechanism' : 'internal_mechanism');
  if (component.flags.loadInducedInstability) codes.push('load_induced_instability');
  if (component.flags.nearMechanism) codes.push('near_mechanism');
  if (component.flags.excessiveDeformation) codes.push('excessive_deformation');
  if (component.status === 'unknown' && !component.convergence.converged) codes.push('not_converged');
  return codes;
}

function componentStability(component: DetailedAnalysisResult['components'][number]): StabilityReport {
  return {
    stable: component.status === 'stable' || component.status === 'marginal',
    freeDofs: component.counts.freeDofs,
    mechanisms: component.counts.mechanisms + component.counts.spinModes,
    translationalMechanisms: component.counts.mechanisms,
    rotationalMechanisms: component.counts.spinModes,
    staticIndeterminacy: component.counts.staticIndeterminacy,
    unstableNodeIds: component.unstableNodeIds,
    modes: [],
  };
}
