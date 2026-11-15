import { CELL_SIZE, parseNodeKey, type Member } from "./model";
import { originalPorts } from "./turnPorts";
import { dot, localAxes } from "../solver/frameMath";
import { SECTION_GEOMETRY } from "../solver/voxelSections";

type Placed = Member & { endTargets?: Partial<Record<"a" | "b", string>>; owner?: string };
type Vector = number[];
type Interval = [number, number];
type SectionPart = { y: number; z: number; width: number; depth: number };
type Prism = { origin: Vector; axes: Vector[]; half: Vector };
type Solid = { member: Placed; start: Vector; axes: Vector[]; length: number; parts: SectionPart[]; bounds: Prism };

/** Playtest reference geometry, in metres. Touching faces are legal. A matching
 * end or explicitly selected original port can host a local fitting on either
 * member; no part outside both fitting intervals may penetrate the other member.
 * The fitting creates no analytical joint or stiffness. */
export const CLASH_POLICY = { version: "reference-solids-1", toleranceM: 1e-6, fittingLengthM: 0.25 } as const;

function sectionParts(type: Member["type"]): SectionPart[] {
  const s = SECTION_GEOMETRY[type];
  // A square clearance envelope circumscribes the legacy round cable.
  if (s.kind === "cable") return [{ y: 0, z: 0, width: s.diameter, depth: s.diameter }];
  if (s.kind === "solid-rectangle") return [{ y: 0, z: 0, width: s.width, depth: s.depth }];
  const t = s.kind === "wide-flange" ? s.flange : s.wall;
  const parts: SectionPart[] = [-1, 1].map(sign => ({ y: 0, z: sign * (s.depth - t) / 2, width: s.width, depth: t }));
  const height = s.depth - 2 * t;
  if (s.kind === "wide-flange") parts.push({ y: 0, z: 0, width: s.web, depth: height });
  else for (const sign of [-1, 1]) parts.push({ y: sign * (s.width - t) / 2, z: 0, width: t, depth: height });
  return parts;
}

function cross(a: Vector, b: Vector) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function prism(start: Vector, axes: Vector[], span: Interval, part: SectionPart): Prism {
  const x = (span[0] + span[1]) / 2;
  return {
    origin: start.map((value, i) => value + x * axes[0][i] + part.y * axes[1][i] + part.z * axes[2][i]),
    axes, half: [(span[1] - span[0]) / 2, part.width / 2, part.depth / 2],
  };
}

function solid(member: Placed): Solid {
  const start = parseNodeKey(member.a).map(x => x * CELL_SIZE);
  const delta = parseNodeKey(member.b).map((x, i) => x * CELL_SIZE - start[i]);
  const length = Math.hypot(...delta);
  const axes = localAxes(delta.map(x => x / length));
  const parts = sectionParts(member.type);
  const section = SECTION_GEOMETRY[member.type];
  const size = section.kind === "cable" ? { width: section.diameter, depth: section.diameter } : section;
  const bounds = prism(start, axes, [0, length], { y: 0, z: 0, width: size.width, depth: size.depth });
  return { member, start, axes, length, parts, bounds };
}

function radiusOn(box: Prism, axis: Vector) {
  return box.half.reduce((radius, half, i) => radius + half * Math.abs(dot(box.axes[i], axis)), 0);
}

/** Separating axis test for two convex, oriented section prisms. A non-unit
 * candidate axis scales the absolute penetration tolerance by its own length. */
function intersects(a: Prism, b: Prism): boolean {
  const delta = a.origin.map((v, i) => b.origin[i] - v);
  const separated = (axis: Vector) => {
    const length = Math.hypot(...axis);
    return length > 1e-12 && radiusOn(a, axis) + radiusOn(b, axis) - Math.abs(dot(delta, axis)) <= CLASH_POLICY.toleranceM * length;
  };
  if (a.axes.some(separated) || b.axes.some(separated)) return false;
  return !a.axes.some(left => b.axes.some(right => separated(cross(left, right))));
}

function materialIntersects(a: Solid, aSpan: Interval, b: Solid, bSpan: Interval) {
  return a.parts.some(part => {
    const box = prism(a.start, a.axes, aSpan, part);
    return b.parts.some(other => intersects(box, prism(b.start, b.axes, bSpan, other)));
  });
}

function contacts(a: Placed, b: Placed): [number[], number[]] {
  const aStations: number[] = [], bStations: number[] = [];
  for (const [index, end] of (["a", "b"] as const).entries()) {
    for (const [otherIndex, other] of (["a", "b"] as const).entries()) {
      if (a[end] === b[other]) { aStations.push(index); bStations.push(otherIndex); }
    }
    for (const port of originalPorts(b)) {
      if (port.available && a.endTargets?.[end] === port.id && port.point.join(",") === a[end]) {
        aStations.push(index); bStations.push(port.quarter / 4);
      }
    }
    for (const port of originalPorts(a)) {
      if (port.available && b.endTargets?.[end] === port.id && port.point.join(",") === b[end]) {
        aStations.push(port.quarter / 4); bStations.push(index);
      }
    }
  }
  return [aStations, bStations];
}

function outsideFittings(length: number, stations: number[]): Interval[] {
  const radius = Math.min(CLASH_POLICY.fittingLengthM, length / 4);
  const spans: Interval[] = [];
  let from = 0;
  for (const station of stations.sort((a, b) => a - b)) {
    const x = station * length;
    if (x - radius > from) spans.push([from, x - radius]);
    from = Math.max(from, x + radius);
  }
  if (from < length) spans.push([from, length]);
  return spans;
}

function clash(a: Solid, b: Solid, allowFitting: boolean): boolean {
  if (!intersects(a.bounds, b.bounds)) return false;
  const fullA: Interval = [0, a.length], fullB: Interval = [0, b.length];
  if (!materialIntersects(a, fullA, b, fullB)) return false;
  if (!allowFitting) return true;
  const [stationsA, stationsB] = contacts(a.member, b.member);
  if (!stationsA.length) return true;
  return outsideFittings(a.length, stationsA).some(span => materialIntersects(a, span, b, fullB))
    || outsideFittings(b.length, stationsB).some(span => materialIntersects(a, fullA, b, span));
}

/** Check one proposed physical member against other reference members. Callers
 * supply distinct, previously validated IDs and nonzero finite spans. The same
 * narrow phase is available to candidate system repairs before analysis. */
export function findMaterialClash(candidate: Placed, others: readonly Placed[], fittingParentId?: number): string | null {
  const unavailable = [candidate, ...others].find(member => !Object.hasOwn(SECTION_GEOMETRY, member.type));
  if (unavailable) return `No verified clearance envelope is available for member ${unavailable.id} (${unavailable.type}).`;
  const incoming = solid(candidate);
  for (const existing of others) {
    // A system prop may contact only its declared parent, including at a
    // coincident end that would ordinarily be eligible for a player fitting.
    const fittingAllowed = fittingParentId === undefined ? existing.owner !== "neutral" : existing.id === fittingParentId;
    if (clash(incoming, solid(existing), fittingAllowed)) {
      return `Member ${candidate.id} (${candidate.type}) would intersect material in member ${existing.id} (${existing.type}). Choose a clear span or target an original attachment port.`;
    }
  }
  return null;
}
