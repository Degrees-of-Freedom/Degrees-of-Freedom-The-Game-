import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "../game/model";
import { addCompanionIslet, projectIslet } from "./companionIslet";

function scene() {
  const terrain = new THREE.Group();
  addCompanionIslet(terrain, -0.8 * CELL_SIZE, 9 * CELL_SIZE);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 300);
  camera.up.set(0, 0, 1);
  return { terrain, camera };
}

function look(camera: THREE.PerspectiveCamera, from: [number, number, number], at: THREE.Vector3) {
  camera.position.set(...from);
  camera.lookAt(at);
  camera.updateMatrixWorld();
}

describe("companion islet", () => {
  it("stands in the water outside the grid and offers nothing to build on", () => {
    const { terrain } = scene();
    const islet = terrain.getObjectByName("companion-islet")!;
    // Beyond the board's low-X edge, with open water between.
    expect(islet.position.x).toBeLessThan(-2 * CELL_SIZE);
    expect(islet.position.y).toBeGreaterThan(0);
    let meshes = 0;
    islet.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes++;
      expect(object.userData.pickTerrain).toBeUndefined();
    });
    expect(meshes).toBeGreaterThan(5);
  });

  it("reports where the companion stands on screen, sized by distance", () => {
    const { terrain, camera } = scene();
    const islet = terrain.getObjectByName("companion-islet")!;
    look(camera, [islet.position.x + 14, islet.position.y - 14, 10], islet.position);
    const near = projectIslet(terrain, camera, 1280, 720)!;
    // Looking straight at the islet puts it near the middle of the view.
    expect(near.x).toBeGreaterThan(560);
    expect(near.x).toBeLessThan(720);
    expect(near.y).toBeGreaterThan(300);
    expect(near.y).toBeLessThan(420);
    look(camera, [islet.position.x + 42, islet.position.y - 42, 30], islet.position);
    const far = projectIslet(terrain, camera, 1280, 720)!;
    expect(far.size).toBeLessThan(near.size);
    expect(far.size).toBeGreaterThanOrEqual(42);
    // The click target follows the model, which is drawn smaller than the islet is wide.
    expect(near.model).toBeGreaterThan(far.model);
    expect(near.model).toBeLessThan(near.size);
  });

  it("keeps the companion inside the view when the islet is off screen or behind the camera", () => {
    const { terrain, camera } = scene();
    const islet = terrain.getObjectByName("companion-islet")!;
    // The islet far off to the right of the view.
    look(camera, [islet.position.x, islet.position.y - 20, 6], new THREE.Vector3(islet.position.x - 60, islet.position.y, 0));
    const aside = projectIslet(terrain, camera, 1280, 720)!;
    expect(aside.x).toBeLessThanOrEqual(1280 - aside.size * 0.6);
    expect(aside.y).toBeLessThanOrEqual(720 - 150);
    // The camera facing away from it.
    look(camera, [islet.position.x + 10, islet.position.y, 4], new THREE.Vector3(islet.position.x + 40, islet.position.y, 4));
    const behind = projectIslet(terrain, camera, 1280, 720)!;
    expect(behind).toEqual({ x: 42 * 0.6, y: 360, size: 42, model: 30 });
  });

  it("reports nothing for a scene without an islet", () => {
    const { camera } = scene();
    expect(projectIslet(new THREE.Group(), camera, 1280, 720)).toBeNull();
  });
});
