import type { FrameConnection } from '../../evaluator/connections';
export { validFrameConnection, type FrameConnection } from '../../evaluator/connections';

interface Slip {
  start: number;
  axis: number[];
  stiffness: number;
}
interface Elimination extends Slip {
  recovery: Float64Array;
}
export interface ConnectionReduction {
  stiffness: Float64Array;
  eliminations: Elimination[];
  stable: boolean;
}

/** Internal unknowns are the physical member-end motion minus joint motion,
 * expressed on each connector's own axes. Locked directions have no internal
 * unknown. The six relative rotations/translations use the same right-handed,
 * infinitesimal vector convention as the frame element. */
export function connectorSlips(ends: [FrameConnection, FrameConnection], R: number[][]): Slip[] {
  const slips: Slip[] = [];
  ends.forEach((end, i) => end.laws.forEach((law, q) => {
    if (law.kind === 'locked') return;
    const direction = end.axes[q % 3];
    slips.push({
      start: i * 6 + (q < 3 ? 0 : 3),
      axis: R.map(row => row[0]*direction[0] + row[1]*direction[1] + row[2]*direction[2]),
      stiffness: law.kind === 'elastic' ? law.stiffness / 1000 : 0,
    });
  }));
  return slips;
}

/** Exact scalar Schur complements for independent slips. Each elastic law
 * contributes k s²/2 before its coordinate is eliminated. No penalty
 * stiffness stands in for a lock. Recover in reverse elimination order. */
export function reduceConnections(k: Float64Array, slips: Slip[]): ConnectionReduction {
  const stiffness = k.slice();
  const eliminations: Elimination[] = [];
  const scale = Math.max(...k.map(Math.abs), 1);
  for (const slip of slips) {
    const { start, axis } = slip;
    const coupling = new Float64Array(12);
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 3; i++) coupling[j] += axis[i] * stiffness[(start+i)*12 + j];
    }
    const pivot = slip.stiffness + axis.reduce((sum, v, i) => sum + v * coupling[start+i], 0);
    if (!(pivot > scale * 1e-13)) {
      // A member may spin around its own longitudinal axis when released at
      // both ends. It carries no torsion on this mode. A free translation or
      // transverse rotation is a physical mechanism; a negative tangent is
      // also unstable. Never add a numerical restraint to cure either.
      const mode = new Float64Array(12);
      mode.set(axis, start);
      const free = recoverConnectorMotion(mode, eliminations);
      const pureSpin = free.every((v, i) => i === 3 || i === 9 || Math.abs(v) < 1e-9);
      if (pivot < -scale * 1e-13 || !pureSpin || slip.stiffness !== 0 || !Number.isFinite(pivot)) {
        return { stiffness, eliminations, stable: false };
      }
      continue;
    }
    const recovery = coupling.map(v => -v / pivot);
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j <= i; j++) {
        const value = stiffness[i*12+j] + recovery[i]*coupling[j];
        stiffness[i*12+j] = value;
        stiffness[j*12+i] = value;
      }
    }
    eliminations.push({ ...slip, recovery });
  }
  return { stiffness, eliminations, stable: true };
}

export function recoverConnectorMotion(jointLocal: Float64Array, eliminations: Elimination[]) {
  const u = jointLocal.slice();
  for (let n = eliminations.length-1; n >= 0; n--) {
    const { start, axis, recovery } = eliminations[n];
    let relative = 0;
    for (let j = 0; j < 12; j++) relative += recovery[j] * u[j];
    for (let j = 0; j < 3; j++) u[start+j] += axis[j] * relative;
  }
  return u;
}
