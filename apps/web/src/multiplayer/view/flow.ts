/** Checkpoint-only evidence for a deliberately explanatory load-transfer overlay. */
export interface FlowSegmentEvidence {
  readonly id: string;
  readonly memberId: string;
  readonly a: string;
  readonly b: string;
  /** Nonnegative calculated resultant action for this segment, including shear/bending. */
  readonly magnitude: number;
  /** Calculated signed axial force: positive tension, negative compression. */
  readonly axial?: number;
  readonly slack?: boolean;
  readonly valid?: boolean;
}

export interface PrimaryFlowInput {
  readonly modelRevision: string | number;
  readonly checkpoint?: {
    readonly modelRevision: string | number;
    readonly turn: number;
    readonly valid: boolean;
  };
  /** Include invalid placeholders for missing segment evidence so partial scopes are not inferred as complete. */
  readonly segments: readonly FlowSegmentEvidence[];
  /** Intentional load application nodes, supplied with the selected result scope. */
  readonly sources: readonly string[];
  /** Receiving supports in that same result scope, including neutral safety supports. */
  readonly supports: readonly string[];
  readonly forceTolerance?: number;
  readonly potentialTolerance?: number;
  readonly maxIterations?: number;
}

export type FlowReason = 'flow' | 'ambiguous' | 'stale' | 'unknown' | 'slack' | 'zero' | 'unanchored' | 'nonconverged';

export interface SegmentFlow {
  readonly id: string;
  readonly memberId: string;
  readonly a: string;
  readonly b: string;
  /** +1 is a to b; -1 is b to a. Zero must never animate a directional vector. */
  readonly direction: -1 | 0 | 1;
  readonly from: string | null;
  readonly to: string | null;
  readonly magnitude: number;
  readonly normalizedMagnitude: number;
  /** Style is independent of transfer direction; mixed includes shear/bending. */
  readonly style: 'tension' | 'compression' | 'mixed' | 'none';
  readonly reason: FlowReason;
}

export interface PrimaryFlowResult {
  readonly status: 'current' | 'stale' | 'unavailable';
  readonly checkpointTurn?: number;
  readonly method: 'force-weighted-harmonic';
  readonly segments: readonly SegmentFlow[];
  readonly potentials: ReadonlyMap<string, number>;
}

interface Edge {
  readonly index: number;
  readonly a: string;
  readonly b: string;
  readonly weight: number;
}

const positiveFinite = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * Derive an explanatory primary direction, never a new physical force solution.
 *
 * For each connected result scope, source potentials are 1 and receiving-support
 * potentials are 0. Interior potentials are force-weighted harmonic averages:
 * p(i) = sum(magnitude(i,j) * p(j)) / sum(magnitude(i,j)). Vectors follow decreasing
 * potential on every participating branch. Axial sign only chooses its style.
 * This intentionally does not claim a unique physical attribution under combined
 * loads. Equal potentials, conflicting boundaries, missing paths and failure to
 * converge are explicit ambiguity/unavailability rather than invented arrows.
 * An unknown segment touching a component makes that component ambiguous, since
 * excluding an unverified branch could invent a primary direction. Omitted
 * segments cannot be detected here; the caller must include invalid placeholders.
 *
 * Call when model/checkpoint/scope changes and memoize in the scene. No solver,
 * model mutation, shortest-path selection, frame state or global cache is used.
 */
export function buildPrimaryFlow(input: PrimaryFlowInput): PrimaryFlowResult {
  const forceTolerance = positiveFinite(input.forceTolerance, 1e-8);
  const potentialTolerance = positiveFinite(input.potentialTolerance, 1e-7);
  const maxIterations = Math.min(10000, Math.max(1, Math.floor(positiveFinite(input.maxIterations, 2000))));
  const checkpoint = input.checkpoint;
  const status: PrimaryFlowResult['status'] = !checkpoint?.valid || !Number.isFinite(checkpoint.turn)
    ? 'unavailable'
    : checkpoint.modelRevision !== input.modelRevision ? 'stale' : 'current';
  const maximum = input.segments.reduce((value, segment) =>
    segment.valid !== false && !segment.slack && Number.isFinite(segment.magnitude) && segment.magnitude > value
      ? segment.magnitude : value, 0);
  const segments: SegmentFlow[] = input.segments.map(segment => {
    const magnitude = Number.isFinite(segment.magnitude) && segment.magnitude >= 0 ? segment.magnitude : 0;
    const known = segment.valid !== false && Number.isFinite(segment.magnitude) && segment.magnitude >= 0
      && segment.a.length > 0 && segment.b.length > 0 && segment.a !== segment.b;
    const axial = segment.axial;
    const style: SegmentFlow['style'] = !known || segment.slack || magnitude <= forceTolerance ? 'none'
      : axial !== undefined && Number.isFinite(axial) && axial > forceTolerance ? 'tension'
        : axial !== undefined && Number.isFinite(axial) && axial < -forceTolerance ? 'compression' : 'mixed';
    const reason: FlowReason = status === 'stale' ? 'stale'
      : status === 'unavailable' || !known ? 'unknown'
        : segment.slack ? 'slack' : magnitude <= forceTolerance ? 'zero' : 'unanchored';
    return {
      id: segment.id, memberId: segment.memberId, a: segment.a, b: segment.b,
      magnitude, normalizedMagnitude: known && !segment.slack && maximum > 0 ? Math.min(1, magnitude / maximum) : 0,
      direction: 0, from: null, to: null, style, reason,
    };
  });
  const potentials = new Map<string, number>();
  const result = (): PrimaryFlowResult => ({
    status, checkpointTurn: checkpoint?.turn, method: 'force-weighted-harmonic', segments, potentials,
  });
  if (status !== 'current' || maximum <= forceTolerance) return result();

  const graph = new Map<string, Edge[]>();
  input.segments.forEach((segment, index) => {
    if (segments[index].reason !== 'unanchored') return;
    const edge: Edge = { index, a: segment.a, b: segment.b, weight: segment.magnitude / maximum };
    for (const node of [edge.a, edge.b]) {
      const adjacent = graph.get(node);
      if (adjacent) adjacent.push(edge);
      else graph.set(node, [edge]);
    }
  });
  const incompleteNodes = new Set<string>();
  input.segments.forEach((segment, index) => {
    if (segments[index].reason !== 'unknown') return;
    if (segment.a) incompleteNodes.add(segment.a);
    if (segment.b) incompleteNodes.add(segment.b);
  });
  const sources = new Set(input.sources);
  const supports = new Set(input.supports);
  const visited = new Set<string>();
  for (const root of [...graph.keys()].sort()) {
    if (visited.has(root)) continue;
    const pending = [root];
    const nodes: string[] = [];
    const edges = new Map<number, Edge>();
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined || visited.has(node)) continue;
      visited.add(node);
      nodes.push(node);
      for (const edge of graph.get(node) ?? []) {
        edges.set(edge.index, edge);
        const other = edge.a === node ? edge.b : edge.a;
        if (!visited.has(other)) pending.push(other);
      }
    }
    if (nodes.some(node => incompleteNodes.has(node)) || nodes.some(node => sources.has(node) && supports.has(node))) {
      for (const edge of edges.values()) segments[edge.index] = { ...segments[edge.index], reason: 'ambiguous' };
      continue;
    }
    if (!nodes.some(node => sources.has(node)) || !nodes.some(node => supports.has(node))) continue;
    nodes.sort();
    for (const node of nodes) potentials.set(node, sources.has(node) ? 1 : supports.has(node) ? 0 : 0.5);
    const interior = nodes.filter(node => !sources.has(node) && !supports.has(node));
    let converged = interior.length === 0;
    for (let iteration = 0; iteration < maxIterations && !converged; iteration++) {
      let change = 0;
      for (const node of interior) {
        let weighted = 0;
        let total = 0;
        for (const edge of graph.get(node) ?? []) {
          const other = edge.a === node ? edge.b : edge.a;
          weighted += edge.weight * (potentials.get(other) ?? 0.5);
          total += edge.weight;
        }
        const next = weighted / total;
        change = Math.max(change, Math.abs(next - (potentials.get(node) ?? 0.5)));
        potentials.set(node, next);
      }
      converged = change <= potentialTolerance * 0.01;
    }
    for (const edge of edges.values()) {
      const difference = (potentials.get(edge.a) ?? 0.5) - (potentials.get(edge.b) ?? 0.5);
      const direction: SegmentFlow['direction'] = !converged || Math.abs(difference) <= potentialTolerance
        ? 0 : difference > 0 ? 1 : -1;
      segments[edge.index] = {
        ...segments[edge.index], direction,
        from: direction === 0 ? null : direction === 1 ? edge.a : edge.b,
        to: direction === 0 ? null : direction === 1 ? edge.b : edge.a,
        reason: !converged ? 'nonconverged' : direction === 0 ? 'ambiguous' : 'flow',
      };
    }
  }
  return result();
}
