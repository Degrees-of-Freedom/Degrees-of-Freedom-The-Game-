import * as THREE from "three";
import { CELL_SIZE } from "../game/model";

/**
 * The companion's islet: a small pastel diorama in the water beside the board,
 * with a stone quay, a lit cottage and a lantern. It is scenery only. It sits
 * outside the grid and carries no `pickTerrain` flag, so nothing can be placed
 * on it and it never intercepts a snap point.
 *
 * The companion itself stays an HTML control. Each frame `projectIslet` gives
 * the screen position of the standing spot so the control can be drawn there.
 */
const NAME = "companion-islet";
const RADIUS = 0.92 * CELL_SIZE;

const paint = (color: string, emissive?: string) =>
  new THREE.MeshLambertMaterial({ color, ...(emissive && { emissive, emissiveIntensity: 0.9 }) });

function part(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Cylinders are built along Y; the scene is Z-up. */
function upright(geometry: THREE.BufferGeometry) {
  return geometry.rotateX(Math.PI / 2);
}

/**
 * Add the islet to the terrain group, in the water off the board's low-X
 * edge. In the opening view that is the left side of the screen at about
 * mid-height, clear of the view controls in the lower left corner.
 */
export function addCompanionIslet(group: THREE.Group, seaLevel: number, boardDepth: number) {
  const islet = new THREE.Group();
  islet.name = NAME;
  islet.position.set(-3.5 * CELL_SIZE, 0.36 * boardDepth, seaLevel);
  const u = CELL_SIZE;
  const top = 0.3 * u;
  // Quay wall rising out of the water, a sand rim and a grass cap.
  part(islet, upright(new THREE.CylinderGeometry(RADIUS, RADIUS * 1.04, 0.7 * u, 40)), paint("#a9977c"), 0, 0, top - 0.35 * u);
  part(islet, upright(new THREE.CylinderGeometry(RADIUS * 0.97, RADIUS * 0.97, 0.04 * u, 40)), paint("#e3d2ab"), 0, 0, top + 0.02 * u);
  part(islet, upright(new THREE.CylinderGeometry(RADIUS * 0.8, RADIUS * 0.84, 0.05 * u, 40)), paint("#86b780"), 0, 0, top + 0.06 * u);
  const ground = top + 0.085 * u;
  // Cottage: pastel walls, a hipped red roof, a lit window and a door.
  const house = new THREE.Group();
  house.position.set(-0.38 * u, 0.4 * u, ground);
  house.rotation.z = Math.PI / 5;
  part(house, new THREE.BoxGeometry(0.44 * u, 0.36 * u, 0.36 * u), paint("#efc7a2"), 0, 0, 0.18 * u);
  const roof = part(house, upright(new THREE.ConeGeometry(0.37 * u, 0.26 * u, 4)), paint("#cf6257"), 0, 0, 0.49 * u);
  roof.rotation.z = Math.PI / 4;
  roof.scale.set(1.12, 0.92, 1);
  part(house, new THREE.BoxGeometry(0.11 * u, 0.012 * u, 0.12 * u), paint("#ffe39a", "#ffcf6b"), -0.08 * u, -0.184 * u, 0.2 * u);
  part(house, new THREE.BoxGeometry(0.08 * u, 0.012 * u, 0.17 * u), paint("#8a5a44"), 0.1 * u, -0.184 * u, 0.085 * u);
  islet.add(house);
  // Mooring post with a lantern.
  part(islet, upright(new THREE.CylinderGeometry(0.022 * u, 0.028 * u, 0.5 * u, 10)), paint("#5c4735"), 0.55 * u, 0.25 * u, ground + 0.25 * u);
  part(islet, new THREE.SphereGeometry(0.055 * u, 14, 10), paint("#ffdc8f", "#ffc24a"), 0.55 * u, 0.25 * u, ground + 0.55 * u).castShadow = false;
  // Where the companion stands, towards the open water in front of the cottage.
  islet.userData.stand = new THREE.Vector3(0.1 * u, -0.22 * u, ground);
  group.add(islet);
}

export interface IsletView {
  /** Screen position of the companion's feet, in CSS pixels of the view. */
  x: number;
  y: number;
  /** Height in pixels for the companion's figure at the islet's distance. */
  size: number;
}

const foot = new THREE.Vector3(), edge = new THREE.Vector3(), right = new THREE.Vector3();

/**
 * Where the islet's standing spot appears in a view of `width` by `height`.
 * Returns `null` when the scene has no islet. The position is kept inside the
 * view with room for the figure, so the companion stays reachable when the
 * camera turns the islet out of sight.
 */
export function projectIslet(terrain: THREE.Object3D, camera: THREE.Camera, width: number, height: number): IsletView | null {
  const islet = terrain.getObjectByName(NAME);
  const stand = islet?.userData.stand;
  if (!islet || !(stand instanceof THREE.Vector3) || !(width > 0) || !(height > 0)) return null;
  foot.copy(stand).add(islet.position);
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  edge.copy(foot).addScaledVector(right, RADIUS).project(camera);
  foot.project(camera);
  const behind = foot.z > 1 || foot.z < -1;
  const pixels = (Math.abs(edge.x - foot.x) * width) / 2;
  const size = Math.min(104, Math.max(42, behind || !Number.isFinite(pixels) ? 42 : pixels * 1.25));
  // Behind the camera the projection mirrors; park the figure at the left edge instead.
  const x = behind ? 0 : (foot.x * 0.5 + 0.5) * width;
  const y = behind ? height / 2 : (-foot.y * 0.5 + 0.5) * height;
  return {
    x: Math.min(width - size * 0.6, Math.max(size * 0.6, x)),
    y: Math.min(height - 150, Math.max(size + 70, y)),
    size,
  };
}
