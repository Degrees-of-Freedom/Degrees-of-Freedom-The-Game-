import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type FigureName = "timburr" | "conkeldurr";
export type FigurePose = "nod" | "foreman" | "victory";

/** The attributed models have no skeleton or clips. Author a small, continuous
 * upper-body flex in model coordinates, including eyes and the carried prop,
 * so their original alignment survives the slight nod. Feet stay planted. */
function poseTargets(model: THREE.Group, bounds: THREE.Box3) {
  model.updateWorldMatrix(true, true);
  const height = bounds.max.y - bounds.min.y;
  const pivot = bounds.getCenter(new THREE.Vector3());
  pivot.y = bounds.min.y + .42 * height;
  const axis = new THREE.Vector3(1, 0, 0), p = new THREE.Vector3(), base = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  model.traverse(mesh => {
    if (!(mesh instanceof THREE.Mesh)) return;
    const geometry = mesh.geometry, positions = geometry.getAttribute("position");
    const offset = new Float32Array(positions.count * 3);
    const inverse = mesh.matrixWorld.clone().invert();
    for (let i = 0; i < positions.count; i++) {
      base.fromBufferAttribute(positions, i);
      p.copy(base).applyMatrix4(mesh.matrixWorld);
      const weight = THREE.MathUtils.smoothstep((p.y - bounds.min.y) / height, .35, .85);
      p.sub(pivot).applyAxisAngle(axis, weight * .13).add(pivot).applyMatrix4(inverse).sub(base).toArray(offset, i * 3);
    }
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [new THREE.BufferAttribute(offset, 3)];
    mesh.updateMorphTargets();
    meshes.push(mesh);
  });
  return meshes;
}

function release(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    for (const material of [node.material].flat()) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
    texture.source.data?.close?.();
  }
}

/** The small companion renders an orthographic view of its local GLB.
 * No render loop runs during idle play. A second model is loaded only when
 * requested in the preview, and a superseded asynchronous load is disposed. */
export function createFigure(pixels = 128) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setSize(pixels, pixels, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 30);
  camera.position.set(0, 0.18, 5);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff6e4, 0x9b8499, 2.3));
  const sun = new THREE.DirectionalLight(0xffe1ab, 2.2);
  sun.position.set(2, 3.5, 4);
  scene.add(sun);
  const decoder = new DRACOLoader().setDecoderPath(import.meta.env.BASE_URL + "companion/draco/").setWorkerLimit(1);
  const loader = new GLTFLoader().setDRACOLoader(decoder);
  let displayed: THREE.Object3D | undefined;
  let revision = 0;
  let loading = 0;
  let disposed = false;
  let posable: THREE.Mesh[] = [];
  let frame = 0;
  const draw = () => { if (!disposed) renderer.render(scene, camera); };
  function settle() {
    cancelAnimationFrame(frame);
    if (displayed) displayed.rotation.set(0, 0, 0);
    posable.forEach(mesh => { mesh.morphTargetInfluences![0] = 0; });
    draw();
  }
  function pose(kind: FigurePose, still: boolean) {
    settle();
    if (!displayed || still || document.hidden) return;
    const start = performance.now();
    const duration = kind === "foreman" ? 800 : kind === "victory" ? 1500 : 250;
    function tick(time: number) {
      if (disposed || document.hidden || !displayed) return;
      const t = Math.min(1, (time - start) / duration);
      const bend = Math.sin(Math.PI * t);
      posable.forEach(mesh => { mesh.morphTargetInfluences![0] = bend; });
      displayed.rotation.y = (kind === "foreman" ? -.28 : .15) * bend;
      displayed.rotation.z = (kind === "victory" ? .12 : .018) * bend;
      draw();
      if (t < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }
  async function show(name: FigureName) {
    const load = ++revision;
    loading++;
    let model: THREE.Group;
    try {
      model = (await loader.loadAsync(import.meta.env.BASE_URL + "companion/" + name + ".glb")).scene;
    } finally {
      loading--;
      // Terminating a decoder worker before its promise settles would strand
      // the in-flight load during navigation or tab suspension.
      if (disposed && !loading) decoder.dispose();
    }
    if (disposed || load !== revision) { release(model); return; }
    model.rotation.y -= 0.18;
    const bounds = new THREE.Box3().setFromObject(model, true);
    posable = poseTargets(model, bounds);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 1.85 / Math.max(size.x, size.y, size.z);
    const center = bounds.getCenter(new THREE.Vector3());
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    group.position.copy(center).multiplyScalar(-scale);
    group.add(model);
    if (displayed) { scene.remove(displayed); release(displayed); }
    displayed = group;
    scene.add(group);
    draw();
  }
  return { canvas: renderer.domElement, draw, show, pose, settle, dispose() {
    cancelAnimationFrame(frame);
    disposed = true;
    if (displayed) release(displayed);
    if (!loading) decoder.dispose();
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  } };
}
