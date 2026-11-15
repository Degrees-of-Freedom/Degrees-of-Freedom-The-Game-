import type { MemberView, MultiplayerViewData, RotationMask, Vec3 } from './types';
import { quarterPorts } from './viewModel';

const fixed: RotationMask = [true, true, true];
const rotations = (id: string): RotationMask => id === 'C' || id === 'D' ? [true, false, true] : fixed;
const nodes: readonly { id: string; p: Vec3 }[] = [
  { id: 'A0', p: [3, 4, 0] }, { id: 'A', p: [3, 4, 4] },
  { id: 'B0', p: [12, 4, 0] }, { id: 'B', p: [12, 4, 4] },
  { id: 'C', p: [7.5, 9, 6] }, { id: 'D', p: [7.5, 13, 5] },
];
const position = (id: string) => nodes.find(n => n.id === id)!.p;
function member(id: string, family: MemberView['family'], a: string, b: string, maxLength: MemberView['maxLength'], setupLocked = false): MemberView {
  const start = position(a), end = position(b);
  return { id, family, cardId: `fixture-${id}`, owner: a.startsWith('A') ? 'Amber' : 'Jade', startNode: a, endNode: b, start, end, maxLength,
    setupLocked, phase: 'committed', rotations: [rotations(a), rotations(b)], quarterPorts: quarterPorts(id, start, end),
    ...(family === 'member' ? { section: { width: 0.12, depth: 0.2, unit: 'game units' as const } } : family === 'cable' ? { section: { width: 0.04, depth: 0.04, unit: 'game units' as const } } : {}),
    ...(family.startsWith('spring') ? { spring: { k0: 40000, unit: 'N/m' } } : {}) };
}

/** Synthetic display evidence only: not a legal saved match and not a solver acceptance fixture. */
export const sceneFixture: MultiplayerViewData = {
  revision: 'display-fixture-1', board: { width: 15, depth: 15, height: 12 }, metresPerUnit: 2,
  members: [member('column-A', 'member', 'A0', 'A', 5, true), member('column-B', 'member', 'B0', 'B', 5, true),
    member('beam', 'member', 'A', 'B', 10), member('cable', 'cable', 'A', 'C', 10),
    member('spring-quarter', 'spring-025', 'C', 'B', 10), member('spring-half', 'spring-05', 'C', 'D', 5)],
  joints: nodes.map(n => ({ id: n.id, position: n.p, rotations: rotations(n.id),
    setupLocked: n.id !== 'C' && n.id !== 'D',
    ...(n.id === 'A0' ? { foundationOwner: 'Amber' } : n.id === 'B0' ? { foundationOwner: 'Jade' } : {}),
    ...(n.id === 'C' ? { overrides: [{ id: 'safety-1', kind: 'rotation', axes: ['Y'], reason: 'Synthetic local correction record for inspection', originatingTurn: 2, checkpointId: 'fixture-checkpoint', frame: 'global', verified: false, reaction: [0, 0, 0], reactionUnit: 'N·m' }] } : {}) })),
  checkpoint: { id: 'fixture-checkpoint', turn: 3, modelRevision: 'display-fixture-1', valid: true, provenance: 'SYNTHETIC DISPLAY FIXTURE · not solver verification', forceUnit: 'N', sources: ['C', 'D'], supports: ['A0', 'B0'], segments: [
    { id: 'col-a', memberId: 'column-A', a: 'A0', b: 'A', magnitude: 600, axial: -600, valid: true },
    { id: 'col-b', memberId: 'column-B', a: 'B0', b: 'B', magnitude: 700, axial: -700, valid: true },
    { id: 'beam', memberId: 'beam', a: 'A', b: 'B', magnitude: 150, axial: 0, valid: true },
    { id: 'cable', memberId: 'cable', a: 'A', b: 'C', magnitude: 500, axial: 500, valid: true },
    { id: 'spring-quarter', memberId: 'spring-quarter', a: 'C', b: 'B', magnitude: 600, axial: -600, valid: true },
    { id: 'spring-half', memberId: 'spring-half', a: 'C', b: 'D', magnitude: 100, axial: 100, valid: true },
  ] },
};
