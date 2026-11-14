import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useGameStore } from '../game/store';
import { CELL_SIZE } from '../game/model';
import { buildGuides, buildTerrain, disposeGroup } from './sceneGeometry';
import { addResultArrows, displayPoint } from './sceneResults';
import { createFlowParticles } from './flowParticles';
import { buildStructure } from './structureMeshes';
import { bindSceneInteraction } from './sceneInteraction';
import { sceneLevel } from './sceneLevel';
import type { SceneView } from './sceneView';
import { createSky, SCENE_STYLES } from './sceneStyle';
import { buildTurnGuides } from './turnGuides';
import { buildGrowthGuides } from './growthGuides';
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
  baySize,
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
    baySize,
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
    baySize,
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
    const sky = createSky();
    scene.add(sky);
    const perspective = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    const orthographic = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 300);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective;
    orthographic.up.set(0, 0, 1);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    const fill = new THREE.HemisphereLight(0xffffff, 0x62604d, 2);
    fill.position.set(0, 0, 1);
    scene.add(fill);
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
    const preview = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x31aa78, depthTest: false }),
    );
    scene.add(preview);
    preview.visible = false;
    const point = (key: string) => displayPoint(key, view.current);
    const particles = createFlowParticles(scene, point);
    let currentEnvironment = '';
    let orthoSpan = 20;
    let previousTurn: number | undefined;
    let cameraSwing = 0;
    const interaction = bindSceneInteraction(
      renderer.domElement,
      () => camera,
      terrain,
      ghost,
      preview,
      point,
      () => view.current,
      rebuild,
    );
    function rebuild() {
      const state = useGameStore.getState();
      const level = sceneLevel(state);
      const palette = SCENE_STYLES[state.style];
      const turnIndex = state.mode === 'multiplayer' ? state.turn?.playerIndex : undefined;
      const environment = [state.mode, state.levelId, state.style].join(':');
      if (currentEnvironment !== environment) {
        currentEnvironment = environment;
        previousTurn = turnIndex;
        cameraSwing = 0;
        camera = state.style === 'levels' ? orthographic : perspective;
        controls.object = camera;
        controls.minPolarAngle = state.style === 'kit' ? 0.92 : 0;
        controls.maxPolarAngle = state.style === 'kit' ? 0.92 : Math.PI * 0.495;
        camera.zoom = 1;
        orthoSpan = Math.max(level.nx, level.ny, level.nz) * CELL_SIZE * 0.86;
        sky.material.uniforms.top.value.set(palette.sky);
        sky.material.uniforms.horizon.value.set(palette.horizon);
        scene.fog = palette.fog ? new THREE.FogExp2(palette.horizon, palette.fog) : null;
        fill.color.set(palette.fill);
        fill.groundColor.set(palette.ground);
        sun.color.set(palette.sun);
        sun.intensity = palette.intensity;
        buildTerrain(terrain, level, camera, controls, palette);
        resize();
      }
      if (state.style === 'kit' && turnIndex !== undefined && previousTurn !== undefined && turnIndex !== previousTurn) {
        cameraSwing = Math.PI;
      }
      previousTurn = turnIndex;
      interaction.clearPreview();
      disposeGroup(structure);
      disposeGroup(guides);
      particles.reset();
      buildStructure(structure, state, view.current, point, particles.add);
      addResultArrows(structure, view.current, point);
      buildGuides(guides, level, interaction.buildPlane(), palette);
      buildGrowthGuides(guides, state, palette);
      buildTurnGuides(guides, state, point);
    }
    refresh.current = rebuild;
    const unsubscribe = useGameStore.subscribe(rebuild);
    const cameraChanged = () => {
      if (useGameStore.getState().chainStart) rebuild();
    };
    controls.addEventListener('end', cameraChanged);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = element;
      if (w && h) {
        if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h;
        else {
          camera.left = -orthoSpan * (w / h);
          camera.right = orthoSpan * (w / h);
          camera.top = orthoSpan;
          camera.bottom = -orthoSpan;
        }
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    rebuild();
    renderer.setAnimationLoop((time: number) => {
      if (cameraSwing > 0.001) {
        const step = cameraSwing * 0.075;
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(camera.up, step);
        camera.position.copy(controls.target).add(offset);
        cameraSwing -= step;
      }
      controls.update();
      particles.tick(time);
      sky.position.copy(camera.position);
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
      sky.geometry.dispose();
      sky.material.dispose();
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
