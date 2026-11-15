import * as THREE from "three";
import type { VoxelAnalysis } from "../solver/voxelResults";

/** Returned mode vectors are a basis supplied by the solver, not a count of
 * free connector axes or a prediction of the structure's collapse motion. */
export function instabilityModes(result: VoxelAnalysis) {
  return (result.combos[0]?.components ?? []).flatMap((scope, component) =>
    (scope.diagnosticModes ?? []).map((mode, index) => ({ ...mode, component, index,
      hasNodalMotion: Object.values(mode.displacements).some(values => values.length === 6 &&
        values.every(Number.isFinite) && values.some(value => value !== 0)),
      memberIds: scope.memberIds, reason: scope.reason })));
}

/** Separate schematic ghost. It interpolates only between supplied nodal
 * vectors and does not invent an internal beam/buckling deformation field.
 * Rotational vectors remain visible even for a spin with no nodal translation.
 * The caller owns disposal with the scene and calls animateInstability(time). */
export function drawInstabilityMode(group: THREE.Group, result: VoxelAnalysis, index: number, playing = false) {
  const mode = instabilityModes(result)[index], ctx = result.ctx;
  if (!mode || !mode.hasNodalMotion || (!ctx && !result.diagnosticGeometry)) return;
  const ids = new Set(mode.memberIds);
  // Equilibrium assembly deliberately drops floating elements. Mode geometry
  // follows the complete original SI model, with explicit identities/edges.
  const topology = result.diagnosticGeometry?.segments ?? ctx!.els.map(element => ({memberId:element.m.id,a:element.m.a,b:element.m.b}));
  const pairs = topology.filter(segment => ids.has(segment.memberId)).flatMap(segment => [segment.a,segment.b]);
  const coordinates = (id: string) => {
    const physical = result.diagnosticGeometry?.positions[id];
    if (physical) return physical;
    const n = ctx?.idx.get(id);
    return n === undefined ? undefined : ctx?.pos[n];
  };
  const valid = (values: readonly number[] | undefined) =>
    !!values && values.length === 6 && values.every(Number.isFinite);
  // The Rust report omits nonparticipating nodes from its sparse mode map.
  // Their zero illustration follows the kernel's documented output semantics.
  const stationary = [0,0,0,0,0,0];
  const segments = pairs.flatMap((id, i) => {
    if (i % 2) return [];
    const other = pairs[i + 1], a = coordinates(id), b = coordinates(other);
    const ua = mode.displacements[id] ?? stationary, ub = mode.displacements[other] ?? stationary;
    return a && b && valid(ua) && valid(ub) ? [{ a, b, ua, ub }] : [];
  });
  let translationPeak = 0;
  for (const values of Object.values(mode.displacements)) {
    if (valid(values)) translationPeak = Math.max(translationPeak, Math.hypot(...values.slice(0, 3)));
  }
  const amplitude = translationPeak > 0 ? 0.8 / translationPeak : 0;
  const positions = new Float32Array(segments.length * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const ghost = new THREE.LineSegments(geometry, new THREE.LineDashedMaterial({color:0xff70c7,
    dashSize:.18, gapSize:.1, transparent:true, opacity:.9, depthTest:false, depthWrite:false}));
  ghost.name = "Solver normalized mode ghost";
  ghost.renderOrder = 4;
  group.add(ghost);
  const rotations: THREE.Line[] = [];
  for (const [id, values] of Object.entries(mode.displacements)) {
    const base = coordinates(id);
    if (!base || !valid(values)) continue;
    const axis = new THREE.Vector3(...values.slice(3, 6) as [number, number, number]);
    if (axis.length() < 1e-8) continue;
    axis.normalize();
    const radial = Math.abs(axis.z) < .8 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0);
    radial.addScaledVector(axis, -radial.dot(axis)).normalize().multiplyScalar(.38);
    const center = new THREE.Vector3(...base as [number, number, number]);
    const points = Array.from({length:25}, (_, n) => radial.clone().applyAxisAngle(axis, n/24*Math.PI*1.65).add(center));
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({color:0xff70c7, depthTest:false, depthWrite:false}));
    arc.name = "Solver rotational mode participation";
    arc.renderOrder = 4;
    group.add(arc);
    rotations.push(arc);
  }
  const update = (time: number) => {
    // Oscillation is bounded and starts at the static positive illustration.
    const phase = playing ? Math.cos(time / 900) : 1;
    segments.forEach(({a,b,ua,ub}, segment) => {
      for (let axis=0; axis<3; axis++) {
        positions[segment*6+axis] = a[axis] + ua[axis]*amplitude*phase;
        positions[segment*6+3+axis] = b[axis] + ub[axis]*amplitude*phase;
      }
    });
    geometry.attributes.position.needsUpdate = true;
    geometry.computeBoundingSphere();
    ghost.computeLineDistances();
    for (const arc of rotations) (arc.material as THREE.LineBasicMaterial).opacity = playing ? .7+.3*Math.abs(phase) : 1;
  };
  update(0);
  group.userData.animateInstability = playing ? update : undefined;
}
