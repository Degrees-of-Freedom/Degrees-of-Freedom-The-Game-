import { parse } from './voxelCoordinates';
import type { VoxelModel } from './voxelInput';

/** An exact zero-strain rigid displacement of one or more parent members.
 * A rotation about a line through stationary ball contacts preserves each
 * connector and every member length at any sufficiently small finite angle.
 * Scope names are original physical IDs, independent of meshing/mode basis.
 */
export interface RigidMotionWitness {
  motion: 'free translation' | 'rotation about a pin' | 'rotation about a pin line';
  memberIds: number[];
  contactNodes: string[];
}

const crossLength = (a: number[], b: number[]) => Math.hypot(
  a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0],
);

/** Find sufficient geometric witnesses. Failure to find one says nothing
 * about stability. Multi-body mechanisms can require several moving groups.
 * This diagnostic is defined for the scored fixed/ball prismatic-frame model.
 */
export function rigidBodyWitnesses(model: VoxelModel): Map<number, RigidMotionWitness> {
  const roots = new Map<number, number>();
  const joints = new Map<string, Map<number, boolean>>();
  const coordinates = (key: string) => model.positions?.[key] ?? parse(key);
  const find = (id: number) => {
    let root = id;
    while (roots.get(root) !== root) root = roots.get(root)!;
    return root;
  };
  const endpoints = new Map<number, string[]>();
  for (const m of model.members) {
    const id = m.parentSpan?.memberId ?? m.id;
    roots.set(id, id);
    const nodes = endpoints.get(id) ?? [];
    nodes.push(m.a, m.b);
    endpoints.set(id, nodes);
    for (const [key, law] of [[m.a, m.endA], [m.b, m.endB]] as const) {
      const attached = joints.get(key) ?? new Map<number, boolean>();
      attached.set(id, !!attached.get(id) || (m.type !== 'cable' && law === 'fixed'));
      joints.set(key, attached);
    }
  }
  for (const attached of joints.values()) {
    const fixed = [...attached].filter(([, rigid]) => rigid).map(([id]) => id);
    for (const id of fixed.slice(1)) roots.set(find(id), find(fixed[0]));
  }
  const groups = new Map<number, number[]>();
  for (const id of roots.keys()) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  const witnesses = new Map<number, RigidMotionWitness>();
  for (const [root, memberIds] of groups) {
    const pins: string[] = [];
    let grounded = false;
    for (const [key, attached] of joints) {
      const ours = [...attached].filter(([id]) => find(id) === root);
      if (!ours.length) continue;
      if (model.attrs[key]?.found && ours.some(([, rigid]) => rigid)) grounded = true;
      if (model.attrs[key]?.found || ours.length < attached.size) pins.push(key);
    }
    if (grounded) continue;
    pins.sort();
    const origin = pins.length ? coordinates(pins[0]) : [0, 0, 0];
    const offset = (key: string) => coordinates(key).map((x, i) => x - origin[i]);
    const pinLine = pins.map(offset).find(v => Math.hypot(...v) > 0);
    let direction = pinLine;
    // Quarter-grid coordinates are exactly representable in binary. Testing
    // exact collinearity avoids certifying a merely near-collinear support.
    if (pinLine && pins.some(key => crossLength(pinLine, offset(key)) !== 0)) continue;
    const loaded = memberIds.flatMap(id => endpoints.get(id)!).filter(key => !!model.attrs[key]?.load);
    // A hanging gravity-loaded body can gain restoring stiffness in a finite
    // rotation. Certify a neutral motion only when the applied gravity does
    // no work along it. Horizontal rigid translation always preserves height.
    if (pins.length && loaded.some(key => Math.hypot(...offset(key)) > 0)) {
      direction ??= [0, 0, 1];
      const vertical = direction[0] === 0 && direction[1] === 0;
      if (!vertical && loaded.some(key => crossLength(direction!, offset(key)) !== 0)) continue;
    }
    const moving = memberIds.filter(id => !direction ||
      endpoints.get(id)!.some(key => crossLength(direction, offset(key)) > 0)).sort((a,b) => a-b);
    const witness: RigidMotionWitness = {
      motion: !pins.length ? 'free translation' : direction ? 'rotation about a pin line' : 'rotation about a pin',
      memberIds: moving, contactNodes: pins,
    };
    for (const id of moving) witnesses.set(id, witness);
  }
  return witnesses;
}
