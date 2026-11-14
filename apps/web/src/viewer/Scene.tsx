import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useGameStore } from '../game/store';
import { LEVELS } from '../game/levels';
import { allNodeKeys, parseNodeKey, CELL_SIZE } from '../game/model';
import { buildGuides, buildTerrain, disposeGroup } from './sceneGeometry';
import { addResultArrows, displayPoint } from './sceneResults';
import { createFlowParticles } from './flowParticles';
import { buildStructure } from './structureMeshes';
import { bindSceneInteraction } from './sceneInteraction';
import type { SceneView } from './sceneView';
/** Three.js owns only presentation and picking; the game store owns the model and rules. */
export function Scene({
  result,
  combo,
  deformed,
  scale,
  utilization,
  loads,
  loadPath,
  onToggleLoadPath,
  onMessage,
}: SceneView) {
  const view = useRef<SceneView>({
    result,
    combo,
    deformed,
    scale,
    utilization,
    loads,
    loadPath,
    onToggleLoadPath,
    onMessage,
  });
  view.current = {
    result,
    combo,
    deformed,
    scale,
    utilization,
    loads,
    loadPath,
    onToggleLoadPath,
    onMessage,
  };
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    refresh.current();
  }, [result, combo, deformed, scale, utilization, loads, loadPath]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce3dd');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x62604d, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-20, -20, 40);
    scene.add(sun);
    const terrain = new THREE.Group(),
      structure = new THREE.Group(),
      guides = new THREE.Group();
    scene.add(terrain, structure, guides);
    const ghost = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x31aa78, depthTest: false }),
    );
    scene.add(ghost);
    ghost.visible = false;
    const preview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x31aa78, depthTest: false }),
    );
    scene.add(preview);
    preview.visible = false;
    const point = (key: string) => displayPoint(key, view.current);
    const particles = createFlowParticles(scene, point);
    let currentLevel = '';
    let libraryRevision = -1;
    const interaction = bindSceneInteraction(
      renderer.domElement,
      camera,
      terrain,
      ghost,
      preview,
      point,
      () => view.current,
      rebuild,
    );
    function rebuild() {
      const state = useGameStore.getState(),
        level = LEVELS[state.levelId];
      if (currentLevel !== state.levelId) {
        currentLevel = state.levelId;
        buildTerrain(terrain, level, camera, controls);
      }
      if (state.levelId === 'library' && libraryRevision !== state.libraryLoadRevision) {
        libraryRevision = state.libraryLoadRevision;
        const points = allNodeKeys(state.model).map(key => new THREE.Vector3(...parseNodeKey(key)).multiplyScalar(CELL_SIZE));
        if (points.length) {
          const bounds = new THREE.Box3().setFromPoints(points);
          const center = bounds.getCenter(new THREE.Vector3());
          const radius = Math.max(3, bounds.getSize(new THREE.Vector3()).length() / 2);
          const angle = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
          const distance = radius / Math.sin(angle) * 1.2;
          controls.target.copy(center);
          camera.position.copy(center).add(new THREE.Vector3(1, -1.3, .9).normalize().multiplyScalar(distance));
          controls.update();
        }
      }
      disposeGroup(structure);
      disposeGroup(guides);
      particles.reset();
      buildStructure(structure, state, view.current, point, particles.add);
      addResultArrows(structure, view.current, point);
      buildGuides(guides, level, interaction.buildPlane());
    }
    refresh.current = rebuild;
    rebuild();
    const unsubscribe = useGameStore.subscribe(rebuild);
    const cameraChanged = () => {
      if (useGameStore.getState().chainStart) rebuild();
    };
    controls.addEventListener('end', cameraChanged);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = element;
      if (w && h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    renderer.setAnimationLoop((time) => {
      controls.update();
      particles.tick(time);
      renderer.render(scene, camera);
    });
    return () => {
      refresh.current = () => {};
      unsubscribe();
      observer.disconnect();
      renderer.setAnimationLoop(null);
      interaction.dispose();
      controls.removeEventListener('end', cameraChanged);
      controls.dispose();
      [terrain, structure, guides].forEach(disposeGroup);
      particles.dispose();
      ghost.geometry.dispose();
      ghost.material.dispose();
      preview.geometry.dispose();
      preview.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="scene"
      ref={host}
      aria-label="3D workspace. Drag to orbit, scroll to zoom, and click to build."
    />
  );
}
