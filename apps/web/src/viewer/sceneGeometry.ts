import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL_SIZE, type Level } from '../game/model';
import { terrainCell } from '../game/terrain';
import type { ScenePalette } from './sceneStyle';
export const disposeGroup = (group: THREE.Group) => {
  group.traverse((o) => {
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
    } else if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach((m) => m.dispose());
    }
  });
  group.clear();
};
export type BuildPlane = { axis: 'x' | 'y' | 'z'; value: number };
export function buildTerrain(
  terrain: THREE.Group,
  level: Level,
  camera: THREE.Camera,
  controls: OrbitControls,
  palette: ScenePalette,
) {
  disposeGroup(terrain);
  const size = CELL_SIZE;
  for (let i = 0; i < level.nx; i++)
    for (let j = 0; j < level.ny; j++) {
      const cell = terrainCell(level, i, j)!;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.985, size * 0.985, (cell.h + 1) * size),
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
      terrain.add(mesh);
    }
  const bounds = new THREE.LineSegments(
    new THREE.EdgesGeometry(
      new THREE.BoxGeometry(level.nx * size, level.ny * size, level.nz * size),
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
  controls.target.set((level.nx * size) / 2, (level.ny * size) / 2, 2);
  camera.position.set(
    level.nx * size * palette.offset[0],
    level.ny * size * palette.offset[1],
    level.nz * size * palette.offset[2],
  );
  controls.update();
}
export function buildGuides(
  guides: THREE.Group,
  level: Level,
  plane: BuildPlane,
  palette: ScenePalette,
) {
  const pts: THREE.Vector3[] = [],
    size = CELL_SIZE;
  if (plane.axis === 'z') {
    for (let i = 0; i <= level.nx; i++)
      pts.push(
        new THREE.Vector3(i * size, 0, plane.value * size),
        new THREE.Vector3(i * size, level.ny * size, plane.value * size),
      );
    for (let j = 0; j <= level.ny; j++)
      pts.push(
        new THREE.Vector3(0, j * size, plane.value * size),
        new THREE.Vector3(level.nx * size, j * size, plane.value * size),
      );
  } else if (plane.axis === 'x') {
    for (let j = 0; j <= level.ny; j++)
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
    for (let i = 0; i <= level.nx; i++)
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
        color: plane.axis === 'z' ? palette.grid : 0xd99a47,
        transparent: true,
        opacity: 0.45,
      }),
    ),
  );
}
