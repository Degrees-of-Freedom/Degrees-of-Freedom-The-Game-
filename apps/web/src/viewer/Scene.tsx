import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useGameStore } from "../game/store";
import {
  allNodeKeys,
  CELL_SIZE,
  nodeKey,
  parseNodeKey,
  type LoadDirection,
  type Restraint,
} from "../game/model";
import { getSettings } from "../menu/settings";
import { buildGuides, buildTerrain, disposeGroup } from "./sceneGeometry";
import { addResultArrows, displayPoint, viewBasePoint } from "./sceneResults";
import { addSceneLabel } from "./sceneLabels";
import { buildDisplacementShadow, labelPeakDisplacement } from "./displacementShadow";
import { projectIslet } from "./companionIslet";
import { createCompanionFigure } from "./companionFigure";
import { boardPose } from "../companion/boardPose";
import { createFlowParticles } from "./flowParticles";
import { buildReleaseFlow, markInstability } from "./releaseFlow";
import { drawInstabilityMode } from "./instabilityModes";
import { drawBoardDiagram } from "./boardDiagrams";
import { buildStructure } from "./structureMeshes";
import { bindSceneInteraction } from "./sceneInteraction";
import { selectedTurnCard } from "./turnPicking";
import { poseSection, wideFlangeGeometry } from "./sectionGeometry";
import { assemblyGeometry } from "./assemblyGeometry";
import { springGeometry } from "./springGeometry";
import { sceneLevel } from "./sceneLevel";
import type { SceneHover, SceneView } from "./sceneView";
import { createSky, isGrowthStyle, SCENE_STYLES } from "./sceneStyle";
import { buildTurnGuides } from "./turnGuides";
import { createGrowthBloom, type ScenePointer } from "./growthBloom";
import { createDofGizmo, DOF_AXIS_COLORS } from "./dofGizmo";
import { visualLoadDirection } from "./scenePieces";

const FREE: Restraint = [false, false, false, false, false, false];
const FIXED: Restraint = [true, true, true, true, true, true];
const ROLE_INDEX = { column: 0, beam: 1, brace: 2 } as const;
const trimLength = (value: number) =>
  (Math.round(value * 100) / 100).toString();
import { createJointGlyphs } from "./jointGlyphs";
/** Three.js owns only presentation and picking; the game store owns the model and rules. */
export function Scene({
  diagrams,
  cameraMemory,
  still,
  trueScale,
  showInstability,
  instabilityMode,
  playInstability,
  reactionLabels,
  jointLayer,
  field, reference,
  result,
  combo,
  deformed,
  scale,
  utilization,
  loads,
  loadPath,
  onToggleLoadPath,
  shadow,
  labels,
  onMessage,
  baySize,
}: SceneView) {
  const view = useRef<SceneView>({
    diagrams,
    cameraMemory,
    still,
    trueScale,
    showInstability,
    instabilityMode,
    playInstability,
    reactionLabels,
    jointLayer,
    field, reference,
    result,
    combo,
    deformed,
    scale,
    utilization,
    loads,
    loadPath,
    onToggleLoadPath,
    shadow,
    labels,
    onMessage,
    baySize,
  });
  view.current = {
    diagrams,
    cameraMemory,
    still,
    trueScale,
    showInstability,
    instabilityMode,
    playInstability,
    reactionLabels,
    jointLayer,
    field, reference,
    result,
    combo,
    deformed,
    scale,
    utilization,
    loads,
    loadPath,
    onToggleLoadPath,
    shadow,
    labels,
    onMessage,
    baySize,
  };
  const refresh = useRef<() => void>(() => {});
  const [gpuLost, setGpuLost] = useState(false);
  const refreshPermissions = useRef<() => void>(() => {});
  useEffect(() => {
    refreshPermissions.current();
  }, [jointLayer, result, combo, deformed, scale, field, labels]);
  useEffect(() => {
    refresh.current();
  }, [result, combo, deformed, scale, field, reference, utilization, loads, loadPath, trueScale, showInstability,
    instabilityMode, playInstability, reactionLabels, diagrams, shadow, labels, still]);
  const workK = useGameStore((state) => state.workK);
  const style = useGameStore((state) => state.style);
  const host = useRef<HTMLDivElement>(null);
  const axisHost = useRef<SVGSVGElement>(null);
  const labelHost = useRef<HTMLDivElement>(null);
  const cameraActions = useRef({
    fit: () => {},
    focus: () => {},
    orbit: (_step: number) => {},
    pitch: (_step: number) => {},
    tilt: () => {},
  });
  // OrbitControls removes key listeners from the canvas's root. Dispose it
  // while the canvas is still attached to the same document it registered on.
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    const sky = createSky();
    scene.add(sky);
    const perspective = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    const orthographic = new THREE.OrthographicCamera(
      -20,
      20,
      20,
      -20,
      0.1,
      300,
    );
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
      perspective;
    orthographic.up.set(0, 0, 1);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const lose = (e: Event) => { e.preventDefault(); setGpuLost(true); };
    renderer.domElement.addEventListener("webglcontextlost", lose);
    // The joint gizmo is drawn as a second pass over the structure, so clearing is explicit.
    renderer.autoClear = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
    scene.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.bias = -0.00022;
    sun.shadow.normalBias = 0.065;
    sun.shadow.radius = 4;
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
    const ordinaryGhost = new THREE.CapsuleGeometry(0.055 * CELL_SIZE, 1, 6, 12);
    const profileGhosts = { ipe: wideFlangeGeometry("ipe"), heb: wideFlangeGeometry("heb") };
    let assemblyGhost: THREE.BufferGeometry | undefined;
    let lastGhostLine: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    const stickGhost = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>(
      ordinaryGhost,
      new THREE.MeshLambertMaterial({
        color: "#31aa78",
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    const ghostStart = new THREE.Vector3(),
      ghostEnd = new THREE.Vector3(),
      ghostDelta = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    stickGhost.visible = false;
    stickGhost.renderOrder = 24;
    scene.add(preview, stickGhost);
    preview.visible = false;
    const point = (key: string) => displayPoint(key, view.current);
    const glyphs = createJointGlyphs(scene);
    refreshPermissions.current = () => {
      const layer = view.current.jointLayer;
      glyphs.set(layer ? {...layer,labels:layer.labels !== false && view.current.labels !== false} : undefined,
        joint => point(view.current.result?.ctx?.idx.has(joint.id) ? joint.id : joint.point));
    };
    refreshPermissions.current();
    const particles = createFlowParticles(scene, point);
    let currentEnvironment = "";
    let orthoSpan = 20;
    let previousTurn: number | undefined;
    let cameraSwing = 0;
    let aspectCompensation = 1;
    let kitHigh = false;
    // Growth-style overlays: the reachable-point bloom, the selected joint's
    // six-DOF gizmo, and the pointer state they follow.
    const bloom = createGrowthBloom(scene);
    const gizmo = createDofGizmo();
    const pointer: ScenePointer = { x: -9999, y: -9999, inside: false };
    let hover: SceneHover | null = null;
    let lastFrame = 0;
    let lengthLabelKey = "";
    const projected = new THREE.Vector3();
    const prefersStill =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const trackPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.inside = true;
    };
    const releasePointer = () => {
      pointer.inside = false;
    };
    renderer.domElement.addEventListener("pointermove", trackPointer);
    renderer.domElement.addEventListener("pointerdown", trackPointer);
    renderer.domElement.addEventListener("pointerleave", releasePointer);
    /**
     * Tell the page where the companion's islet is on screen. The companion is
     * an HTML control outside this component, so the position is published as
     * CSS variables on the workspace element and the stylesheet does the rest.
     */
    // The Workspace wraps the view in `.environment`; the Shared table match board in `.release-stage`.
    const workspace = element.closest<HTMLElement>(".environment, .release-stage");
    const companionFigure = createCompanionFigure(scene);
    let isletKey = "";
    function anchorCompanion(time: number) {
      if (!workspace) return;
      const canvas = renderer.domElement;
      // The companion control marks itself while the foreman is on stage and
      // while its cloud is open; its animator publishes the pose to stand in.
      const control = workspace.querySelector<HTMLElement>(".companion-board");
      const character = control?.dataset.character;
      const at = projectIslet(terrain, camera, canvas.clientWidth, canvas.clientHeight);
      const name = at?.visible && (character === "timburr" || character === "conkeldurr") ? character : null;
      const figure = control?.querySelector<HTMLElement>(".companion-figure");
      const standing = companionFigure.update(terrain, camera, name, {
        pose: boardPose().pose,
        attention: figure?.matches(":hover") ? 1 : figure?.getAttribute("aria-expanded") === "true" ? 0.45 : 0,
        still: !!(prefersStill || getSettings().reducedMotion || view.current.still),
        time,
      });
      if ((standing ? name : undefined) !== workspace.dataset.isletFigure) {
        if (standing && name) workspace.dataset.isletFigure = name;
        else delete workspace.dataset.isletFigure;
      }
      const beside = !!at && at.y < canvas.clientHeight * 0.45;
      const key = at ? [Math.round(at.x), Math.round(at.y), Math.round(at.size), Math.round(at.model), at.x > canvas.clientWidth - 330, beside].join(",") : "";
      if (key === isletKey) return;
      isletKey = key;
      if (!at) {
        delete workspace.dataset.islet;
        delete workspace.dataset.isletCloud;
        return;
      }
      // The speech cloud opens towards the side with more room, and beside the
      // figure rather than above it while the islet is in the upper part of the view.
      workspace.dataset.islet = at.x > canvas.clientWidth - 330 ? "left" : "right";
      workspace.dataset.isletCloud = beside ? "beside" : "above";
      workspace.style.setProperty("--islet-x", Math.round(at.x) + "px");
      workspace.style.setProperty("--islet-y", Math.round(at.y) + "px");
      workspace.style.setProperty("--islet-size", Math.round(at.size) + "px");
      workspace.style.setProperty("--islet-model", Math.round(at.model) + "px");
    }
    function draw() {
      renderer.clear();
      renderer.render(scene, camera);
      if (gizmo.visible) {
        renderer.clearDepth();
        renderer.render(gizmo.overlay, camera);
      }
    }
    const interaction = bindSceneInteraction(
      renderer.domElement,
      () => camera,
      terrain,
      ghost,
      preview,
      point,
      () => view.current,
      rebuild,
      () => cameraActions.current,
      (next) => {
        hover = next;
      },
    );
    function rebuild() {
      const state = useGameStore.getState();
      const level = sceneLevel(state);
      const palette = SCENE_STYLES[state.style];
      const turnIndex =
        state.mode === "multiplayer" ? state.turn?.playerIndex : undefined;
      const environment = [state.mode, state.levelId, state.style].join(":");
      if (currentEnvironment !== environment) {
        currentEnvironment = environment;
        previousTurn = turnIndex;
        cameraSwing = 0;
        camera = state.style === "levels" ? orthographic : perspective;
        controls.object = camera;
        // Growth styles use the prototype's lens and limits: a 30 degree
        // field of view, kept above the quay and within a sensible zoom range.
        const growthView = isGrowthStyle(state.style);
        perspective.fov = growthView ? 30 : 42;
        controls.minPolarAngle =
          state.style === "kit" ? (kitHigh ? 0.84 : 1.25) : growthView ? 0.15 : 0;
        controls.maxPolarAngle =
          state.style === "kit"
            ? kitHigh
              ? 0.84
              : 1.25
            : growthView
              ? Math.PI / 2 - 0.07
              : Math.PI * 0.495;
        controls.minDistance = growthView ? 5 * CELL_SIZE : 0;
        // The far limit scales with the board so large levels still fit.
        controls.maxDistance = growthView
          ? 8 * Math.max(level.nx, level.ny, level.nz) * CELL_SIZE
          : Infinity;
        camera.zoom = 1;
        orthoSpan = Math.max(level.nx, level.ny, level.nz) * CELL_SIZE * 0.86;
        sky.material.uniforms.top.value.set(palette.sky);
        sky.material.uniforms.horizon.value.set(palette.horizon);
        const isDusk = state.style === "grow-dusk" || state.style === "kit";
        sky.material.uniforms.mid.value.set(
          isDusk
            ? "#7f8fa6"
            : state.style === "blocks"
              ? "#f7d9c4"
              : palette.horizon,
        );
        sky.material.uniforms.band.value.set(
          ...(isDusk
            ? ([0, 0.113, 0.087, 0.259] as const)
            : state.style === "blocks"
              ? ([0, 0.024, 0.012, 0.11] as const)
              : ([0, 0.06, -0.04, 0.42] as const)),
        );
        scene.fog = palette.fog
          ? new THREE.FogExp2(palette.horizon, palette.fog)
          : null;
        fill.color.set(palette.fill);
        fill.groundColor.set(palette.ground);
        sun.color.set(palette.sun);
        sun.intensity = palette.intensity;
        aspectCompensation = 1;
        buildTerrain(terrain, level, camera, controls, palette, state.style);
        if (state.style === "kit") {
          const offset = camera.position.clone().sub(controls.target).multiplyScalar(0.8);
          camera.position.copy(controls.target).add(offset);
          controls.update();
        }
        sun.castShadow = state.style !== "engineering";
        const span = Math.max(level.nx, level.ny) * CELL_SIZE * 0.86;
        sun.target.position.set(
          (level.nx * CELL_SIZE) / 2,
          (level.ny * CELL_SIZE) / 2,
          0,
        );
        sun.position
          .copy(sun.target.position)
          .add(new THREE.Vector3(-span, -span * 0.52, span * 1.24));
        Object.assign(sun.shadow.camera, {
          left: -span,
          right: span,
          top: span,
          bottom: -span,
          near: 0.3,
          far: span * 5,
        });
        sun.shadow.camera.updateProjectionMatrix();
        orthoSpan = span * 0.72;
        resize();
      }
      if (
        state.style === "kit" &&
        turnIndex !== undefined &&
        previousTurn !== undefined &&
        turnIndex !== previousTurn
      ) {
        cameraSwing = Math.PI;
      }
      previousTurn = turnIndex;
      interaction.clearPreview();
      disposeGroup(structure);
      delete structure.userData.animateInstability;
      disposeGroup(guides);
      particles.reset();
      const releaseFlow = !!view.current.cameraMemory && view.current.loadPath;
      buildStructure(structure, state, releaseFlow ? { ...view.current, loadPath: false } : view.current, point, particles.add);
      // Ownership remains visible independently of optional result-value labels.
      if (view.current.cameraMemory && state.turn) {
        for (const joint of state.turn.board.joints) {
          const owner = state.turn.players.findIndex(player => player.id === joint.foundationOwner);
          if (owner < 0) continue;
          addSceneLabel(structure, point(joint.id).add(new THREE.Vector3(0, 0, -0.25)),
            `Player ${owner + 1} · ${owner === 0 ? "Coral" : "Blue"}`, owner === 0 ? "player1" : "player2", .8);
        }
      }
      // Optional view-mode labels default to shown; reaction size/off remains
      // an independent release preference inside addResultArrows.
      const labels = view.current.labels !== false;
      if (releaseFlow && view.current.result) buildReleaseFlow(structure, view.current.result, point, particles.add, labels);
      for (const diagram of view.current.diagrams ?? []) {
        drawBoardDiagram(structure, diagram, point, view.current.deformed ? view.current.field : undefined, view.current.scale, labels);
      }
      const field = view.current.field;
      if (view.current.shadow && field) {
        structure.add(buildDisplacementShadow(field, view.current.scale, key => viewBasePoint(key, view.current), view.current.trueScale));
      }
      if (labels && field && (view.current.shadow || view.current.deformed)) labelPeakDisplacement(structure, field, view.current.scale);
      if (view.current.showInstability && view.current.result) {
        markInstability(structure, view.current.result, point, labels);
        drawInstabilityMode(structure, view.current.result, view.current.instabilityMode ?? 0,
          !!view.current.playInstability && !view.current.still && !getSettings().reducedMotion);
      }
      addResultArrows(structure, view.current, point, state.style !== 'engineering' && labels);
      buildGuides(
        guides,
        level,
        interaction.buildPlane(),
        palette,
        state.style,
      );
      bloom.sync(state, palette, performance.now());
      buildTurnGuides(guides, state, point);
      // Publish the new environment even while background tabs throttle animation frames.
      sky.position.copy(camera.position);
      draw();
    }
    refresh.current = rebuild;
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      rebuild();
      if (state.libraryLoadRevision !== previous.libraryLoadRevision)
        cameraActions.current.fit();
    });
    const cameraChanged = () => {
      if (useGameStore.getState().chainStart) rebuild();
    };
    controls.addEventListener("end", cameraChanged);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = element;
      if (w && h) {
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.aspect = w / h;
          const next = Math.max(1, 0.92 / camera.aspect);
          const offset = camera.position.clone().sub(controls.target).multiplyScalar(next / aspectCompensation);
          camera.position.copy(controls.target).add(offset);
          aspectCompensation = next;
          controls.update();
        }
        else {
          const span = orthoSpan * Math.max(1, 0.92 / (w / h));
          camera.left = -span * (w / h);
          camera.right = span * (w / h);
          camera.top = span;
          camera.bottom = -span;
        }
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    cameraActions.current = {
      focus() {
        const state = useGameStore.getState();
        const sel = state.selected;
        if (!sel) return;
        const member = sel.type === "member" && state.model.members.find(m => m.id === sel.id);
        const next = sel.type === "node" ? point(sel.key) : member ? point(member.a).lerp(point(member.b), .5) : null;
        if (!next) return;
        camera.position.add(next.clone().sub(controls.target));
        controls.target.copy(next);
        controls.update();
      },
      fit() {
        currentEnvironment = "";
        rebuild();
        const state = useGameStore.getState();
        const points = allNodeKeys(state.model).map(point);
        if (!points.length || (state.mode === "multiplayer" && !view.current.cameraMemory)) return;
        const bounds = new THREE.Box3().setFromPoints(points);
        const focus = bounds.getCenter(new THREE.Vector3());
        const radius = Math.max(
          CELL_SIZE * 2.5,
          bounds.getSize(new THREE.Vector3()).length() * 0.65,
        );
        const offset = camera.position.clone().sub(controls.target).normalize();
        controls.target.copy(focus);
        if (camera instanceof THREE.PerspectiveCamera) {
          const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
          const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
          camera.position
            .copy(focus)
            .addScaledVector(
              offset,
              radius / Math.sin(Math.min(vertical, horizontal)),
            );
        } else {
          orthoSpan =
            radius /
            Math.min(
              1,
              element.clientWidth / Math.max(1, element.clientHeight),
            );
          camera.position
            .copy(focus)
            .addScaledVector(offset, Math.max(10, radius * 2));
          resize();
        }
        controls.update();
      },
      tilt() {
        kitHigh = !kitHigh;
        const angle = kitHigh ? 0.84 : 1.25;
        controls.minPolarAngle = controls.maxPolarAngle = angle;
        controls.update();
      },
      orbit(step) {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(camera.up, (step * Math.PI) / 2);
        camera.position.copy(controls.target).add(offset);
        controls.update();
        rebuild();
      },
      pitch(step) {
        const offset = camera.position.clone().sub(controls.target);
        const horizontal = Math.hypot(offset.x, offset.y);
        const radius = offset.length();
        if (!horizontal || !radius) return;
        const angle = Math.max(0.1, Math.min(1.4, Math.atan2(offset.z, horizontal) + step * Math.PI / 12));
        const ratio = radius * Math.cos(angle) / horizontal;
        offset.set(offset.x * ratio, offset.y * ratio, radius * Math.sin(angle));
        camera.position.copy(controls.target).add(offset);
        controls.update();
        rebuild();
      },
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    rebuild();
    const initial = useGameStore.getState().turn;
    const memory = view.current.cameraMemory;
    if (memory && initial) {
      if (memory.pose?.seed === initial.seed) {
        camera.position.fromArray(memory.pose.eye);
        controls.target.fromArray(memory.pose.target);
        controls.update();
      } else cameraActions.current.fit();
    }
    renderer.setAnimationLoop((time: number) => {
      if (document.hidden) return;
      if (cameraSwing > 0.001) {
        const step = cameraSwing * 0.075;
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(camera.up, step);
        camera.position.copy(controls.target).add(offset);
        cameraSwing -= step;
      }
      controls.update();
      particles.tick(time, prefersStill || getSettings().reducedMotion || view.current.still);
      structure.userData.animateInstability?.(time);
      const state = useGameStore.getState();
      const line = preview.geometry.getAttribute("position");
      stickGhost.visible =
        preview.visible &&
        !!line &&
        state.style !== "engineering" &&
        (ghost.visible || state.tool === "brace");
      if (stickGhost.visible) {
        const card = selectedTurnCard(state);
        const type = card?.kind === "element" ? card.type : state.tool;
        const assembly = card?.kind === "element" && card.assembly;
        const physicalGhost = !!assembly || type === "spring";
        if (physicalGhost && (lastGhostLine !== line || stickGhost.geometry !== assemblyGhost)) {
          const key = (i: number) => new THREE.Vector3().fromBufferAttribute(line, i).divideScalar(CELL_SIZE).toArray().join(",");
          assemblyGhost?.dispose();
          assemblyGhost = assembly ? assemblyGeometry({ id: 0, a: key(0), b: key(1), type: "shs", assembly })
            : springGeometry({a: key(0), b: key(1)}, 1.8);
        }
        const geometry = physicalGhost && assemblyGhost ? assemblyGhost :
          type === "ipe" || type === "heb" ? profileGhosts[type] : ordinaryGhost;
        if (lastGhostLine !== line || stickGhost.geometry !== geometry) {
          lastGhostLine = line;
          stickGhost.geometry = geometry;
          ghostStart.fromBufferAttribute(line, 0);
          ghostEnd.fromBufferAttribute(line, 1);
          ghostDelta.subVectors(ghostEnd, ghostStart);
          if (physicalGhost) {
            stickGhost.scale.setScalar(1);
            stickGhost.position.set(0,0,0);
            stickGhost.quaternion.identity();
          } else if (geometry === ordinaryGhost) {
            stickGhost.scale.set(1, Math.max(0.001, ghostDelta.length() / (1 + 0.11 * CELL_SIZE)), 1);
            stickGhost.position.copy(ghostStart).lerp(ghostEnd, 0.5);
            stickGhost.quaternion.setFromUnitVectors(up, ghostDelta.normalize());
          } else {
            poseSection(stickGhost, ghostStart, ghostEnd, ghostDelta);
          }
        }
        stickGhost.material.color.copy(preview.material.color);
      }
      for (const object of terrain.children) object.userData.animate?.(time);
      for (const guide of guides.children) {
        if (typeof guide.userData.growFrom !== "number") continue;
        const progress = THREE.MathUtils.clamp(
          (performance.now() - guide.userData.growFrom) / 155,
          0,
          1,
        );
        guide.scale.setScalar(1 - 0.35 * (1 - progress) ** 3);
      }
      if (axisHost.current) {
        const toCamera = camera.quaternion.clone().invert();
        for (let axis = 0; axis < 3; axis++) {
          const p = new THREE.Vector3().setComponent(axis, 1).applyQuaternion(toCamera);
          // Growth styles draw the prototype's disc with a lettered ball per axis.
          const ball = axisHost.current.querySelector('circle[data-axis="' + axis + '"]');
          const reach = ball ? 25 : 21;
          const x = p.x * reach, y = -p.y * reach;
          const line = axisHost.current.querySelector('line[data-axis="' + axis + '"]');
          const label = axisHost.current.querySelector('text[data-axis="' + axis + '"]');
          line?.setAttribute("x2", String(x));
          line?.setAttribute("y2", String(y));
          ball?.setAttribute("cx", String(x));
          ball?.setAttribute("cy", String(y));
          label?.setAttribute("x", String(ball ? x : x * 1.33));
          label?.setAttribute("y", String(ball ? y : y * 1.33));
        }
      }
      sky.position.copy(camera.position);
      sky.material.uniforms.rimDip.value =
        state.style === "grow-dusk" || state.style === "kit"
          ? Math.atan2(Math.max(0, camera.position.z + CELL_SIZE), 145)
          : 0;
      updateGrowthOverlays(state, time);
      // Joint glyphs keep a constant on-screen size and avoid each other, so
      // they are positioned against the current camera before each draw.
      glyphs.layout(camera, element.clientWidth, element.clientHeight);
      anchorCompanion(time);
      draw();
    });
    /**
     * Per-frame presentation for the growth styles, following the Grow Dusk
     * prototype: bloom, height guide, hover / armed / selected rings, the
     * length label, the joint gizmo with its card, and the load pad arrows.
     * It reads the store and writes only to the scene and to overlay elements.
     */
    function updateGrowthOverlays(
      state: ReturnType<typeof useGameStore.getState>,
      time: number,
    ) {
      const dt = Math.min(250, Math.max(0, time - lastFrame));
      lastFrame = time;
      const growth = isGrowthStyle(state.style);
      // Shared table keeps its own card-driven picking and ghost.
      const solo = growth && state.mode !== "multiplayer";
      const width = renderer.domElement.clientWidth,
        height = renderer.domElement.clientHeight;
      const toScreen = (position: THREE.Vector3) => {
        projected.copy(position).project(camera);
        return {
          x: (projected.x * 0.5 + 0.5) * width,
          y: (-projected.y * 0.5 + 0.5) * height,
          ok: projected.z > -1 && projected.z < 1,
        };
      };
      const labels = labelHost.current;
      const place = (id: string, position: THREE.Vector3 | null) => {
        const ring = labels?.querySelector<HTMLElement>("#" + id);
        if (!ring) return;
        const at = position ? toScreen(position) : null;
        ring.classList.toggle("show", !!at?.ok);
        if (at)
          ring.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
      };
      // Rings replace the plain hover sphere in the growth styles.
      ghost.material.visible = !solo;
      const chainPoint =
        solo && state.chainStart ? parseNodeKey(state.chainStart) : null;
      const hovered = solo && pointer.inside ? hover : null;
      const target = chainPoint && hovered?.role ? hovered : null;
      bloom.update(
        camera,
        width,
        height,
        renderer.getPixelRatio(),
        pointer,
        target ? nodeKey(...target.p) : null,
        time,
        dt,
      );
      bloom.setGuide(hovered ? hovered.p : null, target ? chainPoint : null);
      place(
        "rhover",
        hovered && !target
          ? new THREE.Vector3(...hovered.p).multiplyScalar(CELL_SIZE)
          : null,
      );
      place("rarmed", solo && state.chainStart ? point(state.chainStart) : null);
      const selectedKey =
        solo && state.selected?.type === "node" ? state.selected.key : null;
      place("rsel", selectedKey ? point(selectedKey) : null);

      // Length, role and coordinates of the member about to be placed.
      const lengthLabel = labels?.querySelector<HTMLElement>("#growth-length");
      if (lengthLabel) {
        const role = target?.role ?? null;
        if (target && role && chainPoint && stickGhost.visible) {
          const at = toScreen(
            new THREE.Vector3(...target.p).multiplyScalar(CELL_SIZE),
          );
          const key = [state.chainStart, target.p.join(","), target.stack].join(
            "|",
          );
          if (key !== lengthLabelKey) {
            lengthLabelKey = key;
            const length =
              Math.hypot(
                target.p[0] - chainPoint[0],
                target.p[1] - chainPoint[1],
                target.p[2] - chainPoint[2],
              ) * CELL_SIZE;
            const roles: readonly string[] | null =
              SCENE_STYLES[state.style].roles;
            const joins = allNodeKeys(state.model).includes(
              nodeKey(...target.p),
            );
            const lengthText = lengthLabel.querySelector("span");
            const dot = lengthLabel.querySelector<HTMLElement>("i");
            const detail = lengthLabel.querySelector("small");
            if (lengthText) lengthText.textContent = trimLength(length) + " m";
            if (dot) dot.style.background = roles ? roles[ROLE_INDEX[role]] : "";
            if (detail)
              detail.textContent =
                `${role} · [${target.p.join(", ")}]` +
                (joins ? " · joins a joint" : "") +
                (target.stack ? ` · ${target.stack} (wheel or [ ])` : "");
          }
          lengthLabel.style.display = at.ok ? "" : "none";
          lengthLabel.style.transform = `translate(${Math.round(at.x + 20)}px, ${Math.round(at.y - 34)}px)`;
        } else {
          lengthLabel.style.display = "none";
          lengthLabelKey = "";
        }
      }

      // Six ground-restraint components of the selected joint (connection tool).
      const gizmoKey = selectedKey && state.tool !== "load" ? selectedKey : null;
      const attrs = gizmoKey ? state.model.attrs[gizmoKey] : undefined;
      gizmo.update(
        gizmoKey
          ? {
              key: gizmoKey,
              position: point(gizmoKey),
              restraint: attrs?.restraint ?? (attrs?.found ? FIXED : FREE),
            }
          : null,
        camera,
        time / 1000,
        prefersStill || getSettings().reducedMotion,
      );
      labels?.querySelectorAll<HTMLElement>(".axl").forEach((label, axis) => {
        const tip = gizmo.visible ? gizmo.tips[axis] : undefined;
        const at = tip ? toScreen(tip) : null;
        label.style.display = at?.ok ? "" : "none";
        if (at)
          label.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
      });
      // The joint card sits beside its joint, clear of the gizmo arrows.
      const card = gizmoKey ? document.getElementById("card") : null;
      if (card && gizmoKey) {
        const at = toScreen(point(gizmoKey));
        const cardWidth = card.offsetWidth,
          cardHeight = card.offsetHeight;
        let right = 50,
          left = 50;
        for (const tip of gizmo.tips) {
          const tipAt = toScreen(tip);
          right = Math.max(right, tipAt.x - at.x);
          left = Math.max(left, at.x - tipAt.x);
        }
        let x = at.x + right + 30;
        if (x + cardWidth > width - 12) x = at.x - left - 30 - cardWidth;
        x = THREE.MathUtils.clamp(x, 12, Math.max(12, width - cardWidth - 12));
        // Between the top bar and the dock.
        const y = THREE.MathUtils.clamp(
          at.y - cardHeight / 2,
          66,
          Math.max(66, height - cardHeight - 118),
        );
        card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
      // Load pad arrows point the way each direction runs on screen.
      if (growth && state.tool === "load") {
        const toCamera = camera.quaternion.clone().invert();
        document
          .querySelectorAll<SVGElement>(".env-pad .dir svg[data-dir]")
          .forEach((arrow) => {
            const direction = visualLoadDirection(
              arrow.dataset.dir as LoadDirection,
            ).applyQuaternion(toCamera);
            const reach = Math.hypot(direction.x, direction.y);
            const angle = (Math.atan2(-direction.y, direction.x) * 180) / Math.PI;
            arrow.style.transform = `rotate(${angle.toFixed(1)}deg) scale(${(0.5 + 0.5 * reach).toFixed(2)})`;
          });
      }
    }
    return () => {
      if (memory && initial) memory.pose = { seed: initial.seed, eye: camera.position.toArray(), target: controls.target.toArray() };
      companionFigure.dispose();
      if (workspace) {
        delete workspace.dataset.islet;
        delete workspace.dataset.isletCloud;
        delete workspace.dataset.isletFigure;
      }
      refresh.current = () => {};
      refreshPermissions.current = () => {};
      glyphs.dispose();
      unsubscribe();
      observer.disconnect();
      renderer.setAnimationLoop(null);
      interaction.dispose();
      renderer.domElement.removeEventListener("pointermove", trackPointer);
      renderer.domElement.removeEventListener("pointerdown", trackPointer);
      renderer.domElement.removeEventListener("pointerleave", releasePointer);
      bloom.dispose();
      gizmo.dispose();
      controls.removeEventListener("end", cameraChanged);
      // Three r180 removes its root keydown in disconnect(), but leaves the
      // temporary root keyup registered if Control is held during teardown.
      const controlUp = (controls as OrbitControls & { _interceptControlUp?: EventListener })._interceptControlUp;
      if (typeof controlUp === "function") renderer.domElement.getRootNode().removeEventListener("keyup", controlUp, true);
      controls.dispose();
      [terrain, structure, guides].forEach(disposeGroup);
      particles.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      ordinaryGhost.dispose();
      assemblyGhost?.dispose();
      profileGhosts.ipe.dispose();
      profileGhosts.heb.dispose();
      stickGhost.material.dispose();
      ghost.geometry.dispose();
      ghost.material.dispose();
      preview.geometry.dispose();
      preview.material.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lose);
      renderer.dispose();
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [style]);
  if (gpuLost) throw new Error("The 3D context was lost.");
  return (
    <div className="scene">
      <div
        ref={host}
        tabIndex={0}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
        }}
        aria-label="3D workspace. Drag or use arrow keys to orbit, Q and E to rotate, F to fit, scroll to zoom, and click to build."
      />
      {isGrowthStyle(style) && (
        <>
          {/* Scene labels of the growth styles, positioned every frame by the render loop. */}
          <div
            id="labels"
            ref={labelHost}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            <div className="ring" id="rhover" />
            <div className="ring" id="rarmed" />
            <div className="ring" id="rsel" />
            {["x", "y", "z"].map((axis, i) => (
              <div
                key={axis}
                className="lab axl"
                style={{ color: DOF_AXIS_COLORS[i], display: "none" }}
              >
                {axis}
              </div>
            ))}
            <div
              className="lab pill len"
              id="growth-length"
              style={{ display: "none" }}
            >
              <span />
              <i />
              <small />
            </div>
          </div>
          <svg
            ref={axisHost}
            className="scene-axes"
            viewBox="-38 -38 76 76"
            role="img"
            aria-label="Model axes"
          >
            <circle r="36" fill="rgba(251,247,239,.82)" />
            {["X", "Y", "Z"].map((axis, i) => (
              <g key={axis}>
                <line
                  data-axis={i}
                  stroke={DOF_AXIS_COLORS[i]}
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <circle data-axis={i} r="7.5" fill={DOF_AXIS_COLORS[i]} />
                <text
                  data-axis={i}
                  fill="#fff"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {axis}
                </text>
              </g>
            ))}
            <circle r="3.5" fill="#3f4654" />
          </svg>
        </>
      )}
      {["levels", "blocks", "kit"].includes(style) && (
        <svg ref={axisHost} className="scene-axes" viewBox="-34 -34 68 68" role="img" aria-label="Model axes">
          {["X", "Y", "Z"].map((axis, i) => {
            const paint = ["#d9604e", "#5fa36a", "#4d86c4"][i];
            return <g key={axis}>
              <line data-axis={i} stroke={paint} strokeWidth="2.4" strokeLinecap="round" />
              <text data-axis={i} fill={paint} textAnchor="middle" dominantBaseline="central">{axis}</text>
            </g>;
          })}
          <circle r="2.6" fill="currentColor" />
        </svg>
      )}
      <div
        role="group"
        aria-label="Camera controls"
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          display: "flex",
          gap: 5,
          zIndex: 2,
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          title="Fit view (F)"
          onClick={() => cameraActions.current.fit()}
        >
          Fit
        </button>
        {cameraMemory && <button type="button" title="Center on selected member or joint"
          onClick={() => cameraActions.current.focus()}>Focus</button>}
        <button
          type="button"
          title="Rotate left (Q)"
          aria-label="Rotate left"
          onClick={() => cameraActions.current.orbit(-1)}
        >
          ↶
        </button>
        <button
          type="button"
          title="Rotate right (E)"
          aria-label="Rotate right"
          onClick={() => cameraActions.current.orbit(1)}
        >
          ↷
        </button>
        {style === "kit" && (
          <button type="button" onClick={() => cameraActions.current.tilt()}>
            View
          </button>
        )}
        {/* The growth styles start members from joints and quay dots, so they show no working plane. */}
        {!isGrowthStyle(style) && (
          <>
            <button
              type="button"
              title="Lower working plane (Page Down)"
              aria-label="Lower working plane"
              onClick={() => useGameStore.getState().setWorkK(workK - 1)}
            >
              −
            </button>
            <button
              type="button"
              title="Raise working plane (Page Up)"
              aria-label="Raise working plane"
              onClick={() => useGameStore.getState().setWorkK(workK + 1)}
            >
              +
            </button>
          </>
        )}
      </div>
    </div>
  );
}
