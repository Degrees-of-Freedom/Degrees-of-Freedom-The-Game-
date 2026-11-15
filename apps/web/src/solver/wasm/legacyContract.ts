import type {
  AnalysisMember,
  AnalysisModel,
  AnalysisOptions,
  AnalysisResult,
  AnalysisSection,
  ComponentResult,
  ConnectionLaw,
  ConnectionLaws,
  DetailedAnalysisResult,
  MechanismMode,
  MemberConnection,
  MemberEndConnection,
  MemberEndFixity,
  MemberForces,
  MemberProperties,
  ReasonCode,
  StabilityReport,
  StructuralMember,
  StructuralModel,
  Vector6,
} from '@dof/solver-contract';

/**
 * Translation between the shared `StructuralModel` contract and the detailed
 * contract of the Rust solver.
 *
 * Everything the shared contract can say is carried over: member kind,
 * resolved properties, orientation, initial strain, six-axis connections
 * (or their shorthands), self-weight, fidelity and the displacement limit.
 * Defaults follow the contract and the OpenSees service, so both backends
 * answer the same question for the same model:
 *
 * - a member without properties gets the standard steel section of
 *   `services/opensees/src/dof_opensees/properties.py`, including its
 *   self-weight of 577 N/m;
 * - fidelity defaults to `linear`; `type: 'corotational'` asks for nonlinear;
 * - `segmentsPerFrame` fixes the beam elements (1 to 32), otherwise 1 for
 *   linear and 2 for nonlinear;
 * - a member `law` (frame or cable) supplies its properties; a cable law's
 *   rest length maps exactly onto the Rust cable;
 * - there is no displacement limit unless one is given.
 *
 * **Local axes.** The two contracts name the same axes differently. In the
 * shared contract local Y follows the member's `orientation` and Z = X × Y;
 * in the Rust solver local z follows `orientation` and y = z × x. So shared Y
 * is Rust z, and shared Z is Rust −y. Properties and connection laws are
 * swapped between the second and third axes accordingly; `orientation` itself
 * passes through unchanged. Results use axis-independent magnitudes, so they
 * need no conversion back.
 *
 * What the Rust solver cannot represent is reported as `unsupported` instead
 * of being approximated: an axial member (brace or cable) whose end
 * translations are not all locked, and initial strain on a beam (the OpenSees
 * service rejects that too). `timeoutMs` is not enforced: the Rust solver
 * bounds its work by an iteration count, and runs on the calling thread.
 */

/** Standard gravity. The shared contract applies self-weight along −Z. */
const GRAVITY = 9.81;

/** The solver's documented standard section (OpenSees `STEEL_MEMBER`). */
const STANDARD_SECTION: MemberProperties = {
  elasticModulus: 210e9,
  shearModulus: 81e9,
  area: 7.49e-3,
  inertiaY: 4.47e-5,
  inertiaZ: 4.47e-5,
  torsionConstant: 7.03e-5,
  weightPerLength: 577,
};

/** The detailed contract names its foundations; the shared one does not. */
const foundationId = (nodeId: string) => `support:${nodeId}`;

const LOCKED6: MemberEndConnection['laws'] = ['locked', 'locked', 'locked', 'locked', 'locked', 'locked'];
const SHORTHANDS: Record<MemberEndFixity, MemberEndConnection['laws']> = {
  fixed: LOCKED6,
  pinned: ['locked', 'locked', 'locked', 'free', 'free', 'free'],
  free: ['free', 'free', 'free', 'free', 'free', 'free'],
};

/** Shared-contract axis index for each Rust axis: x, y = −Z, z = Y. */
const SHARED_AXIS_OF_RUST = [0, 2, 1, 3, 5, 4] as const;

type Translation =
  | { model: AnalysisModel; options: AnalysisOptions; displacementLimit?: number; segmentsPerFrame: number }
  | { unsupported: string }
  | { error: string };

/** The Rust section for a set of shared-contract properties. */
function sectionFor(id: string, p: MemberProperties): AnalysisSection {
  return {
    id,
    E: p.elasticModulus,
    G: p.shearModulus,
    A: p.area,
    // Shared Y is Rust z and shared Z is Rust y.
    Iy: p.inertiaZ,
    Iz: p.inertiaY,
    J: p.torsionConstant,
    // Rust self-weight is density × area × gravity.
    density: (p.weightPerLength ?? 0) / (p.area * GRAVITY),
  };
}

/** The six laws of one end, in shared-contract axis order, or a reason it cannot be read. */
function sharedLaws(member: StructuralMember, end: 'start' | 'end'): { laws: MemberEndConnection['laws']; stiffness?: Vector6 } | string {
  const fixity = end === 'start' ? member.startFixity : member.endFixity;
  const connection = end === 'start' ? member.startConnection : member.endConnection;
  if (fixity !== undefined && connection !== undefined)
    return `Member '${member.id}' gives both a shorthand and a full connection at its ${end}.`;
  if (connection) return { laws: connection.laws, stiffness: connection.stiffness };
  return { laws: SHORTHANDS[fixity ?? 'fixed'] };
}

/** The Rust connection for one end of a beam, or a reason it cannot be built. */
function beamConnection(member: StructuralMember, end: 'start' | 'end'): MemberConnection | undefined | string {
  const shared = sharedLaws(member, end);
  if (typeof shared === 'string') return shared;
  if (shared.laws.every((law) => law === 'locked')) return undefined;
  const laws: ConnectionLaw[] = [];
  for (const axis of SHARED_AXIS_OF_RUST) {
    const law = shared.laws[axis];
    if (law === 'locked') laws.push('rigid');
    else if (law === 'free') laws.push('free');
    else {
      const k = shared.stiffness?.[axis];
      if (k === undefined || !(k > 0) || !Number.isFinite(k))
        return `Member '${member.id}': an elastic law at its ${end} needs a positive, finite stiffness.`;
      laws.push({ elastic: k });
    }
  }
  return { laws: laws as unknown as ConnectionLaws };
}

export function toAnalysisModel(model: StructuralModel): Translation {
  if (model.units !== 'SI') return { unsupported: 'Only SI units are supported.' };
  const analysis = model.analysis ?? {};
  // Nonlinear is opt-in: `fidelity: 'nonlinear'` or its alias
  // `type: 'corotational'`. Without either the analysis is linear.
  const fidelity = analysis.fidelity ?? (analysis.type === 'corotational' ? 'nonlinear' : 'linear');
  const fixedSegments = analysis.segmentsPerFrame;
  if (fixedSegments !== undefined && !(Number.isInteger(fixedSegments) && fixedSegments >= 1 && fixedSegments <= 32))
    return { error: 'segmentsPerFrame must be a whole number from 1 to 32.' };
  // A beam is exact with one element in a linear analysis under nodal and
  // uniform loads; the nonlinear analysis uses the solver's default of two
  // unless the request fixes the count.
  const segmentsPerFrame = fixedSegments ?? (fidelity === 'linear' ? 1 : 2);

  // Several supports on one node act together; the detailed contract wants
  // one foundation per node.
  const restrained = new Map<string, boolean[]>();
  for (const support of model.supports) {
    const flags = restrained.get(support.nodeId) ?? [false, false, false, false, false, false];
    restrained.set(support.nodeId, flags.map((flag, i) => flag || support.restrained[i]));
  }

  // One Rust section per distinct set of properties.
  const sections = new Map<string, AnalysisSection>();
  const sectionId = (properties: MemberProperties) => {
    const key = JSON.stringify(properties);
    let section = sections.get(key);
    if (!section) sections.set(key, (section = sectionFor(`section:${sections.size}`, properties)));
    return section.id;
  };

  const members: AnalysisMember[] = [];
  for (const member of model.members) {
    // A cable law makes the member a cable whatever its kind says; a frame
    // law supplies its section properties.
    const law = member.law;
    const kind = law?.kind === 'cable' ? 'cable' : (member.kind ?? 'beam');
    const properties: MemberProperties = law
      ? {
          elasticModulus: law.elasticModulus,
          area: law.area,
          shearModulus: law.kind === 'frame' ? law.shearModulus : 0,
          inertiaY: law.kind === 'frame' ? law.iy : 0,
          inertiaZ: law.kind === 'frame' ? law.iz : 0,
          torsionConstant: law.kind === 'frame' ? law.torsionConstant : 0,
          weightPerLength: member.properties?.weightPerLength ?? 0,
        }
      : (member.properties ?? STANDARD_SECTION);
    const base = {
      id: member.id,
      kind,
      startNodeId: member.startNodeId,
      endNodeId: member.endNodeId,
      sectionId: sectionId(properties),
      ...(member.orientation && { orientation: member.orientation }),
      ...(kind === 'beam' && { subdivisions: segmentsPerFrame }),
    };
    const strain = member.initialStrain ?? 0;
    if (law?.kind === 'cable' && strain !== 0)
      return { unsupported: `Member '${member.id}' gives both a cable rest length and an initial strain.` };
    if (kind === 'beam') {
      if (strain !== 0) return { unsupported: `Member '${member.id}': initial strain on a beam is not supported; use a brace or cable.` };
      const start = beamConnection(member, 'start');
      const end = beamConnection(member, 'end');
      for (const connection of [start, end]) if (typeof connection === 'string') return { unsupported: connection };
      members.push({
        ...base,
        ...(start && { start: start as MemberConnection }),
        ...(end && { end: end as MemberConnection }),
      });
    } else {
      // Rotational laws mean nothing to an axial member; its translations
      // must be locked, because the Rust solver always pins braces and cables.
      for (const end of ['start', 'end'] as const) {
        const shared = sharedLaws(member, end);
        if (typeof shared === 'string') return { unsupported: shared };
        if (shared.laws.slice(0, 3).some((law) => law !== 'locked'))
          return { unsupported: `Member '${member.id}': a ${kind} whose ${end} translations are not all locked is not supported by the Rust solver.` };
      }
      // A cable law's force is EA max(0, l / restLength − 1): the Rust
      // cable with that rest length, exactly.
      members.push({
        ...base,
        ...(law?.kind === 'cable' ? { restLength: law.restLength } : strain !== 0 && { initialStrain: strain }),
      });
    }
  }

  const limit = analysis.displacementLimit;
  if (limit !== undefined && !(limit > 0)) return { error: 'The displacement limit must be positive.' };
  return {
    model: {
      ...(model.version !== undefined && { version: model.version }),
      nodes: model.nodes.map((node) => ({ id: node.id, position: node.position })),
      sections: [...sections.values()],
      members,
      foundations: [...restrained].map(([nodeId, flags]) => ({
        id: foundationId(nodeId),
        nodeId,
        restrained: flags as [boolean, boolean, boolean, boolean, boolean, boolean],
      })),
      loads: model.loads.map((load, i) => ({ id: `load:${i}`, nodeId: load.nodeId, force: load.force, moment: load.moment })),
    },
    options: {
      fidelity,
      ...(analysis.selfWeight && { gravity: [0, 0, -GRAVITY] }),
      // The shared contract flags excessive deformation only against an
      // absolute limit it is given (checked below), so the solver's own
      // relative rule is switched off.
      excessiveDisplacementRatio: 1e9,
    },
    ...(limit !== undefined && { displacementLimit: limit }),
    segmentsPerFrame,
  };
}

const ZERO: Vector6 = [0, 0, 0, 0, 0, 0];
type DetailedComponent = DetailedAnalysisResult['components'][number];

/** Rust reason codes in the shared contract's vocabulary. */
const REASONS: Record<string, ReasonCode> = {
  unsupported: 'unsupported_component',
  rigidBodyMotion: 'rigid_body_mechanism',
  internalMechanism: 'internal_mechanism',
  loadedSpinMode: 'internal_mechanism',
  momentOnUnusedRotation: 'internal_mechanism',
  loadInducedInstability: 'load_induced_instability',
  nearMechanism: 'near_mechanism',
  lowStabilityMargin: 'near_mechanism',
  excessiveDeformation: 'excessive_deformation',
  stabilisedByGeometry: 'geometrically_stiffened',
  recoveryFailed: 'not_converged',
  noConvergence: 'not_converged',
  iterationLimit: 'not_converged',
  cableStateUnresolved: 'not_converged',
  equilibriumNotVerified: 'equilibrium_not_verified',
  nonFinite: 'non_finite_result',
};

/** The component's reasons, the slack-cable flag, and the displacement-limit flag. */
function reasonCodesOf(component: DetailedComponent, detailed: DetailedAnalysisResult, overLimit: boolean): ReasonCode[] {
  const codes = new Set<ReasonCode>();
  for (const code of component.reasonCodes) {
    const mapped = REASONS[code];
    if (mapped) codes.add(mapped);
  }
  // A bare mechanism (no rigid-body or internal split) is internal.
  if (component.reasonCodes.includes('mechanism') && !codes.has('unsupported_component') && !codes.has('rigid_body_mechanism'))
    codes.add('internal_mechanism');
  if (component.resultsValid && component.memberIds.some((id) => detailed.members[id]?.state === 'slack')) codes.add('cable_slack');
  if (overLimit) codes.add('excessive_deformation');
  return [...codes];
}

function componentStability(component: DetailedComponent, state: ComponentResult['state']): StabilityReport {
  return {
    stable: state === 'stable' || state === 'marginal',
    freeDofs: component.counts.freeDofs,
    mechanisms: component.counts.mechanisms + component.counts.spinModes,
    translationalMechanisms: component.counts.mechanisms,
    rotationalMechanisms: component.counts.spinModes,
    staticIndeterminacy: component.counts.staticIndeterminacy,
    unstableNodeIds: component.unstableNodeIds,
    modes: component.modes
      .filter((mode) => mode.kind !== 'buckling')
      .map((mode) => ({ kind: mode.kind === 'spin' ? 'rotation' : 'translation', displacements: mode.displacements }) as MechanismMode),
  };
}

function unstableMessage(components: ComponentResult[]): string {
  const codes = new Set(components.filter((c) => c.state === 'unstable').flatMap((c) => c.reasonCodes));
  const parts: string[] = [];
  if (codes.has('unsupported_component')) parts.push('a part has no support');
  if (codes.has('rigid_body_mechanism') || codes.has('internal_mechanism')) parts.push('a mechanism');
  if (codes.has('load_induced_instability')) parts.push('buckling under the applied load');
  return parts.length ? `The structure is unstable: ${parts.join(', ')}.` : 'The structure is unstable.';
}

/**
 * Express a detailed result in the shared result contract (v2).
 *
 * Each Rust component becomes a component result, identified by its smallest
 * node id as the contract asks. Node, reaction and member entries are given
 * only for components with verified results; an absent entry means
 * unavailable. A given displacement limit flags `excessive_deformation` and
 * makes a stable component `marginal`, as the contract defines.
 */
export function fromDetailedResult(
  model: StructuralModel,
  detailed: DetailedAnalysisResult,
  displacementLimit?: number,
  segmentsPerFrame?: number,
): AnalysisResult {
  if (detailed.analysis.status === 'invalid')
    return { status: 'error', message: detailed.analysis.diagnostics[0]?.message ?? 'The model could not be analysed.' };

  const translation = (nodeId: string) => {
    const u = detailed.nodes[nodeId]?.displacement;
    return u ? Math.hypot(u[0], u[1], u[2]) : 0;
  };
  const components: ComponentResult[] = detailed.components.map((component) => {
    const overLimit =
      displacementLimit !== undefined && component.resultsValid && component.nodeIds.some((id) => translation(id) > displacementLimit);
    const state = overLimit && component.status === 'stable' ? 'marginal' : component.status;
    const loadFactor = component.criticalLoadFactor ?? component.convergence.loadFractionReached;
    return {
      id: [...component.nodeIds].sort()[0] ?? component.id,
      nodeIds: component.nodeIds,
      memberIds: component.memberIds,
      state,
      reasonCodes: reasonCodesOf(component, detailed, overLimit),
      resultsValid: component.resultsValid,
      stability: componentStability(component, state),
      ...(loadFactor != null && { loadFactor }),
      ...(component.convergence.residual != null && { residual: component.convergence.residual }),
    };
  });

  const valid = new Set(detailed.components.filter((c) => c.resultsValid).map((c) => c.id));
  const validNode = (id: string) => valid.has(detailed.nodes[id]?.componentId ?? '');

  const displacements: Record<string, Vector6> = {};
  for (const node of model.nodes) {
    const displacement = detailed.nodes[node.id]?.displacement;
    if (validNode(node.id) && displacement) displacements[node.id] = displacement;
  }

  const reactions: Record<string, Vector6> = {};
  for (const support of model.supports)
    if (validNode(support.nodeId)) reactions[support.nodeId] = detailed.foundations[foundationId(support.nodeId)]?.reaction ?? ZERO;

  const memberForces: Record<string, MemberForces> = {};
  for (const member of model.members) {
    const result = detailed.members[member.id];
    if (!result?.forces || !valid.has(result.componentId ?? '')) continue;
    const { start, end } = result.forces;
    // Axial, shear and torsion are the larger of the two ends, as the
    // contract asks for the largest value along the member.
    const larger = (a: number, b: number) => (Math.abs(a) >= Math.abs(b) ? a : b);
    memberForces[member.id] = {
      axial: larger(start[0], end[0]),
      shear: Math.max(Math.hypot(start[1], start[2]), Math.hypot(end[1], end[2])),
      torsion: Math.max(Math.abs(start[3]), Math.abs(end[3])),
      momentStart: Math.hypot(start[4], start[5]),
      momentEnd: Math.hypot(end[4], end[5]),
      ...((member.kind === 'cable' || member.law?.kind === 'cable') && result.state && result.state !== 'failed' && { state: result.state }),
    };
  }

  const stability: StabilityReport = {
    stable: components.every((c) => c.stability.stable),
    freeDofs: 0,
    mechanisms: 0,
    translationalMechanisms: 0,
    rotationalMechanisms: 0,
    staticIndeterminacy: 0,
    unstableNodeIds: [],
    modes: [],
  };
  for (const c of components) {
    stability.freeDofs += c.stability.freeDofs;
    stability.mechanisms += c.stability.mechanisms;
    stability.translationalMechanisms += c.stability.translationalMechanisms;
    stability.rotationalMechanisms += c.stability.rotationalMechanisms;
    stability.staticIndeterminacy += c.stability.staticIndeterminacy;
    stability.unstableNodeIds.push(...c.stability.unstableNodeIds);
    stability.modes.push(...c.stability.modes);
  }

  const warnings: string[] = [];
  const unused = model.nodes.filter((node) => detailed.nodes[node.id]?.componentId == null).length;
  if (unused) warnings.push(`${unused} node(s) with no members and no load were left out of the analysis.`);
  if (stability.rotationalMechanisms && stability.stable)
    warnings.push(
      `${stability.rotationalMechanisms} free spin mode(s) were held still: members can rotate about their own axis, but no load acts on that rotation.`,
    );

  // Model nodes outside every component: nothing attached, nothing loading them.
  const inactiveNodeIds = model.nodes.filter((node) => detailed.nodes[node.id]?.componentId == null).map((node) => node.id);

  // The nonlinear report, for a nonlinear analysis whose every part was
  // verified. Residuals are the largest over the components, in the solver's
  // normalisation (relative to the applied load and largest element force).
  const allValid = detailed.components.length > 0 && detailed.components.every((c) => c.resultsValid);
  const largest = (pick: (c: DetailedComponent) => number | null | undefined) =>
    detailed.components.reduce((most, c) => Math.max(most, pick(c) ?? 0), 0);
  const cableState: Record<string, 'taut' | 'slack'> = {};
  for (const member of model.members) {
    const state = detailed.members[member.id]?.state;
    if ((member.kind === 'cable' || member.law?.kind === 'cable') && (state === 'active' || state === 'slack'))
      cableState[member.id] = state === 'active' ? 'taut' : 'slack';
  }
  const nonlinear =
    detailed.analysis.fidelity === 'nonlinear' && allValid
      ? {
          segmentsPerFrame: segmentsPerFrame ?? 2,
          steps: detailed.components.reduce((sum, c) => sum + (c.convergence.loadSteps ?? 0), 0),
          forceResidual: largest((c) => c.convergence.forceImbalance),
          momentResidual: largest((c) => c.convergence.momentImbalance),
          nodalResidual: largest((c) => c.convergence.residual),
          cableState,
        }
      : undefined;

  const body = {
    analysis: {
      fidelity: detailed.analysis.fidelity ?? ('nonlinear' as const),
      solver: `Rust dof-solver ${detailed.analysis.solverVersion}`,
      runtimeMs: detailed.analysis.runtimeMs ?? 0,
      reasonCodes: [...new Set(components.flatMap((c) => c.reasonCodes))],
      ...(model.version !== undefined && { modelVersion: model.version }),
    },
    components,
    displacements,
    reactions,
    memberForces,
    stability,
    warnings,
    ...(inactiveNodeIds.length > 0 && { inactiveNodeIds }),
    ...(nonlinear && { nonlinear }),
  };
  if (components.some((c) => c.state === 'unstable')) return { status: 'unstable', message: unstableMessage(components), ...body };
  if (components.some((c) => c.state === 'unknown'))
    return { status: 'unresolved', message: 'The solver could not verify a result for every part of the structure.', ...body };
  return { status: 'success', ...body };
}
