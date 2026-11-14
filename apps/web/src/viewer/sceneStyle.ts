import * as THREE from 'three';

const engineering = {
  sky: '#dce3dd',
  horizon: '#dce3dd',
  land: '#a2b89b',
  side: '#879b83',
  water: '#6094ab',
  fill: '#ffffff',
  ground: '#62604d',
  sun: '#ffffff',
  intensity: 2,
  offset: [1.3, -1, 1.1],
  grid: '#759b96',
  hub: '#edf1ed',
  roles: null as readonly [string, string, string] | null,
  fog: 0,
} as const;

const daylight = {
  ...engineering,
  sky: '#cfe7ee',
  horizon: '#f4efe4',
  land: '#f2e8d5',
  side: '#e2d3b8',
  water: '#a8d4dc',
  fill: '#f1f8fb',
  ground: '#f3e3c6',
  sun: '#fff1dc',
  intensity: 1.75,
  offset: [0.96, -0.85, 0.65],
  grid: '#ad9676',
  hub: '#fff5dc',
  roles: ['#d86f5c', '#e3b04b', '#4f9da6'],
  fog: 0.0062,
} as const;

const dusk = {
  ...daylight,
  sky: '#33506b',
  horizon: '#f6c89f',
  land: '#e9dcc3',
  side: '#cdbb9a',
  water: '#2f5d6b',
  fill: '#dde6f5',
  ground: '#93a3b0',
  sun: '#ffdcb4',
  intensity: 2.5,
  grid: '#9e8566',
} as const;

export const SCENE_STYLES = {
  engineering,
  grow: daylight,
  'grow-dusk': dusk,
  levels: {
    ...daylight,
    sky: '#e1e6ee',
    horizon: '#e1e6ee',
    land: '#f1ebde',
    side: '#d3cbba',
    water: '#95b2c8',
    offset: [1.15, -1.35, 1.5],
    grid: '#648694',
    roles: null,
    fog: 0,
  },
  blocks: {
    ...daylight,
    sky: '#eae2f3',
    horizon: '#eee7df',
    land: '#f3e3cf',
    side: '#dcc7ab',
    offset: [1.25, -1.4, 1.25],
    grid: '#8b74a5',
    roles: ['#d2594a', '#3f9477', '#5578c2'],
  },
  kit: { ...dusk, offset: [1.2, -1.5, 1.25], roles: null },
} as const;

export type SceneStyle = keyof typeof SCENE_STYLES;
export type ScenePalette = (typeof SCENE_STYLES)[SceneStyle];

export function isGrowthStyle(style: SceneStyle) {
  return style === 'grow' || style === 'grow-dusk';
}

export function createSky() {
  const geometry = new THREE.SphereGeometry(180, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 direction;
      void main() {
        float t = smoothstep(-0.04, 0.54, direction.z);
        gl_FragColor = vec4(mix(horizon, top, t), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}
