import type { StructuralSnapshot, Vector3 } from "@dof/solver-contract";

type ComponentLaw = StructuralSnapshot["connections"][number]["laws"][number];
type Freedom = ComponentLaw["kind"] | ComponentLaw;
type Freedoms = readonly [Freedom, Freedom, Freedom, Freedom, Freedom, Freedom];
/** Local unit basis vectors expressed in the shared physical coordinate system. */
type Frame = readonly [Vector3, Vector3, Vector3];
const globalFrame: Frame = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const axes = ["UX", "UY", "UZ", "RX", "RY", "RZ"] as const;

export const CONNECTION_PROFILES = {
  fixed: ["locked", "locked", "locked", "locked", "locked", "locked"],
  ball: ["locked", "locked", "locked", "free", "free", "free"],
} as const satisfies Record<string, Freedoms>;

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
