import * as THREE from "three";

const engineering = {
  sky: "#dce3dd",
  horizon: "#dce3dd",
  land: "#a2b89b",
  side: "#879b83",
  water: "#6094ab",
  fill: "#ffffff",
  ground: "#62604d",
  sun: "#ffffff",
  intensity: 2,
  offset: [1.3, -1, 1.1],
  grid: "#759b96",
  hub: "#edf1ed",
  roles: null as readonly [string, string, string] | null,
  fog: 0,
} as const;

const daylight = {
  ...engineering,
  sky: "#cfe7ee",
  horizon: "#f4efe4",
  land: "#f2e8d5",
  side: "#e2d3b8",
  water: "#a8d4dc",
  fill: "#f1f8fb",
  ground: "#f3e3c6",
  sun: "#fff1dc",
  intensity: 1.75,
  offset: [1.64, -0.64, 0.78],
  grid: "#ad9676",
  hub: "#fff5dc",
  roles: ["#d86f5c", "#e3b04b", "#4f9da6"],
  fog: 0.0062,
} as const;

const dusk = {
  ...daylight,
  sky: "#33506b",
  horizon: "#f6c89f",
  land: "#e9dcc3",
  side: "#cdbb9a",
  water: "#2f5d6b",
  fill: "#dde6f5",
  ground: "#93a3b0",
  sun: "#ffdcb4",
  intensity: 2.5,
  grid: "#bca987",
  hub: "#f3ead8",
  roles: ["#e9806e", "#6a9bd8", "#8cc7b5"],
} as const;

export const SCENE_STYLES = {
  engineering,
  grow: daylight,
  "grow-dusk": dusk,
  levels: {
    ...daylight,
    sky: "#f4f0e7",
    horizon: "#f4f0e7",
    land: "#faf7f0",
    side: "#e6dfd0",
    water: "#95b2c8",
    offset: [1.7, -0.7, 1.5],
    grid: "#a79f8c",
    hub: "#ffffff",
    roles: ["#3f5d8a", "#6f8fb8", "#c98a5a"],
    fog: 0,
  },
  blocks: {
    ...daylight,
    sky: "#d9c7e3",
    horizon: "#fbe9d7",
    water: "#82aeb2",
    land: "#f3e3cf",
    side: "#dcc7ab",
    offset: [1.25, -1.4, 1.25],
    grid: "#8b74a5",
    hub: "#3b4252",
    roles: ["#fbf3e6", "#fbf3e6", "#e8735a"],
  },
  kit: { ...dusk, offset: [-1.17, -2.6, 1.25], roles: null },
} as const;

export type SceneStyle = keyof typeof SCENE_STYLES;
export type ScenePalette = (typeof SCENE_STYLES)[SceneStyle];

export function isGrowthStyle(style: SceneStyle) {
  return style === "grow" || style === "grow-dusk";
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
      mid: { value: new THREE.Color() },
      band: { value: new THREE.Vector4() },
      rimDip: { value: 0 },
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
      uniform vec3 mid;
      uniform vec4 band;
      uniform float rimDip;
      varying vec3 direction;
      void main() {
        float elevation = normalize(direction).z + rimDip;
        vec3 tint = mix(horizon, mid, smoothstep(band.x, band.y, elevation));
        tint = mix(tint, top, smoothstep(band.z, band.w, elevation));
        gl_FragColor = vec4(tint, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}
