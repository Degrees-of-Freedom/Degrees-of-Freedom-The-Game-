import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CELL_SIZE, type Level } from "../game/model";
import { terrainCell } from "../game/terrain";
import {
  isGrowthStyle,
  type ScenePalette,
  type SceneStyle,
} from "./sceneStyle";
import { buildDiorama } from "./diorama";
export const disposeGroup = (group: THREE.Group) => {
  group.traverse((o) => {
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    } else if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.Line ||
      o instanceof THREE.Points
    ) {
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach((m) => {
        if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
        m.dispose();
      });
    }
  });
  group.clear();
};
export type BuildPlane = { axis: "x" | "y" | "z"; value: number };
export function buildTerrain(
  terrain: THREE.Group,
  level: Level,
  camera: THREE.Camera,
  controls: OrbitControls,
  palette: ScenePalette,
  style: SceneStyle,
) {
  disposeGroup(terrain);
  const size = CELL_SIZE;
  if (style !== "engineering") buildDiorama(terrain, level, style, palette);
  else {
    for (let i = 0; i < level.nx; i++)
      for (let j = 0; j < level.ny; j++) {
        const cell = terrainCell(level, i, j)!;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(
            size * 0.985,
            size * 0.985,
            (cell.h + 1) * size,
          ),
          new THREE.MeshStandardMaterial({
            color: cell.water ? palette.water : palette.land,
            roughness: 1,
          }),
        );
        mesh.position.set(
          (i + 0.5) * size,
          (j + 0.5) * size,
          ((cell.h - 1) * size) / 2,
        );
        mesh.userData.pickTerrain = true;
        terrain.add(mesh);
      }
    const bounds = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(
          level.nx * size,
          level.ny * size,
          level.nz * size,
        ),
      ),
      new THREE.LineBasicMaterial({
        color: 0x849f91,
        transparent: true,
        opacity: 0.5,
      }),
    );
    bounds.position.set(
      (level.nx * size) / 2,
      (level.ny * size) / 2,
      (level.nz * size) / 2,
    );
    terrain.add(bounds);
  }
  if (level.target) {
    const target = new THREE.Mesh(
      new THREE.PlaneGeometry(level.nx * size, level.ny * size),
      new THREE.MeshBasicMaterial({
        color: 0xe8ba4b,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    target.position.set(
      (level.nx * size) / 2,
      (level.ny * size) / 2,
      level.target * size,
    );
    terrain.add(target);
  }
  const centerZ = style === "engineering" ? 2 : size * 1.35;
  controls.target.set((level.nx * size) / 2, (level.ny * size) / 2, centerZ);
  camera.position.set(
    level.nx * size * palette.offset[0],
    level.ny * size * palette.offset[1],
    style === "engineering"
      ? level.nz * size * palette.offset[2]
      : centerZ + Math.max(level.nx, level.ny) * size * palette.offset[2],
  );
  controls.update();
}
export function buildGuides(
  guides: THREE.Group,
  level: Level,
  plane: BuildPlane,
  palette: ScenePalette,
  style: SceneStyle,
) {
  if (style !== "engineering" && style !== "levels" && style !== "blocks")
    return;
  if (plane.axis === "z" && plane.value === 0 && style !== "engineering")
    return;
  const pts: THREE.Vector3[] = [],
    size = CELL_SIZE;
  if (style === "levels" && plane.axis === "z") {
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(level.nx * size, level.ny * size),
      new THREE.MeshBasicMaterial({
        color: "#9ec3e6",
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    sheet.position.set(
      (level.nx * size) / 2,
      (level.ny * size) / 2,
      plane.value * size,
    );
    guides.add(sheet);
  }
  const stride = style === "blocks" ? 2 : 1;
  if (plane.axis === "z") {
    for (let i = 0; i <= level.nx; i += stride)
      pts.push(
        new THREE.Vector3(i * size, 0, plane.value * size),
        new THREE.Vector3(i * size, level.ny * size, plane.value * size),
      );
    for (let j = 0; j <= level.ny; j += stride)
      pts.push(
        new THREE.Vector3(0, j * size, plane.value * size),
        new THREE.Vector3(level.nx * size, j * size, plane.value * size),
      );
  } else if (plane.axis === "x") {
    for (let j = 0; j <= level.ny; j += stride)
      pts.push(
        new THREE.Vector3(plane.value * size, j * size, 0),
        new THREE.Vector3(plane.value * size, j * size, level.nz * size),
      );
    for (let k = 0; k <= level.nz; k++)
      pts.push(
        new THREE.Vector3(plane.value * size, 0, k * size),
        new THREE.Vector3(plane.value * size, level.ny * size, k * size),
      );
  } else {
    for (let i = 0; i <= level.nx; i += stride)
      pts.push(
        new THREE.Vector3(i * size, plane.value * size, 0),
        new THREE.Vector3(i * size, plane.value * size, level.nz * size),
      );
    for (let k = 0; k <= level.nz; k++)
      pts.push(
        new THREE.Vector3(0, plane.value * size, k * size),
        new THREE.Vector3(level.nx * size, plane.value * size, k * size),
      );
  }
  guides.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: plane.axis === "z" ? palette.grid : 0xd99a47,
        transparent: true,
        opacity: style === "levels" ? 0.27 : 0.45,
      }),
    ),
  );
}
