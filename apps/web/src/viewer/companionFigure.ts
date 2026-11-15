import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { release, type FigureName } from "../companion/figure";
import { FIGURE_HEIGHT, isletStand } from "./companionIslet";

const stand = new THREE.Vector3();

/**
 * The companion as an object of the board scene: its model stands on the
 * islet, is lit and shadowed with everything else, and turns to face the
 * camera. Because it is drawn in the same frame as the islet it cannot trail
 * behind when the view orbits.
 *
 * Models load once, on first need, from the same local files the menu
 * portrait uses. A character whose file fails to load is never replaced by
 * the other one: `update` then reports that nothing stands on the islet and
 * the page falls back to the companion's HTML figure.
 */
export function createCompanionFigure(scene: THREE.Scene) {
  const holder = new THREE.Group();
  holder.name = "companion-figure";
  holder.visible = false;
  scene.add(holder);
  const decoder = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + "companion/draco/").setWorkerLimit(1);
  const loader = new GLTFLoader().setDRACOLoader(decoder);
  const models = new Map<FigureName, THREE.Group>();
  const pending = new Set<FigureName>(), failed = new Set<FigureName>();
  let shown: THREE.Group | undefined;
  let disposed = false;

  async function load(name: FigureName) {
    if (models.has(name) || pending.has(name) || failed.has(name)) return;
    pending.add(name);
    try {
      const model = (await loader.loadAsync(import.meta.env.BASE_URL + "companion/" + name + ".glb")).scene;
      if (disposed) { release(model); return; }
      // The files are Y-up and face +Z; the board is Z-up, so stand the model
      // up, scale it to the islet and put its feet on the ground at the origin.
      const figure = new THREE.Group();
      figure.rotation.x = Math.PI / 2;
      figure.add(model);
      figure.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(figure, true);
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const scale = FIGURE_HEIGHT / Math.max(size.z, 1e-6);
      figure.scale.setScalar(scale);
      figure.position.set(-center.x * scale, -center.y * scale, -bounds.min.z * scale);
      figure.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true;
        node.frustumCulled = false;
        // The files are authored for a bright portrait stage. Without an
        // environment map their metallic surfaces go dark in the dusk scene,
        // so render them matte and let the colour map glow a little.
        for (const material of [node.material].flat()) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          material.metalness = 0;
          material.roughness = 0.85;
          if (material.map) {
            material.emissiveMap = material.map;
            material.emissive.setScalar(0.32);
          }
          material.needsUpdate = true;
        }
      });
      figure.visible = false;
      models.set(name, figure);
      holder.add(figure);
    } catch {
      failed.add(name);
    } finally {
      pending.delete(name);
      // Terminating the decoder worker mid-load would strand the promise.
      if (disposed && !pending.size) decoder.dispose();
    }
  }

  return {
    /**
     * Stand `name` on the islet of `terrain`, facing `camera`. Returns whether
     * a model is standing there. While a newly requested character is still
     * loading, the one already standing stays.
     */
    update(terrain: THREE.Object3D, camera: THREE.Camera, name: FigureName): boolean {
      if (!isletStand(terrain, stand)) {
        holder.visible = false;
        return false;
      }
      void load(name);
      const next = models.get(name) ?? (pending.has(name) ? shown : undefined);
      if (next !== shown) {
        if (shown) shown.visible = false;
        if (next) next.visible = true;
        shown = next;
      }
      holder.visible = !!shown;
      holder.position.copy(stand);
      // After standing up, the model's front points along -Y.
      holder.rotation.z = Math.atan2(camera.position.y - stand.y, camera.position.x - stand.x) + Math.PI / 2;
      return !!shown;
    },
    dispose() {
      disposed = true;
      scene.remove(holder);
      for (const figure of models.values()) release(figure);
      models.clear();
      if (!pending.size) decoder.dispose();
    },
  };
}
