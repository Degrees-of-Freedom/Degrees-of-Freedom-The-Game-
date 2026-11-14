import { vecToGlobal } from './frameMath';
import { solveCombo } from './frameSolve';
import { alphaCr } from './frameStability';
import type { Combo, ComponentResponse, Context, Element, ElementForce, FrameSystem, LoadCombo } from './voxelResults';
import type { VoxelMember } from './voxelInput';
import { verifyLinearResponse } from './voxelVerification';

interface Component {
  nodes: string[];
  memberIds: number[];
  supported: boolean;
}

/** Traverse analytical endpoints, including isolated loads and unused foundations. */
export function findComponents(keys: string[], idx: Map<string, number>, members: VoxelMember[], isF: boolean[]) {
  const neighbours: number[][] = keys.map(() => []);
  for (const member of members) {
    const a = idx.get(member.a)!, b = idx.get(member.b)!;
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  const components: Component[] = [];
  const labels = new Int32Array(keys.length).fill(-1);
  for (let start = 0; start < keys.length; start++) {
    if (labels[start] >= 0) continue;
    const label = components.length;
    const component: Component = { nodes: [], memberIds: [], supported: false };
    components.push(component);
    const stack = [start];
    labels[start] = label;
    while (stack.length) {
      const node = stack.pop()!;
      component.nodes.push(keys[node]);
      if (isF[node]) component.supported = true;
      for (const next of neighbours[node]) {
        if (labels[next] >= 0) continue;
        labels[next] = label;
        stack.push(next);
      }
    }
  }
  for (const member of members) components[labels[idx.get(member.a)!]].memberIds.push(member.id);
  return { components, labels };
}

interface ComponentSystem {
  component: Component;
  active: number[];
  elements: Element[];
  frame: FrameSystem;
}

/** Reindex each independent matrix, retaining the public viewer/solver element identity. */
export function componentSystems(ctx: Context, components: Component[], labels: Int32Array): ComponentSystem[] {
  const nodes: number[][] = components.map(() => []);
  const elements: Element[][] = components.map(() => []);
  ctx.act.forEach((node, a) => nodes[labels[node]].push(a));
  for (const element of ctx.els) elements[labels[ctx.act[element.a]]].push(element);
  return components.flatMap<ComponentSystem>((component, i) => {
    if (!component.supported) return [];
    const active = nodes[i], originals = elements[i];
    if (active.length === ctx.NA) return [{ component, active, elements: originals, frame: ctx }];
    const local = new Map(active.map((a, index) => [a, index]));
    const eq = new Int32Array(active.length * 6).fill(-1);
    let nf = 0;
    active.forEach((a, index) => {
      for (let axis = 0; axis < 6; axis++) {
        if (ctx.eq[6 * a + axis] >= 0) eq[6 * index + axis] = nf++;
      }
    });
    const els = originals.map(element => {
      const a = local.get(element.a)!, b = local.get(element.b)!;
      const dofs = [...eq.subarray(6 * a, 6 * a + 6), ...eq.subarray(6 * b, 6 * b + 6)];
      return { ...element, a, b, dofs };
    });
    return [{ component, active, elements: originals, frame: { NA: active.length, nf, eq, els } }];
  });
}

/** Generate the whole-model loads before calling this function. Dividing a tower
 * payload or bridge traffic per component would apply the same load twice. */
export function solveComponents(
  ctx: Context, systems: ComponentSystem[], components: Component[], combo: LoadCombo,
  F: Float64Array, vis: Combo['vis'],
): { result: Combo; alpha: number | null; componentAlpha: Map<number, number> } {
  const scopes: ComponentResponse[] = [];
  const result: Combo = { combo, F, vis, components: scopes };
  for (const { nodes, memberIds, supported } of components) {
    if (!supported) scopes.push({ nodes, memberIds, status: 'unsupported', reason: 'No foundation in component.' });
  }
  const ef = new Map<Element, ElementForce>();
  const activeCables = new Map<Element, boolean>();
  const reac: Record<number, Float64Array> = {};
  const displacements = new Map<number, Float64Array>();
  const componentAlpha = new Map<number, number>();
  const verificationInputs: { scope: ComponentResponse; system: ComponentSystem; factor: number | null }[] = [];
  let maxD = 0;
  let alpha = Infinity;
  for (const system of systems) {
    const { component, frame, active, elements } = system;
    const scope: ComponentResponse = { nodes: component.nodes, memberIds: component.memberIds, status: 'computed' };
    scopes.push(scope);
    if (frame.nf > 2400) {
      scope.status = 'unresolved';
      scope.reason = 'Component exceeds the browser solver limit of 2400 free degrees of freedom.';
      continue;
    }
    const localF = frame === ctx ? F : new Float64Array(frame.NA * 6);
    if (localF !== F) active.forEach((a, i) => localF.set(F.subarray(6 * a, 6 * a + 6), 6 * i));
    const solved = solveCombo(frame, localF);
    if ('fail' in solved) {
      scope.status = solved.reason ? 'unresolved' : 'mechanism';
      scope.reason = solved.reason ?? 'Singular constrained stiffness.';
      continue;
    }
    let componentMax = 0;
    for (let i = 0; i < active.length; i++) {
      componentMax = Math.max(componentMax, Math.hypot(solved.u[6 * i], solved.u[6 * i + 1], solved.u[6 * i + 2]));
    }
    if (!Number.isFinite(componentMax) || componentMax > 2) {
      scope.status = Number.isFinite(componentMax) ? 'excessive-displacement' : 'unresolved';
      scope.reason = 'Response outside the small-displacement solver range.';
      continue;
    }
    maxD = Math.max(maxD, componentMax);
    // Applied sandbox response can feed a scored frame result. Design
    // combinations retain their existing checks and numerical work budget.
    const checkApplied = combo.type === 'SLS' && combo.dir.every(value => value === 0);
    if (combo.type === 'ULS' || checkApplied) {
      const critical = checkApplied && elements.some(element => element.cable) ? null : alphaCr(frame, solved);
      if (checkApplied) verificationInputs.push({ scope, system, factor: critical });
      if (combo.type === 'ULS' && critical !== null) {
        alpha = Math.min(alpha, critical);
        for (const id of component.memberIds) componentAlpha.set(id, critical);
      }
    }
    active.forEach((a, i) => {
      displacements.set(a, solved.u.subarray(6 * i, 6 * i + 6));
      if (ctx.isF[ctx.act[a]]) reac[a] = F.slice(6 * a, 6 * a + 6).map(value => -value);
    });
    elements.forEach((original, i) => {
      const local = frame.els[i];
      const force = solved.ef.get(local)!;
      ef.set(original, force);
      if (original.cable) activeCables.set(original, solved.active.get(local)!);
      const global = vecToGlobal(force.f, original.R);
      for (const [node, offset] of [[original.a, 0], [original.b, 6]]) {
        if (!reac[node]) continue;
        for (let axis = 0; axis < 6; axis++) reac[node][axis] += global[offset + axis];
      }
    });
  }
  if (displacements.size) {
    for (const [a, reaction] of Object.entries(reac)) {
      for (let axis = 0; axis < 6; axis++) if (ctx.eq[6 * Number(a) + axis] >= 0) reaction[axis] = 0;
    }
    result.ef = ef;
    result.reac = reac;
    result.maxD = maxD;
    result.active = activeCables;
    if (displacements.size === ctx.NA) {
      result.u = new Float64Array(6 * ctx.NA);
      for (const [a, values] of displacements) result.u.set(values, 6 * a);
    } else result.partialDisplacements = displacements;
    for (const { scope, system, factor } of verificationInputs) {
      scope.verification = verifyLinearResponse(ctx, result, system.active, system.elements, factor);
    }
  } else result.fail = true;
  return { result, alpha: displacements.size === ctx.NA ? alpha : null, componentAlpha };
}
