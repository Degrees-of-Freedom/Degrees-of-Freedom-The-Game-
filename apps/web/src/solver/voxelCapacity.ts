import type { VoxelModel } from './voxelInput';
import type { ComponentResponse, VoxelAnalysis } from './voxelResults';
import { ITEMS, type BeamSection, type BeamType } from './voxelSections';
import { verifiedResponse } from './voxelVerification';
import { connectionDefinition, type Frame } from '../game/jointFreedom';
import { vecToGlobal } from './frameMath';

/** Printed playtest limit states. Values are kN and kN·m. Section axial,
 * bending and shear strengths come from the same section used for analysis.
 * Torsional strengths are authored card limits, independent of the elastic J.
 * Connector force and moment intercepts reuse the existing design catalogue. */
export const CARD_STRENGTH = {
  version: 'card-strength-1',
  torsion: { shs: 20, chs: ITEMS.chs.fv*ITEMS.chs.J/0.05, glulam: 7, ipe: 3.5, heb: 18 } satisfies Record<BeamType, number>,
  connections: { fixed: { force: 700, moment: 220 }, ball: { force: 350 },
    'hinge-diagonal': {force:400, moment:80}, 'guided-x': {force:400, moment:80},
    'seat-20': {force:400, moment:80}, 'seat-80': {force:400, moment:80}, 'semi-rigid': {force:400, moment:80},
    'lock-x': {force:400, moment:80}, 'lock-y': {force:400, moment:80}, 'lock-z': {force:400, moment:80},
    'lock-xy': {force:400, moment:80}, 'lock-yz': {force:400, moment:80}, 'lock-xz': {force:400, moment:80} },
} as const;

type AttachedEnd = { memberId: number; end: 'a' | 'b'; profile: keyof typeof CARD_STRENGTH.connections;
  axes?: Frame; transferProfile?: keyof typeof CARD_STRENGTH.connections };
export interface LocalActions { N: number; Vy: number; Vz: number; T: number; My: number; Mz: number }
export type CapacityCheck =
  | { status: 'verified'; utilization: number; governing: string; station: number; actions: LocalActions }
  | { status: 'unavailable'; reason: string };
export interface CardCapacity {
  version: typeof CARD_STRENGTH.version;
  members: Record<number, CapacityCheck>;
  connections: Record<string, CapacityCheck>;
}

const unavailable = (reason: string): CapacityCheck => ({ status: 'unavailable', reason });

/** Section cuts use positive axial tension. Reverse the element nodal actions
 * at the start to express cuts on the same face at both ends of the span. */
function sectionCut(f: Float64Array, end: 'a' | 'b'): LocalActions {
  const i = end === 'a' ? 0 : 6;
  const sign = end === 'a' ? -1 : 1;
  return { N: sign*f[i], Vy: sign*f[i+1], Vz: sign*f[i+2],
    T: sign*f[i+3], My: sign*f[i+4], Mz: sign*f[i+5] };
}

function memberCheck(type: BeamType, s: BeamSection, actions: LocalActions, station: number): CapacityCheck {
  const { N, Vy, Vz, T, My, Mz } = actions;
  // Magnitudes give the outer-corner extreme for biaxial bending of these
  // doubly symmetric sections. Timber has separate printed bending strength.
  const axial = N / s.A;
  const bending = type === 'chs' ? Math.hypot(My/s.Wy, Mz/s.Wz) : Math.abs(My)/s.Wy + Math.abs(Mz)/s.Wz;
  let normal: number;
  if (type === 'glulam') {
    // The card specifies separate bending and axial strengths.
    normal = Math.max(axial/s.ft, -axial/s.fc) + bending/s.fm;
  } else {
    normal = Math.max((axial+bending)/s.ft, (bending-axial)/s.fc);
  }
  // The printed shear envelope combines both lateral components with a
  // conservative additive torsional shear allowance. Steel uses an elliptic
  // normal/shear interaction with the section's yield/shear strength ratio.
  const shear = Math.hypot(Vy/s.Avy, Vz/s.Avz)/s.fv + Math.abs(T)/CARD_STRENGTH.torsion[type];
  const utilization = type === 'glulam' ? Math.max(normal, shear) : Math.hypot(normal, shear);
  let governing = normal >= shear ? 'Axial and biaxial bending' : 'Shear and torsion';
  if (type !== 'glulam' && normal > 1e-8 && shear > 1e-8) governing = 'Combined section stress';
  return { status: 'verified', utilization, governing, station, actions };
}

function connectorCheck(attachment: AttachedEnd, actions: LocalActions, station: number, memberAxes?: number[][], length = 1): CapacityCheck {
  const { N, Vy, Vz, T, My, Mz } = actions;
  const force = Math.hypot(N, Vy, Vz);
  const rating = CARD_STRENGTH.connections[attachment.profile];
  if (!rating) {
    return unavailable('This connector has no printed strength law in card-strength-1.');
  }
  let moment = Math.hypot(T, My, Mz);
  if (memberAxes && (attachment.axes || attachment.transferProfile)) {
    const local = new Float64Array(12);
    local.set([N, Vy, Vz, T, My, Mz]);
    const global = vecToGlobal(local, memberAxes);
    const transfer = connectionDefinition(attachment.transferProfile ?? attachment.profile, attachment.axes);
    const projected = [0, 1].flatMap(group => transfer.axes.map(axis =>
      axis.reduce((value, component, i) => value + component * global[3 * group + i], 0)));
    const scale = Math.max(1, force, moment / length);
    const incompatible = transfer.laws.some((law, i) => law.kind === 'free' &&
      Math.abs(projected[i]) > 1e-5 * scale * (i < 3 ? 1 : length));
    if (incompatible) return unavailable('Calculated action crosses a released component in the saved physical connection frame.');
    const original = connectionDefinition(attachment.profile, attachment.axes);
    // A system moment sleeve bypasses the original released directions.
    // Those actions are checked against the separately rated fixed fitting.
    moment = Math.hypot(...original.axes.map((axis, i) => original.laws[i + 3].kind === 'free' ? 0 :
      axis.reduce((value, component, q) => value + component * global[3 + q], 0)));
  }
  // A07 has already checked that released local moments vanish. There is
  // no ball moment capacity or interior continuity connector to manufacture.
  const utilization = 'moment' in rating ?
    Math.hypot(force/rating.force, moment/rating.moment) : force/rating.force;
  return { status: 'verified', utilization, governing: attachment.profile === 'ball'
    ? 'Ball connector resultant force' : attachment.profile === 'fixed' ? 'Fixed connector force and moment' :
      'Printed connector force and moment', station, actions };
}

/** For the simultaneous nodal card-gravity case only. Between physical load
 * stations each section action is affine, and the printed convex interaction
 * reaches its maximum at an end. Preserve BOTH sides of an interior load in
 * that comparison. A released or absent external connector belongs only to its
 * own original end. Internal subdivision never creates another connector. */
export function assessCardCapacity(
  model: VoxelModel, analysis: VoxelAnalysis, attachments: readonly AttachedEnd[],
): CardCapacity {
  const report: CardCapacity = { version: CARD_STRENGTH.version, members: {}, connections: {} };
  const attached = new Map(attachments.map(a => [`${a.memberId}:${a.end}`, a]));
  const combo = analysis.combos[0];
  const scopes = new Map(combo?.components?.flatMap(scope => scope.memberIds.map(id => [id, scope] as const)));
  const elements = new Map(analysis.ctx?.els.map(e => [e.m.id, e]));
  const invalid = new Map<number, string>();
  const uncertainScopes = new Map<ComponentResponse, string>();
  for (const [id] of attached) report.connections[id] = unavailable('No verified card-gravity response for this end.');
  for (const m of model.members) {
    const parent = m.parentSpan?.memberId ?? m.id;
    const from = (m.parentSpan?.fromQuarter ?? 0)/4;
    const to = (m.parentSpan?.toQuarter ?? 4)/4;
    const e = elements.get(m.id), scope = scopes.get(m.id);
    const forces = e && combo?.ef?.get(e);
    if (!e || !scope || !forces || !verifiedResponse(scope.verification) ||
        (e.cable && !Number.isFinite(forces.cableTension)) || !forces.f.every(Number.isFinite)) {
      invalid.set(parent, scope?.verification?.reason ?? scope?.reason ?? 'Verified linear frame actions unavailable.');
      continue;
    }
    // Subdivision is not a physical lateral brace. Screen the full original
    // unbraced length for compression even if its analytical pieces are short.
    const part = m.parentSpan?.assemblyPart;
    // In-plane panel joints alone do not externally brace the two chords out
    // of plane. Posts have zero station difference and a real physical length.
    const length = m.parentSpan?.unbracedLengthM ?? (part ? e.L : e.L/(to-from));
    if (e.it.kind === 'beam' && scope.verification?.status !== 'verified-nonlinear') {
      const minI = Math.min(e.it.Iy, e.it.Iz);
      const euler = Math.PI**2 * e.it.E * minI / (2*length)**2;
      if (length/Math.sqrt(minI/e.it.A) > 300 || -forces.f[6] > euler/10) {
        uncertainScopes.set(scope, `Original span of member ${parent} requires slender-member verification.`);
        continue;
      }
    }
    // Curved loaded members can govern at an interior mesh station. Both
    // sides of every internal cut come from the nonlinear reference solve.
    if (e.it.kind === 'beam') for (const cut of forces.stations ?? []) {
      const [N,Vy,Vz,T,My,Mz] = cut.forces;
      const check = memberCheck(m.type as BeamType, e.it, {N,Vy,Vz,T,My,Mz}, from + cut.fraction*(to-from));
      const previous = report.members[parent];
      if (check.status === 'verified' && (previous?.status !== 'verified' || check.utilization > previous.utilization)) {
        report.members[parent] = part ? {...check, governing: part + ' · ' + check.governing} : check;
      }
    }
    for (const end of ['a', 'b'] as const) {
      const station = end === 'a' ? from : to;
      const actions = e.cable ? {N:forces.cableTension!, Vy:0, Vz:0, T:0, My:0, Mz:0} : sectionCut(forces.f, end);
      let check: CapacityCheck = e.it.kind === 'cable'
        ? {status:'verified', utilization:actions.N/e.it.NRd, governing:'Cable tensile force', actions, station}
        : e.it.kind === 'spring'
        ? { status: 'verified', utilization: Math.abs(actions.N) / (e.it.axialForceLimitN / 1000),
          governing: 'Spring axial force', actions, station }
        : memberCheck(m.type as BeamType, e.it, actions, station);
      if (part && m.endA === 'ball' && m.endB === 'ball') {
        // Each printed factory diagonal uses a pin fitting at either end.
        const pin = connectorCheck({ memberId: parent, end, profile: 'ball' }, actions, station);
        if (pin.status === 'verified' && check.status === 'verified' && pin.utilization > check.utilization) check = pin;
      }
      const previous = report.members[parent];
      if (check.status === 'verified' && (previous?.status !== 'verified' || check.utilization > previous.utilization)) {
        report.members[parent] = part ? { ...check, governing: part + ' · ' + check.governing } : check;
      }
      if (station === 0 || station === 1) {
        const key = `${parent}:${end}`, attachment = attached.get(key);
        if (attachment) report.connections[key] = connectorCheck(attachment, actions, station, e.R, e.L);
      }
    }
  }
  // A possible change to the physical equilibrium invalidates strength
  // conclusions everywhere in this component, including neighbouring cards.
  for (const m of model.members) {
    const scope = scopes.get(m.id);
    const reason = scope && uncertainScopes.get(scope);
    if (reason) invalid.set(m.parentSpan?.memberId ?? m.id, reason);
  }
  for (const [id, reason] of invalid) {
    report.members[id] = unavailable(reason);
    for (const end of ['a', 'b']) {
      const key = `${id}:${end}`;
      if (attached.has(key)) report.connections[key] = unavailable(reason);
    }
  }
  return report;
}
