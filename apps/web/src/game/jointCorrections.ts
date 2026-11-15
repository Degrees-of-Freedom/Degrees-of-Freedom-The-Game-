import { connectionDefinition } from './jointFreedom';
import type { TurnState } from './turns';
import type { SystemProvenance } from './turnRepair';

/** A permanent system fitting changes relative moment transfer at an existing
 * intentional joint. It never connects that joint to the ground. Original
 * player connector printings remain available for inspection and replay. */
export interface JointCorrection {
  jointId: string;
  lockedRotations: number;
  system: SystemProvenance;
}

type Board = TurnState['board'];
export function jointCorrectionMask(board: Board, jointId: string) {
  return (board.jointCorrections ?? []).filter(correction => correction.jointId === jointId)
    .reduce((mask, correction) => mask | correction.lockedRotations, 0);
}

export function effectiveJointConnections(board: Board) {
  return board.connections.map(connection => {
    const mask = jointCorrectionMask(board, connection.jointId);
    if (!mask) return connection;
    const law = connectionDefinition(connection.profile);
    const rotationKinds = law.laws.slice(3).map((component, axis) => mask & (1 << axis) ? 'locked' : component.kind);
    const rotationalMask = rotationKinds.reduce((bits, kind, axis) => kind === 'locked' ? bits | (1 << axis) : bits, 0);
    // Correction candidates currently fit all three rotations. A fixed
    // profile is only valid for an originally translation-locked printing.
    if (rotationalMask === 7 && law.laws.slice(0, 3).every(component => component.kind === 'locked')) {
      return {...connection, profile: 'fixed' as const};
    }
    return connection;
  });
}
