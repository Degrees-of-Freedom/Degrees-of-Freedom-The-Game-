import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { AnalysisResult, StructuralModel } from '@dof/solver-contract';

const COLOR = {
  member: 0x294f43,
  unstressed: 0x8a9890,
  tension: 0x2f6f9f,
  compression: 0xb5473c,
  mechanism: 0xd98324,
  support: 0x183c30,
  load: 0x6d4aa8,
};
/** Mechanism shapes are drawn with their peak node moved this fraction of the model size. */
const MECHANISM_SCALE = 0.15;
const LOAD_ARROW_LENGTH = 1.2;

/** Free the GPU resources of everything in a group, then empty it. */
function clearGroup(group: THREE.Group) {
  group.traverse((object) => {
    const { geometry, material } = object as THREE.Mesh;
    geometry?.dispose();
    for (const item of Array.isArray(material) ? material : material ? [material] : []) item.dispose();
  });
  group.clear();
}

function line(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color }));
}

/**
 * Draw the model and, when present, its analysis result.
 *
 * A successful result colours each member by axial force, which shows the
 * load path: blue for tension, red for compression, fading to grey as the
 * force approaches zero. An unstable result overlays the first mechanism
 * shape in orange and marks the nodes that move.
 */
function drawStructure(group: THREE.Group, model: StructuralModel, result?: AnalysisResult) {
  const positions = new Map(model.nodes.map((node) => [node.id, new THREE.Vector3(...node.position)]));
  const forces = result?.status === 'success' ? result.memberForces : undefined;
  const peakAxial = Math.max(0, ...Object.values(forces ?? {}).map((force) => Math.abs(force.axial)));

  for (const member of model.members) {
    const a = positions.get(member.startNodeId), b = positions.get(member.endNodeId);
    if (!a || !b) continue;
    let color = new THREE.Color(COLOR.member);
    const axial = forces?.[member.id]?.axial;
    if (axial !== undefined) {
      const share = peakAxial > 0 ? Math.abs(axial) / peakAxial : 0;
      color = new THREE.Color(COLOR.unstressed).lerp(new THREE.Color(axial >= 0 ? COLOR.tension : COLOR.compression), share);
    }
    group.add(line(a, b, color));
  }

  for (const support of model.supports) {
    const position = positions.get(support.nodeId);
    if (!position) continue;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: COLOR.support }));
    marker.position.copy(position);
    group.add(marker);
  }

  for (const load of model.loads) {
    const position = positions.get(load.nodeId);
    const direction = new THREE.Vector3(...load.force);
    if (!position || direction.lengthSq() === 0) continue;
    direction.normalize();
    // The arrow ends at the node, pointing the way the force pushes.
    const tail = position.clone().addScaledVector(direction, -LOAD_ARROW_LENGTH);
    group.add(new THREE.ArrowHelper(direction, tail, LOAD_ARROW_LENGTH, COLOR.load, 0.3, 0.18));
  }

  if (result?.status !== 'unstable') return;
  const size = new THREE.Box3().setFromPoints([...positions.values()]).getSize(new THREE.Vector3());
  const scale = MECHANISM_SCALE * Math.max(size.x, size.y, size.z, 1);
  const shape = result.stability.modes[0]?.displacements ?? {};
  const moved = (id: string) => {
    const [x = 0, y = 0, z = 0] = shape[id] ?? [];
    return positions.get(id)?.clone().add(new THREE.Vector3(x, y, z).multiplyScalar(scale));
  };
  for (const member of model.members) {
    if (!(member.startNodeId in shape) && !(member.endNodeId in shape)) continue;
    const a = moved(member.startNodeId), b = moved(member.endNodeId);
    if (a && b) group.add(line(a, b, COLOR.mechanism));
  }
  for (const id of result.stability.unstableNodeIds) {
    const position = positions.get(id);
    if (!position) continue;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: COLOR.mechanism }));
    marker.position.copy(position);
    group.add(marker);
  }
}

/** Owns graphics resources; structural state remains outside Three.js. */
export function Scene({ model, result }: { model: StructuralModel; result?: AnalysisResult }) {
  const host = useRef<HTMLDivElement>(null);
  const structure = useRef<THREE.Group | null>(null);

  // The renderer, camera and controls live for the lifetime of the component,
  // so loading a model or receiving a result does not reset the view.
  useEffect(() => {
    const element = host.current; if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce3dd');
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(12, 10, 14);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 1, 0); controls.maxPolarAngle = Math.PI / 2.05;
    scene.add(new THREE.GridHelper(24, 24, 0x97aaa0, 0xb8c8bd)); scene.add(new THREE.AxesHelper(2));
    const group = new THREE.Group(); scene.add(group); structure.current = group;
    const resize = () => { const { clientWidth: w, clientHeight: h } = element; if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => { observer.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); clearGroup(group); structure.current = null; renderer.dispose(); renderer.domElement.remove(); };
  }, []);

  useEffect(() => {
    const group = structure.current; if (!group) return;
    clearGroup(group);
    drawStructure(group, model, result);
  }, [model, result]);

  return <div className="scene" ref={host} aria-label="3D workspace. Drag to orbit and scroll to zoom." />;
}
