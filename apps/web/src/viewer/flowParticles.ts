import * as THREE from 'three';
import type { LoadPathMember } from '../solver/loadPath';
const capacity = 2500;
export function createFlowParticles(
  scene: THREE.Scene,
  point: (key: string) => THREE.Vector3,
) {
  const particles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    capacity,
  );
  particles.frustumCulled = false;
  particles.count = 0;
  scene.add(particles);
  const flowing: {
    a: string;
    b: string;
    direction: number;
    phase: number;
    speed: number;
    size: number;
    color: string;
  }[] = [];
  const particleMatrix = new THREE.Matrix4(),
    particlePosition = new THREE.Vector3();
  let lastFrame = 0;
  function add(flow: LoadPathMember | undefined, relative: number) {
    if (flow && relative >= 0.03 && flow.direction) {
      const count = Math.max(
        1,
        Math.round((flow.length / 1.4) * (0.4 + relative)),
      );
      for (let i = 0; i < count && flowing.length < capacity; i++)
        flowing.push({
          a: flow.a,
          b: flow.b,
          direction: flow.direction,
          phase: i / count,
          speed: (0.8 + 2.6 * relative) / flow.length,
          size: 0.6 + 0.8 * Math.sqrt(relative),
          color:
            flow.mode === 'tension'
              ? '#93ceff'
              : flow.mode === 'compression'
                ? '#ffab98'
                : '#e1c0ff',
        });
    }
  }
  function tick(time: number) {
    const dt = lastFrame ? Math.min((time - lastFrame) / 1000, 0.1) : 0;
    lastFrame = time;
    particles.count = flowing.length;
    flowing.forEach((f, i) => {
      f.phase = (f.phase + f.speed * dt) % 1;
      particlePosition.lerpVectors(
        point(f.a),
        point(f.b),
        f.direction > 0 ? f.phase : 1 - f.phase,
      );
      particleMatrix
        .makeScale(f.size, f.size, f.size)
        .setPosition(particlePosition);
      particles.setMatrixAt(i, particleMatrix);
      particles.setColorAt(i, new THREE.Color(f.color));
    });
    if (flowing.length) {
      particles.instanceMatrix.needsUpdate = true;
      if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
    }
  }
  return {
    add,
    tick,
    reset: () => {
      flowing.length = 0;
    },
    dispose: () => {
      particles.geometry.dispose();
      particles.material.dispose();
      particles.dispose();
    },
  };
}
