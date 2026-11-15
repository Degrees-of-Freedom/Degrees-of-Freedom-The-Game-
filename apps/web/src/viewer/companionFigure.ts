import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { poseTargets, release, type FigureName } from "../companion/figure";
import { REST, type Pose } from "../companion/motion";
import { FIGURE_HEIGHT, isletStand } from "./companionIslet";

const stand = new THREE.Vector3();

/** What the islet figure is shown this frame. */
export interface IsletView {
  /** The board companion's sampled pose from `companion/motion.ts`, shared through `companion/boardPose.ts`. */
  pose: Pose;
  /** How much the figure leans toward the viewer: 1 under the pointer, less while its cloud is open. */
  attention: number;
  /** Reduced motion, or effects skipped: the figure stands still. */
  still: boolean;
  /** Frame time in milliseconds. */
  time: number;
}

interface Standing { figure: THREE.Group; posable: THREE.Mesh[] }

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
 *
 * The figure is a second view of the companion control's animation. The
 * control's animator samples the clip library and publishes each pose; this
 * module applies the same six channels to the model about its feet, as
 * `companion/figure.ts` does for the portrait rig, so every scenario clip,
 * idle fidget and Conkeldurr's entrance plays on the islet too. On top of the
 * clip it adds one thing of its own: a small lean toward the viewer under the
 * pointer and while its cloud is open.
 */
export function createCompanionFigure(scene: THREE.Scene) {
  const holder = new THREE.Group();
  holder.name = "companion-figure";
  holder.visible = false;
  scene.add(holder);
  // `act` is what poses move: its origin is the figure's feet on the islet.
  const act = new THREE.Group();
  holder.add(act);
  let decoder: DRACOLoader | undefined;
  const models = new Map<FigureName, Standing>();
  const pending = new Set<FigureName>(), failed = new Set<FigureName>();
  let shown: Standing | undefined;
  let disposed = false;
  let attention = 0, lastTime = 0;

  async function load(name: FigureName) {
    if (models.has(name) || pending.has(name) || failed.has(name)) return;
    pending.add(name);
    try {
      decoder ??= new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + "companion/draco/").setWorkerLimit(1);
      const loader = new GLTFLoader().setDRACOLoader(decoder);
      const model = (await loader.loadAsync(import.meta.env.BASE_URL + "companion/" + name + ".glb")).scene;
      if (disposed) { release(model); return; }
      // The flex is authored in the file's own Y-up frame, before standing up.
      const posable = poseTargets(model, new THREE.Box3().setFromObject(model, true));
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
      models.set(name, { figure, posable });
      act.add(figure);
    } catch {
      failed.add(name);
    } finally {
      pending.delete(name);
      // Decoding is complete: retain the models, not an idle worker. A later
      // character request gets a fresh decoder, since disposal revokes its URL.
      if (!pending.size) { decoder?.dispose(); decoder = undefined; }
    }
  }

  /**
   * Apply a pose about the feet. Channels follow `motion.ts`: lift is a
   * fraction of the figure's height, squash trades height for width, and the
   * angles are mapped onto the standing frame, where the model's front points
   * along -Y toward the viewer: yaw about Z, pitch about X, roll about -Y.
   */
  function apply(view: IsletView) {
    const dt = lastTime ? Math.min(100, view.time - lastTime) : 16;
    lastTime = view.time;
    const want = view.still ? 0 : view.attention;
    attention = view.still ? 0 : attention + (want - attention) * Math.min(1, dt / 160);
    const pose = view.still ? REST : view.pose;
    const stretch = 1 - pose.squash, widen = 1 + pose.squash * 0.5;
    act.position.z = pose.lift * FIGURE_HEIGHT;
    act.scale.set(widen, widen, stretch);
    act.rotation.set(pose.lean + 0.12 * attention, -pose.tilt, pose.turn, "ZXY");
    const bend = pose.bend + 0.5 * attention;
    shown?.posable.forEach((mesh) => { mesh.morphTargetInfluences![0] = bend; });
  }

  return {
    /**
     * Stand `name` on the islet of `terrain`, facing `camera`, posed by
     * `view`. Returns whether the requested model is standing there. Null
     * hides the actor without fetching; a pending model uses the matching
     * HTML fallback rather than showing another character.
     */
    update(terrain: THREE.Object3D, camera: THREE.Camera, name: FigureName | null, view: IsletView): boolean {
      if (disposed || !name || !isletStand(terrain, stand)) {
        holder.visible = false;
        return false;
      }
      void load(name);
      const next = models.get(name);
      if (next !== shown) {
        if (shown) { shown.figure.visible = false; shown.posable.forEach((mesh) => { mesh.morphTargetInfluences![0] = 0; }); }
        if (next) next.figure.visible = true;
        shown = next;
      }
      holder.visible = !!shown;
      holder.position.copy(stand);
      // After standing up, the model's front points along -Y.
      holder.rotation.z = Math.atan2(camera.position.y - stand.y, camera.position.x - stand.x) + Math.PI / 2;
      apply(view);
      return !!shown;
    },
    dispose() {
      disposed = true;
      scene.remove(holder);
      for (const { figure } of models.values()) release(figure);
      models.clear();
      if (!pending.size) { decoder?.dispose(); decoder = undefined; }
    },
  };
}
