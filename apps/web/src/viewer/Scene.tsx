import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useGameStore } from "../game/store";
import { allNodeKeys, CELL_SIZE } from "../game/model";
import { buildGuides, buildTerrain, disposeGroup } from "./sceneGeometry";
import { addResultArrows, displayPoint } from "./sceneResults";
import { createFlowParticles } from "./flowParticles";
import { buildStructure } from "./structureMeshes";
import { bindSceneInteraction } from "./sceneInteraction";
import { selectedTurnCard } from "./turnPicking";
import { poseSection, wideFlangeGeometry } from "./sectionGeometry";
import { assemblyGeometry } from "./assemblyGeometry";
import { springGeometry } from "./springGeometry";
import { sceneLevel } from "./sceneLevel";
import type { SceneView } from "./sceneView";
import { createSky, SCENE_STYLES } from "./sceneStyle";
import { buildTurnGuides } from "./turnGuides";
import { buildGrowthGuides } from "./growthGuides";
import { createJointGlyphs } from "./jointGlyphs";
/** Three.js owns only presentation and picking; the game store owns the model and rules. */
export function Scene({
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
  onMessage,
  baySize,
}: SceneView) {
  const view = useRef<SceneView>({
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
    onMessage,
    baySize,
  });
  view.current = {
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
    onMessage,
    baySize,
  };
  const refresh = useRef<() => void>(() => {});
  const refreshPermissions = useRef<() => void>(() => {});
  useEffect(() => {
    refreshPermissions.current();
  }, [jointLayer, result, combo, deformed, scale, field]);
  useEffect(() => {
    refresh.current();
  }, [result, combo, deformed, scale, field, reference, utilization, loads, loadPath]);
  const workK = useGameStore((state) => state.workK);
  const style = useGameStore((state) => state.style);
  const host = useRef<HTMLDivElement>(null);
  const axisHost = useRef<SVGSVGElement>(null);
  const cameraActions = useRef({
    fit: () => {},
    orbit: (_step: number) => {},
    tilt: () => {},
  });
  useEffect(() => {
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
    refreshPermissions.current = () => glyphs.set(view.current.jointLayer, joint =>
      point(view.current.result?.ctx?.idx.has(joint.id) ? joint.id : joint.point));
    refreshPermissions.current();
    const particles = createFlowParticles(scene, point);
    let currentEnvironment = "";
    let orthoSpan = 20;
    let previousTurn: number | undefined;
    let cameraSwing = 0;
    let aspectCompensation = 1;
    let kitHigh = false;
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
        controls.minPolarAngle =
          state.style === "kit" ? (kitHigh ? 0.84 : 1.25) : 0;
        controls.maxPolarAngle =
          state.style === "kit" ? (kitHigh ? 0.84 : 1.25) : Math.PI * 0.495;
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
      disposeGroup(guides);
      particles.reset();
      buildStructure(structure, state, view.current, point, particles.add);
      addResultArrows(structure, view.current, point, state.style !== 'engineering');
      buildGuides(
        guides,
        level,
        interaction.buildPlane(),
        palette,
        state.style,
      );
      buildGrowthGuides(guides, state, palette);
      buildTurnGuides(guides, state, point);
      // Publish the new environment even while background tabs throttle animation frames.
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
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
      fit() {
        currentEnvironment = "";
        rebuild();
        const state = useGameStore.getState();
        const points = allNodeKeys(state.model).map(point);
        if (!points.length || state.mode === "multiplayer") return;
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
          const x = p.x * 21, y = -p.y * 21;
          const line = axisHost.current.querySelector('line[data-axis="' + axis + '"]');
          const label = axisHost.current.querySelector('text[data-axis="' + axis + '"]');
          line?.setAttribute("x2", String(x));
          line?.setAttribute("y2", String(y));
          label?.setAttribute("x", String(x * 1.33));
          label?.setAttribute("y", String(y * 1.33));
        }
      }
      sky.position.copy(camera.position);
      sky.material.uniforms.rimDip.value =
        state.style === "grow-dusk" || state.style === "kit"
          ? Math.atan2(Math.max(0, camera.position.z + CELL_SIZE), 145)
          : 0;
      glyphs.layout(camera, element.clientWidth, element.clientHeight);
      renderer.render(scene, camera);
    });
    return () => {
      refresh.current = () => {};
      refreshPermissions.current = () => {};
      glyphs.dispose();
      unsubscribe();
      observer.disconnect();
      renderer.setAnimationLoop(null);
      interaction.dispose();
      controls.removeEventListener("end", cameraChanged);
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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [style]);
  return (
    <div className="scene">
      <div
        ref={host}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
        }}
        aria-label="3D workspace. Drag to orbit, scroll to zoom, and click to build."
      />
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
      </div>
    </div>
  );
}
