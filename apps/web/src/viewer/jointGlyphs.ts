import * as THREE from "three";
import type { JointPermission, JointState } from "./jointPermissions";
import { disposeGroup } from "./sceneGeometry";

const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const paints = [0xffa48f, 0xa1e797, 0x9ccfff];
const ivory = 0xffffdb;
function axisLetter(letter: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 50px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(letter, 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, toneMapped: false, depthWrite: false }));
  sprite.scale.setScalar(.35);
  sprite.renderOrder = 3;
  return sprite;
}
type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export interface JointLayer {
  joints: JointPermission[];
  selected?: string;
}

/** Unit-sized compass. Each curved stroke lies in the plane perpendicular
 * to the rotation axis. Shape and text carry state independently of colour. */
function compass(joint: JointPermission, selected: boolean) {
  const marker = new THREE.Group();
  const directions = joint.frame ? joint.frame.map(a => new THREE.Vector3(...a)) : axes;
  const xyz: number[] = [], rgb: number[] = [];
  const color = new THREE.Color();
  function stroke(a: THREE.Vector3, b: THREE.Vector3, paint: number) {
    xyz.push(...a.toArray(), ...b.toArray());
    color.setHex(paint);
    rgb.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  function endMark(at: THREE.Vector3, direction: THREE.Vector3, cross: THREE.Vector3, state: JointState, paint: number) {
    const bar = cross.clone().multiplyScalar(.12);
    const base = at.clone().addScaledVector(direction, state === "free" ? -.18 : 0);
    stroke(base.clone().add(bar), at, paint);
    stroke(at, base.sub(bar), paint);
  }
  for (const [i, axis] of directions.entries()) {
    const u = directions[(i + 1) % 3], v = directions[(i + 2) % 3];
    const paint = paints[i], translate = joint.components[i], rotate = joint.components[i + 3];
    if (selected) {
      const letter = axisLetter(["X", "Y", "Z"][i] + (joint.global?.includes("coupled") ? "′" : ""));
      marker.add(letter);
      letter.position.copy(axis).multiplyScalar(1.14);
    }
    if (translate === "elastic") {
      let previous = axis.clone().multiplyScalar(-.92);
      for (let n = 1; n <= 10; n++) {
        const next = axis.clone().multiplyScalar(-.92 + n * .184).addScaledVector(u, n === 10 ? 0 : n % 2 ? -.11 : .11);
        stroke(previous, next, paint);
        previous = next;
      }
    }
    if (translate === "free" || translate === "locked") {
      const tip = axis.clone().multiplyScalar(.94);
      stroke(tip, tip.clone().negate(), paint);
      for (const sign of [1, -1]) endMark(tip.clone().multiplyScalar(sign), axis.clone().multiplyScalar(sign), u, translate, paint);
    }
    if (rotate === "free" || rotate === "locked" || rotate === "elastic") {
      const center = axis.clone().multiplyScalar(.49);
      const radial = (a: number) => u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
      const point = (a: number, n?: number) => center.clone().addScaledVector(radial(a),
        rotate === "elastic" && n !== undefined ? .34 + (n % 2 ? -.065 : .065) : .34);
      const start = -.75, sweep = Math.PI * 1.35;
      for (let n = 0; n < 20; n++) stroke(point(start + sweep * n / 20, n), point(start + sweep * (n + 1) / 20, n + 1), paint);
      if (rotate === "elastic") continue;
      for (const [angle, sign] of [[start, -1], [start + sweep, 1]]) {
        const tangent = radial(angle + Math.PI / 2).multiplyScalar(sign);
        endMark(point(angle), tangent, radial(angle), rotate, paint);
      }
    }
  }
  const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  if (joint.ground) {
    // Distinct anchored base. The six actual ground components are in the inspector.
    const z = -.43;
    for (const y of [-.44, .44]) stroke(p(-.54,y,z), p(.54,y,z), ivory);
    for (const x of [-.54,-.27,0,.27,.54]) stroke(p(x,-.44,z), p(x,.44,z), ivory);
  }
  if (joint.components.includes("conflict") || joint.components.includes("unavailable")) {
    for (const sign of [-1, 1]) stroke(p(-.36,0,sign*.48), p(.36,0,-sign*.48), ivory);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(xyz, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(rgb, 3));
  const strokes = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, toneMapped: false, depthWrite: false,
  }));
  strokes.renderOrder = 2;
  const backing = new THREE.Mesh(new THREE.CircleGeometry(selected ? 1.35 : 1.02, 40),
    new THREE.MeshBasicMaterial({ color: 0x142738, transparent: true, opacity: .88, depthWrite: false, toneMapped: false }));
  backing.renderOrder = 1;
  marker.add(strokes, backing);
  return { marker, backing };
}

/** Keep symbols a readable CSS-pixel size. Coincident projections keep
 * separate markers and leaders. Layout changes only with a camera/view change. */
export function createJointGlyphs(scene: THREE.Scene) {
  const group = new THREE.Group();
  scene.add(group);
  const entries: (ReturnType<typeof compass> & { leader: THREE.LineSegments; at: THREE.Vector3; selected: boolean })[] = [];
  const lastView = new THREE.Matrix4(), lastProjection = new THREE.Matrix4();
  let lastHeight = -1, dirty = true;
  return {
    set(layer: JointLayer | undefined, locate: (joint: JointPermission) => THREE.Vector3) {
      disposeGroup(group);
      entries.length = 0;
      dirty = true;
      for (const joint of layer?.joints ?? []) {
        const selected = joint.id === layer?.selected;
        const { marker, backing } = compass(joint, selected);
        const line = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0,0,0,0,0,0], 3));
        const leader = new THREE.LineSegments(line, new THREE.LineBasicMaterial({ color: ivory, transparent: true, opacity: .75, toneMapped: false }));
        leader.frustumCulled = false;
        group.add(leader, marker);
        entries.push({ marker, backing, leader, at: locate(joint), selected });
      }
      entries.sort((a, b) => Number(b.selected) - Number(a.selected));
    },
    layout(camera: Camera, width: number, height: number) {
      if (!height || !width || !entries.length) return;
      camera.updateMatrixWorld();
      if (!dirty && lastHeight === height && lastView.equals(camera.matrixWorldInverse) && lastProjection.equals(camera.projectionMatrix)) return;
      dirty = false;
      lastHeight = height;
      lastView.copy(camera.matrixWorldInverse);
      lastProjection.copy(camera.projectionMatrix);
      const occupied = new Map<number, { x: number; y: number; radius: number }[]>();
      const stride = Math.ceil(width / 96) + 3;
      const cell = (x: number, y: number) => Math.floor(y / 96) * stride + Math.floor(x / 96);
      const projection = new THREE.Vector3();
      for (const { marker, backing, leader, at, selected } of entries) {
        projection.copy(at).project(camera);
        marker.visible = Math.abs(projection.x) <= 1 && Math.abs(projection.y) <= 1 && Math.abs(projection.z) <= 1;
        leader.visible = false;
        if (!marker.visible) continue;
        const x = (projection.x + 1) * width / 2, y = (projection.y + 1) * height / 2;
        const radius = selected ? 35 : 20;
        const direction = x > width - 2 * radius - 10 ? -1 : 1;
        const margin = selected ? 1.35 * radius : radius;
        let sx = THREE.MathUtils.clamp(x + direction * (radius + 15), margin, width - margin);
        let sy = THREE.MathUtils.clamp(y + radius * .7, margin, height - margin);
        function overlaps() {
          const k = cell(sx, sy);
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            if (occupied.get(k + i * stride + j)?.some(o => Math.hypot(sx - o.x, sy - o.y) < margin + o.radius)) return true;
          }
          return false;
        }
        // Bound work for very dense edited structures. The identity selector
        // still exposes every joint when there are more glyphs than pixels.
        for (let i = 1; overlaps() && i <= 96; i++) {
          const offset = (radius + 7) * Math.sqrt(i);
          sx = THREE.MathUtils.clamp(x + Math.cos(2.4 * i) * offset, margin, width - margin);
          sy = THREE.MathUtils.clamp(y + Math.sin(2.4 * i) * offset, margin, height - margin);
        }
        const bucket = cell(sx, sy);
        const occupants = occupied.get(bucket) ?? [];
        occupants.push({ x: sx, y: sy, radius: margin });
        occupied.set(bucket, occupants);
        const dx = sx - x, dy = sy - y;
        projection.x += 2 * dx / width;
        projection.y += 2 * dy / height;
        marker.position.copy(projection).unproject(camera);
        backing.quaternion.copy(camera.quaternion);
        const edge = projection.clone();
        edge.y += radius * 2 / height;
        marker.scale.setScalar(edge.unproject(camera).distanceTo(marker.position));
        if (dx || dy) {
          leader.visible = true;
          const ends = leader.geometry.getAttribute("position");
          ends.setXYZ(0, at.x, at.y, at.z);
          ends.setXYZ(1, marker.position.x, marker.position.y, marker.position.z);
          ends.needsUpdate = true;
        }
      }
    },
    dispose() { disposeGroup(group); scene.remove(group); entries.length = 0; },
  };
}
