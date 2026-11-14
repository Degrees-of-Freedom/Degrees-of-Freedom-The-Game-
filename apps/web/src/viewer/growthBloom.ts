import * as THREE from "three";
import {
  allNodeKeys,
  CELL_SIZE,
  parseNodeKey,
  type GridPoint,
} from "../game/model";
import type { useGameStore } from "../game/store";
import { GROWTH_ROLE_INDEX, growthTargets } from "./growthTargets";
import type { ScenePalette } from "./sceneStyle";

type GameState = ReturnType<typeof useGameStore.getState>;
type Role = "column" | "beam" | "brace";

/** Pointer position in canvas CSS pixels. */
export interface ScenePointer {
  x: number;
  y: number;
  inside: boolean;
}

interface Bead {
  key: string;
  position: THREE.Vector3;
  role: Role;
  /** On one of the 26 axis and 45 degree directions from the start point. */
  principal: boolean;
  /** Reduced direction, shared by every bead on the same line from the start. */
  direction: string;
  /** The point already holds a joint, so placing here closes onto it. */
  existing: boolean;
  delay: number;
  size: number;
  alpha: number;
  distance: number;
  intro: number;
}

interface Spoke {
  direction: string;
  steps: number;
  end: THREE.Vector3;
  role: Role;
  alpha: number;
}

const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const spring = (k: number) =>
  k >= 1 ? 1 : 1 - Math.exp(-7 * k) * Math.cos(11 * k);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Deck height below lattice level zero, matching `buildDiorama` for the growth styles. */
const DECK = -0.28 * CELL_SIZE;

const BEAD_VERTEX = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aKind;
  uniform float uPx;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vKind = aKind;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uPx);
  }
`;

// A new joint draws as a soft bead with a darker rim; an existing joint draws
// as a ring, because placing there closes a loop. Taken from the Grow Dusk prototype.
const BEAD_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    float aa = fwidth(r) * 1.4;
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    vec3 col;
    float a;
    if (vKind < 0.5) {
      float rim = smoothstep(0.58, 0.58 + aa, r);
      col = mix(mix(vColor, vec3(1.0), 0.28), vColor * 0.62, rim);
      a = disc;
    } else {
      float hole = smoothstep(0.60 - aa, 0.60, r);
      float edge = smoothstep(0.80, 0.80 + aa, r);
      col = mix(vec3(1.0), vColor * 0.55, edge);
      a = disc * hole;
    }
    gl_FragColor = vec4(col, a * vAlpha);
    #include <colorspace_fragment>
  }
`;

/**
 * The reachable-point bloom of the Grow Dusk prototype, drawn for the app's own
 * placement rules: the candidates still come from `growthTargets`, so reach,
 * bounds, duplicates and supply are decided by the game rules, not here.
 *
 * Points on the 26 principal directions stay a little more prominent on faint
 * spokes; off-angle points appear only near the pointer, and the chosen target
 * swells. A drop line and deck ring show how high the hovered point is.
 * Presentation only.
 */
export function createGrowthBloom(scene: THREE.Scene) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uPx: { value: 1 } },
    vertexShader: BEAD_VERTEX,
    fragmentShader: BEAD_FRAGMENT,
  });
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false;
  points.renderOrder = 60;
  points.visible = false;
  const spokeLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  spokeLines.frustumCulled = false;
  spokeLines.renderOrder = 55;
  spokeLines.visible = false;

  // Height guide: drop line to the deck, a ring on the deck and a plan line.
  const guide = new THREE.Group();
  const dropGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(0, 0, 1),
  ]);
  const dropLine = new THREE.Line(
    dropGeometry,
    new THREE.LineDashedMaterial({
      color: "#22313f",
      dashSize: 0.09 * CELL_SIZE,
      gapSize: 0.07 * CELL_SIZE,
      transparent: true,
      opacity: 0.6,
      fog: false,
    }),
  );
  const planGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(1, 0, 0),
  ]);
  const planLine = new THREE.Line(
    planGeometry,
    new THREE.LineBasicMaterial({
      color: "#22313f",
      transparent: true,
      opacity: 0.28,
      fog: false,
    }),
  );
  const deckRing = new THREE.Mesh(
    new THREE.RingGeometry(0.1 * CELL_SIZE, 0.16 * CELL_SIZE, 32),
    new THREE.MeshBasicMaterial({
      color: "#22313f",
      transparent: true,
      opacity: 0.55,
      fog: false,
    }),
  );
  guide.add(dropLine, planLine, deckRing);
  guide.visible = false;
  scene.add(points, spokeLines, guide);

  let beads: Bead[] = [];
  let spokes: Spoke[] = [];
  let byKey = new Map<string, Bead>();
  let roleColors: THREE.Color[] = [];
  let source: ReturnType<typeof growthTargets> | null = null;
  let startedAt = 0;
  const origin = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const tip = new THREE.Vector3();

  function clear() {
    beads = [];
    spokes = [];
    byKey = new Map();
    source = null;
    points.visible = spokeLines.visible = false;
  }

  /** Rebuild the bead list when the start point, tool or model changed. */
  function sync(state: GameState, palette: ScenePalette, now: number) {
    const targets = growthTargets(state);
    if (!targets.length || !state.chainStart || !palette.roles) {
      clear();
      return;
    }
    // `growthTargets` caches by (start, tool, model, level, style), so an
    // unchanged list is the same array and the intro does not replay.
    if (targets === source) return;
    source = targets;
    startedAt = now;
    const rolePaints: readonly string[] = palette.roles;
    roleColors = [...rolePaints].map((paint) => new THREE.Color(paint));
    const start = parseNodeKey(state.chainStart);
    origin.set(...start).multiplyScalar(CELL_SIZE);
    const existing = new Set(allNodeKeys(state.model));
    const longest = new Map<string, Spoke>();
    byKey = new Map();
    beads = targets.map((target) => {
      const offset = target.point.map((value, axis) => value - start[axis]);
      const steps = gcd(
        gcd(Math.abs(offset[0]), Math.abs(offset[1])),
        Math.abs(offset[2]),
      );
      const reduced = offset.map((value) => value / Math.max(1, steps));
      const principal = reduced.every((value) => Math.abs(value) <= 1);
      const direction = reduced.join(",");
      const position = new THREE.Vector3(...target.point).multiplyScalar(
        CELL_SIZE,
      );
      const bead: Bead = {
        key: target.key,
        position,
        role: target.role,
        principal,
        direction,
        existing: existing.has(target.key),
        delay: (steps - 1) * 48 + Math.random() * 30,
        size: 0,
        alpha: 0,
        distance: 1,
        intro: 0,
      };
      byKey.set(bead.key, bead);
      const spoke = longest.get(direction);
      if (principal && (!spoke || steps > spoke.steps))
        longest.set(direction, {
          direction,
          steps,
          end: position,
          role: target.role,
          alpha: 0,
        });
      return bead;
    });
    spokes = [...longest.values()];

    points.geometry.dispose();
    const beadGeometry = new THREE.BufferGeometry();
    const dynamic = (size: number, itemSize: number) => {
      const attribute = new THREE.BufferAttribute(
        new Float32Array(size * itemSize),
        itemSize,
      );
      attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    };
    beadGeometry.setAttribute("position", dynamic(beads.length, 3));
    beadGeometry.setAttribute("aColor", dynamic(beads.length, 3));
    beadGeometry.setAttribute("aSize", dynamic(beads.length, 1));
    beadGeometry.setAttribute("aAlpha", dynamic(beads.length, 1));
    beadGeometry.setAttribute("aKind", dynamic(beads.length, 1));
    points.geometry = beadGeometry;

    spokeLines.geometry.dispose();
    const spokeGeometry = new THREE.BufferGeometry();
    spokeGeometry.setAttribute("position", dynamic(spokes.length * 2, 3));
    spokeGeometry.setAttribute("color", dynamic(spokes.length * 2, 4));
    spokeLines.geometry = spokeGeometry;
    points.visible = spokeLines.visible = true;
  }

  /** Ease bead sizes and opacities toward the pointer and the chosen target. */
  function update(
    camera: THREE.Camera,
    width: number,
    height: number,
    pixelRatio: number,
    pointer: ScenePointer,
    targetKey: string | null,
    now: number,
    dt: number,
  ) {
    if (!beads.length) return;
    material.uniforms.uPx.value = pixelRatio;
    const reference = camera.position.distanceTo(origin);
    const blend = 1 - Math.exp(-dt / 70);
    const target = targetKey ? byKey.get(targetKey) : undefined;
    const hotDirection = target?.principal ? target.direction : null;
    for (const bead of beads) {
      bead.distance = Math.max(1e-3, camera.position.distanceTo(bead.position));
      projected.copy(bead.position).project(camera);
      const sx = (projected.x * 0.5 + 0.5) * width;
      const sy = (-projected.y * 0.5 + 0.5) * height;
      const near = clamp(Math.pow(reference / bead.distance, 1.3), 0.6, 1.7);
      const pointerDistance = pointer.inside
        ? Math.hypot(pointer.x - sx, pointer.y - sy)
        : 160;
      const isTarget = bead === target;
      const onSpoke = bead.principal && hotDirection === bead.direction;
      const base = bead.principal
        ? bead.existing
          ? 24
          : 13
        : bead.existing
          ? 17
          : 8.5;
      const wantSize = base * near * (isTarget ? 1.85 : onSpoke ? 1.2 : 1);
      const fade = bead.principal
        ? 0.3 + 0.7 * (1 - smooth(70, 260, pointerDistance))
        : 0.02 + 0.8 * (1 - smooth(22, 150, pointerDistance));
      const wantAlpha = isTarget || onSpoke ? 1 : fade;
      bead.size += (wantSize - bead.size) * blend;
      bead.alpha += (wantAlpha - bead.alpha) * blend;
      const t = (now - startedAt - bead.delay) / 280;
      bead.intro = t <= 0 ? 0 : spring(Math.min(1, t));
    }
    // Far first, so nearer beads draw on top.
    beads.sort((a, b) => b.distance - a.distance);
    const geometry = points.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const color = geometry.getAttribute("aColor") as THREE.BufferAttribute;
    const size = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const alpha = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const kind = geometry.getAttribute("aKind") as THREE.BufferAttribute;
    beads.forEach((bead, index) => {
      position.setXYZ(index, bead.position.x, bead.position.y, bead.position.z);
      const paint = roleColors[GROWTH_ROLE_INDEX[bead.role]];
      color.setXYZ(index, paint.r, paint.g, paint.b);
      size.setX(index, bead.alpha < 0.015 ? 0 : bead.size * bead.intro);
      alpha.setX(index, bead.alpha * Math.min(1, bead.intro * 2));
      kind.setX(index, bead.existing ? 1 : 0);
    });
    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    kind.needsUpdate = true;
    geometry.setDrawRange(0, beads.length);

    const grow = 1 - Math.pow(1 - clamp((now - startedAt) / 260, 0, 1), 3);
    const spokePosition = spokeLines.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const spokeColor = spokeLines.geometry.getAttribute(
      "color",
    ) as THREE.BufferAttribute;
    spokes.forEach((spoke, index) => {
      tip.copy(origin).lerp(spoke.end, grow);
      spokePosition.setXYZ(index * 2, origin.x, origin.y, origin.z);
      spokePosition.setXYZ(index * 2 + 1, tip.x, tip.y, tip.z);
      const want =
        hotDirection === spoke.direction ? 0.85 : target ? 0.14 : 0.3;
      spoke.alpha += (want - spoke.alpha) * blend;
      const paint = roleColors[GROWTH_ROLE_INDEX[spoke.role]];
      spokeColor.setXYZW(
        index * 2,
        paint.r * 0.7,
        paint.g * 0.7,
        paint.b * 0.7,
        spoke.alpha,
      );
      spokeColor.setXYZW(
        index * 2 + 1,
        paint.r * 0.7,
        paint.g * 0.7,
        paint.b * 0.7,
        spoke.alpha * 0.35,
      );
    });
    spokePosition.needsUpdate = true;
    spokeColor.needsUpdate = true;
    spokeLines.geometry.setDrawRange(0, spokes.length * 2);
  }

  /**
   * Show how high lattice point `p` is: a drop line to the deck and a ring on
   * its dot, plus a plan line from `from` when the two differ in plan.
   */
  function setGuide(p: GridPoint | null, from: GridPoint | null) {
    if (!p) {
      guide.visible = false;
      return;
    }
    guide.visible = true;
    const x = p[0] * CELL_SIZE,
      y = p[1] * CELL_SIZE,
      z = p[2] * CELL_SIZE;
    const drop = dropGeometry.getAttribute("position") as THREE.BufferAttribute;
    drop.setXYZ(0, x, y, z);
    drop.setXYZ(1, x, y, DECK + 0.01);
    drop.needsUpdate = true;
    dropLine.computeLineDistances();
    deckRing.position.set(x, y, DECK + 0.012);
    planLine.visible = !!from && (from[0] !== p[0] || from[1] !== p[1]);
    if (from && planLine.visible) {
      const plan = planGeometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      plan.setXYZ(0, from[0] * CELL_SIZE, from[1] * CELL_SIZE, DECK + 0.012);
      plan.setXYZ(1, x, y, DECK + 0.012);
      plan.needsUpdate = true;
    }
  }

  function dispose() {
    scene.remove(points, spokeLines, guide);
    points.geometry.dispose();
    material.dispose();
    spokeLines.geometry.dispose();
    spokeLines.material.dispose();
    dropGeometry.dispose();
    dropLine.material.dispose();
    planGeometry.dispose();
    planLine.material.dispose();
    deckRing.geometry.dispose();
    deckRing.material.dispose();
  }

  return { sync, update, setGuide, dispose };
}
