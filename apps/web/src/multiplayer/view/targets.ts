/** Z-up game coordinates: X horizontal width, Y horizontal depth, Z vertical height. */
export type Vec3 = readonly [number, number, number];

export interface QuarterPort {
  readonly id: string;
  readonly position: Vec3;
  readonly parentId?: string;
  readonly fraction?: 0.25 | 0.5 | 0.75;
}

export interface SnapTarget extends QuarterPort {
  readonly kind: 'grid' | 'quarter';
}

export interface TargetInput {
  readonly origin: Vec3;
  /** Board coordinates are X = width, Y = depth, Z = height; bounds inclusive. */
  readonly bounds: { readonly width: number; readonly depth: number; readonly height: number };
  readonly maxLength: 5 | 7 | 10;
  /** Authored physical ports, never inferred by rounding to the grid. */
  readonly quarterPorts?: readonly QuarterPort[];
  /** Domain-owned card/orientation/clash rule; visual salience never changes legality. */
  readonly isLegal?: (target: SnapTarget) => boolean;
}

const finiteVector = (value: Vec3): boolean => value.every(Number.isFinite);

/**
 * All positive Euclidean spans up to the printed maximum are candidates, including
 * off-axis directions. Distinct joint/port IDs at the same coordinate remain
 * distinct for depth/identity selection. Caller owns memoization; no shared cache.
 */
export function generateTargets(input: TargetInput): SnapTarget[] {
  const { origin, bounds, maxLength } = input;
  const extents: Vec3 = [bounds.width, bounds.depth, bounds.height];
  if (!finiteVector(origin) || !finiteVector(extents) || extents.some(value => value < 0)
    || ![5, 7, 10].includes(maxLength)) throw new RangeError('Targets require finite nonnegative bounds, an origin and a 5/7/10 maximum.');
  const radiusSquared = maxLength * maxLength;
  const epsilon = 1e-9;
  const targets: SnapTarget[] = [];
  const seen = new Set<string>();
  const add = (target: SnapTarget): void => {
    if (seen.has(target.id) || !finiteVector(target.position)) return;
    if (target.position.some((value, axis) => value < -epsilon || value > extents[axis] + epsilon)) return;
    const lengthSquared = target.position.reduce((sum, value, axis) => sum + (value - origin[axis]) ** 2, 0);
    if (lengthSquared <= epsilon * epsilon || lengthSquared > radiusSquared + epsilon) return;
    if (input.isLegal && !input.isLegal(target)) return;
    seen.add(target.id);
    targets.push(target);
  };
  for (let x = Math.max(0, Math.ceil(origin[0] - maxLength)); x <= Math.min(bounds.width, Math.floor(origin[0] + maxLength)); x++) {
    for (let y = Math.max(0, Math.ceil(origin[1] - maxLength)); y <= Math.min(bounds.depth, Math.floor(origin[1] + maxLength)); y++) {
      for (let z = Math.max(0, Math.ceil(origin[2] - maxLength)); z <= Math.min(bounds.height, Math.floor(origin[2] + maxLength)); z++) {
        add({ id: `grid:${x},${y},${z}`, position: [x, y, z], kind: 'grid' });
      }
    }
  }
  for (const port of input.quarterPorts ?? []) {
    add({ ...port, position: [port.position[0], port.position[1], port.position[2]], kind: 'quarter' });
  }
  return targets;
}

export interface TargetSalience { opacity: number; radius: number }

/** Screen-space salience only: opacity/radius never remove or shrink hit regions. */
export function targetSalience(distancePx: number, selected = false, into?: TargetSalience): TargetSalience {
  const output = into ?? { opacity: 0, radius: 0 };
  if (selected) { output.opacity = 1; output.radius = 5; return output; }
  const distance = Number.isFinite(distancePx) ? Math.max(0, distancePx) : Infinity;
  const normalized = Math.min(1, Math.max(0, (distance - 12) / 148));
  const fade = normalized * normalized * (3 - 2 * normalized);
  output.opacity = 1 - fade * 0.94; output.radius = 4.5 - fade * 2.75;
  return output;
}

export interface TargetCandidate<T> {
  readonly item: T;
  readonly sx: number;
  readonly sy: number;
  readonly depth: number;
  readonly dist: number;
}

/**
 * Stable projected-depth stack around the nearest target, independent of opacity.
 * Depth is caller-projected camera depth, with smaller values nearer the camera.
 * Keep the returned stack through an interaction; cycle with keyboard/touch.
 */
export function pickTargetStack<T>(
  candidates: readonly TargetCandidate<T>[], reachPx = 18, stackPx = 4,
): TargetCandidate<T>[] {
  if (!Number.isFinite(reachPx) || reachPx < 0 || !Number.isFinite(stackPx) || stackPx < 0) return [];
  const eligible = candidates.filter(candidate => Number.isFinite(candidate.sx) && Number.isFinite(candidate.sy)
    && Number.isFinite(candidate.depth) && Number.isFinite(candidate.dist) && candidate.dist >= 0 && candidate.dist <= reachPx);
  const nearest = eligible.reduce<TargetCandidate<T> | undefined>((best, candidate) =>
    !best || candidate.dist < best.dist || (candidate.dist === best.dist && candidate.depth < best.depth) ? candidate : best, undefined);
  if (!nearest) return [];
  return eligible.filter(candidate => Math.hypot(candidate.sx - nearest.sx, candidate.sy - nearest.sy) <= stackPx)
    .sort((a, b) => a.depth - b.depth || a.dist - b.dist);
}

export function cycleTargetStackIndex(index: number, count: number, delta: number): number {
  if (!Number.isInteger(count) || count <= 0) return -1;
  const current = Number.isFinite(index) ? Math.trunc(index) : 0;
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return ((current + step) % count + count) % count;
}
