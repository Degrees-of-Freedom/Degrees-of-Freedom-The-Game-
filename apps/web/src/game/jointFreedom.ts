import type { StructuralSnapshot, Vector3 } from "@dof/solver-contract";
import type { FrameConnection } from "../solver/frameConnections";
import { localAxes } from '../solver/frameMath';
import { parseNodeKey, type Member } from './model';

type ComponentLaw = StructuralSnapshot["connections"][number]["laws"][number];
type Freedom = ComponentLaw["kind"] | ComponentLaw;
type Freedoms = readonly [Freedom, Freedom, Freedom, Freedom, Freedom, Freedom];
/** Local unit basis vectors expressed in the shared physical coordinate system. */
export type Frame = readonly [Vector3, Vector3, Vector3];
const globalFrame: Frame = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const axes = ["UX", "UY", "UZ", "RX", "RY", "RZ"] as const;

export const CONNECTION_PROFILES = {
  fixed: ["locked", "locked", "locked", "locked", "locked", "locked"],
  "lock-x": ["locked", "locked", "locked", "locked", "free", "free"],
  "lock-y": ["locked", "locked", "locked", "free", "locked", "free"],
  "lock-z": ["locked", "locked", "locked", "free", "free", "locked"],
  "lock-xy": ["locked", "locked", "locked", "locked", "locked", "free"],
  "lock-xz": ["locked", "locked", "locked", "locked", "free", "locked"],
  "lock-yz": ["locked", "locked", "locked", "free", "locked", "locked"],
  ball: ["locked", "locked", "locked", "free", "free", "free"],
  "hinge-diagonal": ["locked", "locked", "locked", "free", "locked", "locked"],
  "guided-x": ["free", "locked", "locked", "locked", "locked", "locked"],
  "seat-20": ["locked", "locked", "elastic", "locked", "locked", "locked"],
  "seat-80": ["locked", "locked", "elastic", "locked", "locked", "locked"],
  "semi-rigid": ["locked", "locked", "locked", "locked", "locked", "elastic"],
} as const satisfies Record<string, Freedoms>;

export type ConnectionProfile = keyof typeof CONNECTION_PROFILES;
const c = Math.SQRT1_2;
const diagonalFrame: Frame = [[c, c, 0], [-c, c, 0], [0, 0, 1]];
const labels: Record<ConnectionProfile, string> = {
  fixed: "Fixed / moment", ball: "Ball joint", "hinge-diagonal": "Diagonal hinge",
  "lock-x": "Lock X", "lock-y": "Lock Y", "lock-z": "Lock Z",
  "lock-xy": "Lock X and Y", "lock-xz": "Lock X and Z", "lock-yz": "Lock Y and Z",
  "guided-x": "X guide", "seat-20": "Elastic seat · 20 MN/m", "seat-80": "Elastic seat · 80 MN/m",
  "semi-rigid": "Yaw spring · 8 MN·m/rad",
};
export const connectionLabel = (profile: ConnectionProfile) => labels[profile];
export const connectionFrame = (profile: ConnectionProfile): Frame => profile === "hinge-diagonal" ? diagonalFrame : globalFrame;

/** The physical section frame, shared by both ends, uses A→B as local X.
 * It matches beam assembly and section rendering rather than the camera. */
export function memberConnectionFrame(member: Pick<Member, 'a' | 'b'>): Frame {
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b);
  const delta = b.map((value, axis) => value - a[axis]);
  const length = Math.hypot(...delta);
  if (!Number.isFinite(length) || length === 0) throw new Error('A connection needs a finite nonzero member span.');
  // JSON stores -0 as 0. Canonicalize that sign before saving/replaying a frame.
  const [x, y, z] = localAxes(delta.map(value => value / length)).map(axis => axis.map(value => value === 0 ? 0 : value));
  return [[x[0], x[1], x[2]], [y[0], y[1], y[2]], [z[0], z[1], z[2]]];
}

export function connectionFrameFor(connection: {profile: ConnectionProfile; axes?: Frame}): Frame {
  return connection.axes ?? connectionFrame(connection.profile);
}

/** A saved physical frame fixes the printing's directions. Historical cards
 * without an explicit frame retain their global convention. Camera orbit
 * never reorients an already attached connection. */
export function connectionDefinition(profile: ConnectionProfile, axes = connectionFrame(profile)): FrameConnection {
  const stiffness = profile === "seat-20" ? 20e6 : profile === "seat-80" ? 80e6 : 8e6;
  const law = (q: number): ComponentLaw => {
    const kind = CONNECTION_PROFILES[profile][q];
    return kind === "elastic" ? { kind, stiffness } : { kind };
  };
  return { axes,
    laws: [law(0), law(1), law(2), law(3), law(4), law(5)] };
}

function kind(law: Freedom): ComponentLaw["kind"] {
  return typeof law === "string" ? law : law.kind;
}

/**
 * Return the established joint-frame components with incompatible incoming
 * permissions. Axes in different frames can be compared through their dot
 * products. A direction may span several locked (or free) axes. An authored
 * elastic axis must have the same physical line, even with different stiffness.
 * Frames supplied by callers must be orthonormal. The epsilon only absorbs
 * floating-point rotation roundoff; it does not snap placement directions.
 */
export function conflictingJointAxes(
  established: Freedoms,
  incoming: Freedoms,
  establishedFrame: Frame = globalFrame,
  incomingFrame: Frame = globalFrame,
): string[] {
  const epsilon = 1e-12;
  return axes.filter((_, index) => {
    const expected = kind(established[index]);
    const group = index < 3 ? 0 : 3;
    const a = establishedFrame[index % 3];
    return incomingFrame.some((b, j) => {
      const overlap = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
      if (overlap <= epsilon) return false;
      return expected !== kind(incoming[group + j]) ||
        (expected === "elastic" && Math.abs(overlap - 1) > epsilon);
    });
  });
}
