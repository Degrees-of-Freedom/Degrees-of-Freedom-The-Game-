import { CELL_SIZE, parseNodeKey, type Member } from "./model";
import { originalPorts } from "./turnPorts";
import { dot, localAxes } from "../evaluator/vector";
import { CHS, SECTION_GEOMETRY } from "../evaluator/sections";
import { assemblyParts } from "./assembly";
import { springParts } from "./springParts";
import { attachmentPoint, attachmentQuarter, type InteriorSite } from "./attachmentSites";

type Placed = Member & { endTargets?: Partial<Record<"a" | "b", string>>;
  interiorTargets?: Partial<Record<InteriorSite, string>>; owner?: string };
type Vector = number[];
type Interval = [number, number];
type SectionPart = { y: number; z: number; width: number; depth: number; angle?: number };
type Prism = { origin: Vector; axes: Vector[]; half: Vector };
type Solid = { member: Placed; start: Vector; axes: Vector[]; length: number; parts: SectionPart[]; bounds: Prism; springStation?: Interval };

/** Playtest reference geometry, in metres. Touching faces are legal. A matching
 * end or explicitly selected original port can host a local fitting on either
 * member; no part outside both fitting intervals may penetrate the other member.
 * The fitting creates no analytical joint or stiffness. */
export const CLASH_POLICY = { version: "reference-solids-1", toleranceM: 1e-6, fittingLengthM: 0.25 } as const;

function sectionParts(type: Member["type"]): SectionPart[] {
  const s = SECTION_GEOMETRY[type];
  if (s.kind === "helix") throw new Error("A spring clearance check requires its physical wire and collar pieces.");
  // A square clearance envelope circumscribes the legacy round cable.
  if (s.kind === "cable") return [{ y: 0, z: 0, width: s.diameter, depth: s.diameter }];
  if (s.kind === "round-hollow") {
    // Conservative radial wall sectors retain the empty bore. Outer corners
    // depart from the true radius by <0.11 mm for the printed 48-face envelope.
    const outer = s.outerDiameter / 2, halfAngle = Math.PI / CHS.clearanceFaces;
    const inner = (outer - s.wall) * Math.cos(halfAngle);
    const centre = (outer + inner) / 2;
    return Array.from({length: CHS.clearanceFaces}, (_, i) => {
      const angle = 2 * halfAngle * i;
      return {angle, y: centre * Math.cos(angle), z: centre * Math.sin(angle),
        width: outer - inner, depth: 2 * outer * Math.tan(halfAngle)};
    });
  }
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
  const c = Math.cos(part.angle ?? 0), s = Math.sin(part.angle ?? 0);
  return {
    origin: start.map((value, i) => value + x * axes[0][i] + part.y * axes[1][i] + part.z * axes[2][i]),
    axes: part.angle ? [axes[0], axes[1].map((v,i) => v*c + axes[2][i]*s),
      axes[2].map((v,i) => v*c - axes[1][i]*s)] : axes,
    half: [(span[1] - span[0]) / 2, part.width / 2, part.depth / 2],
  };
}

function solid(member: Placed, springWidth?: number): Solid {
  const start = parseNodeKey(member.a).map(x => x * CELL_SIZE);
  const delta = parseNodeKey(member.b).map((x, i) => x * CELL_SIZE - start[i]);
  const length = Math.hypot(...delta);
  const axes = localAxes(delta.map(x => x / length));
  const section = SECTION_GEOMETRY[member.type];
  const size = section.kind === "helix" ? { width: springWidth!, depth: springWidth! }
    : section.kind === "round-hollow" ? {
      width: section.outerDiameter / Math.cos(Math.PI / CHS.clearanceFaces),
      depth: section.outerDiameter / Math.cos(Math.PI / CHS.clearanceFaces),
    }
    : section.kind === "cable" ? { width: section.diameter, depth: section.diameter } : section;
  const parts = springWidth ? [{y: 0, z: 0, ...size}] : sectionParts(member.type);
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

function contacts(a: Placed, b: Placed, coordinatePorts = false): [number[], number[]] {
  const aStations: number[] = [], bStations: number[] = [];
  for (const [index, end] of (["a", "b"] as const).entries()) {
    for (const [otherIndex, other] of (["a", "b"] as const).entries()) {
      if (a[end] === b[other]) { aStations.push(index); bStations.push(otherIndex); }
    }
    for (const port of originalPorts(b)) {
      if (port.available && (a.endTargets?.[end] === port.id || coordinatePorts && !a.endTargets?.[end]) && port.point.join(",") === a[end]) {
        aStations.push(index); bStations.push(port.quarter / 4);
      }
    }
    for (const port of originalPorts(a)) {
      if (port.available && (b.endTargets?.[end] === port.id || coordinatePorts && !b.endTargets?.[end]) && port.point.join(",") === b[end]) {
        aStations.push(port.quarter / 4); bStations.push(index);
      }
    }
  }
  function interior(source: Placed, target: Placed, sourceStations: number[], targetStations: number[]) {
    for (const site of ["q1", "q2", "q3"] as const) {
      const declared = source.interiorTargets?.[site];
      if (!declared) continue;
      const at = attachmentPoint(source, site);
      const station = attachmentQuarter(site) / 4;
      for (const [index, end] of (["a", "b"] as const).entries()) {
        if ((declared === target[end] || declared === target.endTargets?.[end]) && at === target[end]) {
          sourceStations.push(station); targetStations.push(index);
        }
      }
      for (const port of originalPorts(target)) {
        if (port.available && declared === port.id && at === port.point.join(",")) {
          sourceStations.push(station); targetStations.push(port.quarter / 4);
        }
      }
      for (const otherSite of ["q1", "q2", "q3"] as const) {
        // Independent parents may fit the same established interface. Their
        // stored target identity must agree; coincident quarter geometry alone
        // is insufficient, including a raw coordinate in place of a named port.
        if (target.interiorTargets?.[otherSite] === declared && attachmentPoint(target, otherSite) === at) {
          sourceStations.push(station); targetStations.push(attachmentQuarter(otherSite) / 4);
        }
      }
    }
  }
  // A new through-member declares its fitting against an existing interface.
  // The older immutable member never needs a target pointing to future geometry.
  interior(a, b, aStations, bStations);
  interior(b, a, bStations, aStations);
  return [aStations, bStations];
}

function outsideFittings(length: number, stations: number[], printLength = length, fittedRadius?: number): Interval[] {
  const radius = fittedRadius ?? Math.min(CLASH_POLICY.fittingLengthM, printLength / 4);
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

/** Centreline-contact joints need enough clearance for the actual angle and
 * both physical sections. A fixed 250 mm fitting rejects legitimate acute
 * HEB joints. Parallel spans retain the old small fitting region, so selecting
 * a contact cannot waive an overlapping or nested member along its length. */
function jointFittingRadii(a: Solid, b: Solid): [number, number] | undefined {
  const cosine = Math.min(1, Math.abs(dot(a.axes[0], b.axes[0])));
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  if (sine < 1e-6) return undefined;
  const radiusA = Math.hypot(a.bounds.half[1], a.bounds.half[2]);
  const radiusB = Math.hypot(b.bounds.half[1], b.bounds.half[2]);
  return [Math.max(CLASH_POLICY.fittingLengthM, (radiusB + cosine * radiusA) / sine + CLASH_POLICY.toleranceM),
    Math.max(CLASH_POLICY.fittingLengthM, (radiusA + cosine * radiusB) / sine + CLASH_POLICY.toleranceM)];
}

function clash(a: Solid, b: Solid, allowFitting: boolean, permitted?: Set<string>, printA?: number, printB?: number, angleAwareJointFit = false): boolean {
  if (!intersects(a.bounds, b.bounds)) return false;
  const fullA: Interval = [0, a.length], fullB: Interval = [0, b.length];
  if (!materialIntersects(a, fullA, b, fullB)) return false;
  if (!allowFitting) return true;
  let [stationsA, stationsB] = contacts(a.member, b.member, angleAwareJointFit);
  if (permitted) {
    const allowed = (member: Placed, t: number) => permitted.has(pointAt(member,t));
    stationsA = stationsA.filter(t => allowed(a.member,t));
    stationsB = stationsB.filter(t => allowed(b.member,t));
  }
  if (!stationsA.length) return true;
  const radii = angleAwareJointFit ? jointFittingRadii(a, b) : undefined;
  return outsideFittings(a.length, stationsA, printA, radii?.[0]).some(span => materialIntersects(a, span, b, fullB))
    || outsideFittings(b.length, stationsB, printB, radii?.[1]).some(span => materialIntersects(a, fullA, b, span));
}

function pointAt(member: Placed, t: number) {
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  return a.map((v, i) => v + t*(b[i]-v)).join(',');
}

function physicalSolids(member: Placed) {
  if (member.type === "spring") return springParts(member).map((p): Solid => ({
    ...solid({...member, a:p.a.join(','), b:p.b.join(',')},p.width), springStation:[p.from,p.to],
  }));
  if (!member.assembly) return [solid(member)];
  return assemblyParts(member).map(part => solid({
    id: part.id, a: part.a.point.join(','), b: part.b.point.join(','), type: member.type,
    endTargets: { ...(part.a.station === 0 && {a: member.endTargets?.a}),
      ...(part.b.station === 1 && {b: member.endTargets?.b}) },
  }));
}

/** A spring's collar occupies real material on both sides of its exact
 * station. Clip each wire/collar by its parent's permitted fitting interval,
 * including for an incoming fitting at an intermediate spring station. */
function springClash(a: Solid, b: Solid, aParent: Placed, bParent: Placed, allow: boolean, angleAwareJointFit = false) {
  if (!intersects(a.bounds,b.bounds) || !materialIntersects(a,[0,a.length],b,[0,b.length])) return false;
  const [aFit,bFit] = contacts(aParent,bParent,angleAwareJointFit);
  if (!allow || !aFit.length) return true;
  const parentSolid = (parent: Placed) => {
    const section = SECTION_GEOMETRY[parent.type];
    return solid(parent, section.kind === 'helix' ? section.coilDiameter + section.wireDiameter : undefined);
  };
  const radii = angleAwareJointFit ? jointFittingRadii(parentSolid(aParent), parentSolid(bParent)) : undefined;
  function outside(s: Solid, parent: Placed, stations: number[], radius?: number): Interval[] {
    const length = printLength(parent);
    const fits = outsideFittings(length,stations,length,radius);
    if (s.springStation) {
      const [f,t] = s.springStation.map(n => n*length);
      return fits.flatMap(([lo,hi]) => {
        const a = Math.max(lo,f), b = Math.min(hi,t);
        return a < b ? [[s.length*(a-f)/(t-f),s.length*(b-f)/(t-f)] as Interval] : [];
      });
    }
    if (!parent.assembly) return fits;
    const local = ([0,1] as const).filter(t => stations.some(p => pointAt(s.member,t) === pointAt(parent,p)));
    return outsideFittings(s.length,local,length,radius);
  }
  return outside(a,aParent,aFit,radii?.[0]).some(span => materialIntersects(a,span,b,[0,b.length])) ||
    outside(b,bParent,bFit,radii?.[1]).some(span => materialIntersects(a,[0,a.length],b,span));
}

function printLength(member: Placed) {
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  return CELL_SIZE * Math.hypot(...a.map((v,i) => v-b[i]));
}

/** Check one proposed physical member against other reference members. Callers
 * supply distinct, previously validated IDs and nonzero finite spans. The same
 * narrow phase is available to candidate system repairs before analysis. */
export function findMaterialClash(candidate: Placed, others: readonly Placed[], fittingParentId?: number, angleAwareJointFit = false): string | null {
  const unavailable = [candidate, ...others].find(member => !Object.hasOwn(SECTION_GEOMETRY, member.type));
  if (unavailable) return `No verified clearance envelope is available for member ${unavailable.id} (${unavailable.type}).`;
  const incoming = physicalSolids(candidate);
  const incomingLength = candidate.assembly ? printLength(candidate) : undefined;
  for (const existing of others) {
    // A system prop may contact only its declared parent, including at a
    // coincident end that would ordinarily be eligible for a player fitting.
    const fittingAllowed = fittingParentId === undefined ? existing.owner !== "neutral" : existing.id === fittingParentId;
    // The factory's inner nodes create material and intentional factory joints,
    // but only a parent tip or explicitly selected lower-chord port can host
    // a fitting to a different player object.
    const permitted = candidate.assembly || existing.assembly
      ? new Set(contacts(candidate, existing,angleAwareJointFit)[0].map(t => pointAt(candidate,t))) : undefined;
    const occupied = physicalSolids(existing);
    const occupiedLength = existing.assembly ? printLength(existing) : undefined;
    if (incoming.some(a => occupied.some(b => a.springStation || b.springStation
      ? springClash(a,b,candidate,existing,fittingAllowed,angleAwareJointFit)
      : clash(a, b, fittingAllowed, permitted, incomingLength, occupiedLength,angleAwareJointFit)))) {
      return `Member ${candidate.id} (${candidate.type}) would intersect material in member ${existing.id} (${existing.type}). Choose a clear span or target an original attachment port.`;
    }
  }
  return null;
}
