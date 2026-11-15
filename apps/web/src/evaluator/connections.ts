/** Six-axis member-end connection laws, as printed on a connection card. */
import type { StructuralSnapshot, Vector3 } from '@dof/solver-contract';

type Connection = StructuralSnapshot['connections'][number];
export interface FrameConnection {
  /** Right-handed orthonormal joint axes, expressed in global coordinates. */
  axes: readonly [Vector3, Vector3, Vector3];
  /** UX, UY, UZ, RX, RY, RZ. Elastic values use N/m or N·m/rad. */
  laws: Connection['laws'];
}

export function validFrameConnection(end: FrameConnection) {
  const [x, y, z] = end.axes;
  const rightHanded = (x[1]*y[2]-x[2]*y[1])*z[0] +
    (x[2]*y[0]-x[0]*y[2])*z[1] + (x[0]*y[1]-x[1]*y[0])*z[2];
  return Math.abs(rightHanded-1) < 1e-10 &&
    end.axes.every((a,i) => end.axes.every((b,j) =>
      Math.abs(a.reduce((s,v,k) => s + v*b[k],0) - (i === j ? 1 : 0)) < 1e-10)) &&
    end.laws.every(law => law.kind === 'free' || law.kind === 'locked' ||
      (law.kind === 'elastic' && Number.isFinite(law.stiffness) && law.stiffness > 0));
}
