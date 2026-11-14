import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StructuralModel } from '@dof/solver-contract';
/** Owns graphics resources; structural state remains outside Three.js. */
export function Scene({ model }: { model: StructuralModel }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current; if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce3dd');
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(12, 10, 14);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 1, 0); controls.maxPolarAngle = Math.PI / 2.05;
    scene.add(new THREE.GridHelper(24, 24, 0x97aaa0, 0xb8c8bd)); scene.add(new THREE.AxesHelper(2));
    const nodes = new Map(model.nodes.map((node) => [node.id, node]));
    for (const member of model.members) { const a = nodes.get(member.startNodeId), b = nodes.get(member.endNodeId); if (a && b) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a.position), new THREE.Vector3(...b.position)]), new THREE.LineBasicMaterial({ color: 0x294f43 }))); }
    const resize = () => { const { clientWidth: w, clientHeight: h } = element; if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    return () => { observer.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); scene.traverse((o) => { if (o instanceof THREE.Line) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); } }); renderer.dispose(); renderer.domElement.remove(); };
  }, [model]);
  return <div className="scene" ref={host} aria-label="3D workspace. Drag to orbit and scroll to zoom." />;
}
