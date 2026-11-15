import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REST } from "../companion/motion";
import { addCompanionIslet } from "./companionIslet";
import { createCompanionFigure } from "./companionFigure";

const loads = vi.hoisted(() => ({
  pending: [] as {url: string; resolve: (value: {scene: THREE.Group}) => void}[],
  disposed: vi.fn(),
}));
vi.mock("three/addons/loaders/DRACOLoader.js", () => ({ DRACOLoader: class {
  setDecoderPath() { return this; }
  setWorkerLimit() { return this; }
  dispose() { loads.disposed(); }
} }));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({ GLTFLoader: class {
  setDRACOLoader() { return this; }
  loadAsync(url: string) { return new Promise(resolve => loads.pending.push({url, resolve})); }
} }));

const view = {pose: REST, attention: 0, still: false, time: 100};
function setup() {
  const scene = new THREE.Scene(), terrain = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  addCompanionIslet(terrain, 0, 18);
  scene.add(terrain);
  return {scene, terrain, camera, actor: createCompanionFigure(scene)};
}
function model() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  group.add(mesh);
  return {group, mesh};
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => { loads.pending.length = 0; loads.disposed.mockClear(); });

describe("scene companion ownership", () => {
  it("does not fetch or show an actor without an active companion control", () => {
    const {actor, terrain, camera, scene} = setup();
    expect(actor.update(terrain, camera, null, view)).toBe(false);
    expect(loads.pending).toHaveLength(0);
    expect(scene.getObjectByName("companion-figure")!.visible).toBe(false);
    actor.dispose();
  });

  it("uses only the requested character and hides it immediately for privacy", async () => {
    const {actor, terrain, camera, scene} = setup();
    expect(actor.update(terrain, camera, "timburr", view)).toBe(false);
    loads.pending[0].resolve({scene: model().group});
    await settle();
    expect(actor.update(terrain, camera, "timburr", view)).toBe(true);
    // Evolving never borrows Timburr while the matching Conkeldurr loads.
    expect(actor.update(terrain, camera, "conkeldurr", view)).toBe(false);
    expect(scene.getObjectByName("companion-figure")!.visible).toBe(false);
    loads.pending[1].resolve({scene: model().group});
    await settle();
    expect(actor.update(terrain, camera, "conkeldurr", view)).toBe(true);
    expect(actor.update(terrain, camera, null, view)).toBe(false);
    expect(scene.getObjectByName("companion-figure")!.visible).toBe(false);
    expect(loads.disposed).toHaveBeenCalledTimes(2);
    actor.dispose();
  });

  it("releases a late model after unmount without reattaching or stranding its decoder", async () => {
    const {actor, terrain, camera, scene} = setup();
    actor.update(terrain, camera, "timburr", view);
    actor.dispose();
    const {group, mesh} = model();
    const geometry = vi.spyOn(mesh.geometry, "dispose"), material = vi.spyOn(mesh.material, "dispose");
    loads.pending[0].resolve({scene: group});
    await settle();
    expect(scene.getObjectByName("companion-figure")).toBeUndefined();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(loads.disposed).toHaveBeenCalledOnce();
    expect(actor.update(terrain, camera, "timburr", view)).toBe(false);
    expect(loads.pending).toHaveLength(1);
  });

  it("settles the scene rig in still mode even if the publisher supplies an active clip", async () => {
    const {actor, terrain, camera, scene} = setup();
    actor.update(terrain, camera, "timburr", view);
    loads.pending[0].resolve({scene: model().group});
    await settle();
    const moving = {...view, attention: 1, pose: {...REST, lift: 0.4, squash: 0.2, lean: 0.3, bend: 0.5}};
    actor.update(terrain, camera, "timburr", moving);
    const rig = scene.getObjectByName("companion-figure")!.children[0];
    expect(rig.position.z).toBeGreaterThan(0);
    actor.update(terrain, camera, "timburr", {...moving, still: true});
    expect(rig.position.z).toBe(0);
    expect(rig.scale.toArray()).toEqual([1, 1, 1]);
    expect(rig.rotation.x).toBe(0);
    expect(rig.rotation.z).toBe(0);
    actor.dispose();
  });
});
