import * as THREE from 'three';
import { CELL_SIZE, parseNodeKey } from '../game/model';
import type { useGameStore } from '../game/store';
import { GROWTH_ROLE_INDEX, growthTargets } from './growthTargets';
import type { ScenePalette } from './sceneStyle';

export function buildGrowthGuides(
  group: THREE.Group,
  state: ReturnType<typeof useGameStore.getState>,
  palette: ScenePalette,
) {
  const targets = growthTargets(state);
  if (!targets.length || !state.chainStart || !palette.roles) return;
  const origin = new THREE.Vector3(...parseNodeKey(state.chainStart)).multiplyScalar(CELL_SIZE);
  const bloom = new THREE.Group();
  bloom.position.copy(origin);
  bloom.scale.setScalar(0.65);
  bloom.userData.growFrom = performance.now();
  group.add(bloom);
  const markerPositions: number[] = [];
  const markerColors: number[] = [];
  const spokes: THREE.Vector3[] = [];
  for (const target of targets) {
    const end = new THREE.Vector3(...target.point).multiplyScalar(CELL_SIZE).sub(origin);
    markerPositions.push(...end.toArray());
    markerColors.push(...new THREE.Color(palette.roles[GROWTH_ROLE_INDEX[target.role]]).toArray());
    spokes.push(new THREE.Vector3(), end.clone().multiplyScalar(0.28));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(markerPositions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(markerColors, 3));
  bloom.add(new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: { diameter: { value: 8 * Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      attribute vec3 color;
      varying vec3 tint;
      uniform float diameter;
      void main() {
        tint = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = diameter;
      }
    `,
    fragmentShader: `
      varying vec3 tint;
      void main() {
        float distance = length(gl_PointCoord - vec2(0.5));
        float mask = 1.0 - smoothstep(0.38, 0.5, distance);
        if (mask < 0.01) discard;
        vec3 color = mix(tint, vec3(1.0), 0.28 * (1.0 - smoothstep(0.08, 0.44, distance)));
        gl_FragColor = vec4(color, mask * 0.92);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  })));
  bloom.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(spokes),
    new THREE.LineBasicMaterial({ color: palette.grid, transparent: true, opacity: 0.18, depthWrite: false }),
  ));
}
