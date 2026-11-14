import * as THREE from "three";
import { CELL_SIZE, type Level } from "../game/model";
import { terrainCell } from "../game/terrain";
import {
  isGrowthStyle,
  type ScenePalette,
  type SceneStyle,
} from "./sceneStyle";

export function roundedRectangle(
  width: number,
  height: number,
  radius: number,
) {
  const shape = new THREE.Shape();
  const x = width / 2,
    y = height / 2,
    r = Math.min(radius, x, y);
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  return shape;
}

function addSlab(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  radius: number,
  bevel: number,
  top: string,
  side: string,
  position: readonly [number, number, number],
) {
  const geometry = new THREE.ExtrudeGeometry(
    roundedRectangle(width, height, radius),
    {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 12,
    },
  );
  const mesh = new THREE.Mesh(geometry, [
    new THREE.MeshLambertMaterial({ color: top }),
    new THREE.MeshLambertMaterial({ color: side }),
  ]);
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addSea(
  group: THREE.Group,
  position: readonly [number, number, number],
  halfWidth: number,
  halfHeight: number,
  palette: ScenePalette,
  dusk: boolean,
) {
  const geometry = new THREE.CircleGeometry(145, 120);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      base: { value: new THREE.Color(palette.water) },
      horizon: { value: new THREE.Color(palette.horizon) },
      glint: { value: new THREE.Color(dusk ? "#6c8e99" : "#d5e9eb") },
      limits: { value: new THREE.Vector2(halfWidth, halfHeight) },
      time: { value: 0 },
      ripple: { value: dusk ? 0.72 : 0.85 },
    },
    vertexShader: `
      varying vec2 local;
      void main() {
        local = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 base;
      uniform vec3 horizon;
      uniform vec3 glint;
      uniform vec2 limits;
      uniform float time;
      uniform float ripple;
      varying vec2 local;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 outside = max(abs(local) - limits, vec2(0.0));
        float nearWall = length(outside);
        float far = smoothstep(20.0, 125.0, length(local));
        float wake = pow(0.5 + 0.5 * sin(nearWall * 3.3 - time * 0.55), 9.0) * exp(-nearWall * 0.49);
        vec2 p = vec2(local.x * 0.95, local.y * 3.4);
        float shimmer = smoothstep(0.90, 1.0, hash(floor(p))) *
          smoothstep(0.15, 0.32, fract(p.x)) * (1.0 - smoothstep(0.69, 0.86, fract(p.x))) *
          smoothstep(0.36, 0.49, fract(p.y)) * (1.0 - smoothstep(0.55, 0.67, fract(p.y)));
        vec3 color = mix(base, horizon, far);
        color = mix(color, glint, (ripple * (0.42 * wake + 0.19 * shimmer)) * (1.0 - far));
        color *= 0.82 + 0.18 * smoothstep(0.0, 1.8, nearWall);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sea = new THREE.Mesh(geometry, material);
  sea.position.set(...position);
  sea.userData.animate = (time: number) => {
    material.uniforms.time.value = time / 1000;
  };
  group.add(sea);
}

function addPrintedLattice(
  group: THREE.Group,
  level: Level,
  deck: number,
  style: SceneStyle,
  ink: string,
) {
  const markers = new THREE.Group();
  const dot = new THREE.CircleGeometry(0.06 * CELL_SIZE, 14);
  const material = new THREE.MeshBasicMaterial({
    color: ink,
    opacity: 0.64,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.InstancedMesh(
    dot,
    material,
    (level.nx + 1) * (level.ny + 1),
  );
  let index = 0;
  const translation = new THREE.Matrix4();
  for (let x = 0; x <= level.nx; x++)
    for (let y = 0; y <= level.ny; y++) {
      if (
        terrainCell(level, Math.min(x, level.nx - 1), Math.min(y, level.ny - 1))
          ?.water
      )
        continue;
      translation.makeTranslation(x * CELL_SIZE, y * CELL_SIZE, deck + 0.011);
      points.setMatrixAt(index++, translation);
    }
  points.count = index;
  markers.add(points);
  if (style === "kit" || style === "levels") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (context) {
      const margin = 0.85;
      const x = (i: number) =>
        ((i + margin) / (level.nx + 2 * margin)) * canvas.width;
      const y = (j: number) =>
        canvas.height -
        ((j + margin) / (level.ny + 2 * margin)) * canvas.height;
      context.strokeStyle = ink;
      context.lineWidth = 1.3;
      context.globalAlpha = 0.55;
      context.beginPath();
      for (let i = 0; i <= level.nx; i++) {
        context.moveTo(x(i), y(0));
        context.lineTo(x(i), y(level.ny));
      }
      for (let j = 0; j <= level.ny; j++) {
        context.moveTo(x(0), y(j));
        context.lineTo(x(level.nx), y(j));
      }
      context.stroke();
      context.globalAlpha = 0.84;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "600 22px system-ui";
      context.fillStyle = ink;
      for (let i = 0; i <= level.nx; i++)
        context.fillText(String(i), x(i), y(-0.44));
      for (let j = 0; j <= level.ny; j++)
        context.fillText(String(j), x(level.nx + 0.44), y(j));
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const print = new THREE.Mesh(
        new THREE.PlaneGeometry(
          (level.nx + 2 * margin) * CELL_SIZE,
          (level.ny + 2 * margin) * CELL_SIZE,
        ),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        }),
      );
      print.position.set(
        (level.nx * CELL_SIZE) / 2,
        (level.ny * CELL_SIZE) / 2,
        deck + 0.01,
      );
      markers.add(print);
    }
  }
  group.add(markers);
}

function addTurntable(
  group: THREE.Group,
  width: number,
  height: number,
  deck: number,
) {
  const radius = Math.max(width, height) * 0.97;
  const top = deck - CELL_SIZE * 0.23;
  for (const [r, h, z, color, cap] of [
    [radius, 0.46, top - CELL_SIZE * 0.23, "#7f6a4e", "#a48a66"],
    [radius * 0.62, 0.5, top - CELL_SIZE * 0.7, "#5d4f3c", "#5d4f3c"],
  ] as const) {
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.97, h * CELL_SIZE, 72),
      [color, cap, color].map(
        (paint) => new THREE.MeshLambertMaterial({ color: paint }),
      ),
    );
    cylinder.rotation.x = Math.PI / 2;
    cylinder.position.set(width / 2, height / 2, z);
    cylinder.receiveShadow = true;
    group.add(cylinder);
  }
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.32 * CELL_SIZE, 0.066 * CELL_SIZE, 0.012),
      new THREE.MeshLambertMaterial({
        color: i === 1 ? "#6a9bd8" : i === 5 ? "#e9806e" : "#d9c7a2",
      }),
    );
    mark.position.set(
      width / 2 + Math.cos(angle) * radius * 0.94,
      height / 2 + Math.sin(angle) * radius * 0.94,
      top + 0.012,
    );
    mark.rotation.z = angle;
    group.add(mark);
  }
}

export function buildDiorama(
  group: THREE.Group,
  level: Level,
  style: SceneStyle,
  palette: ScenePalette,
) {
  const width = level.nx * CELL_SIZE,
    height = level.ny * CELL_SIZE;
  const margin = (style === "blocks" ? 0.75 : 0.85) * CELL_SIZE;
  const soft = palette.side;
  const isTable = style === "kit" || style === "levels";
  const deck =
    -(style === "levels" ? 0.02 : style === "blocks" ? 0.38 : 0.28) * CELL_SIZE;
  const thickness =
    (style === "kit" ? 0.24 : style === "levels" ? 0.36 : 0.67) * CELL_SIZE;
  const bevel = (isTable ? 0.035 : 0.095) * CELL_SIZE;
  const radius =
    (style === "levels" ? 0.035 : style === "blocks" ? 0.64 : 0.5) * CELL_SIZE;
  const hasTerrain = level.type === "bridge" || (level.lakes?.length ?? 0) > 0;
  if (style !== "levels") {
    addSea(
      group,
      [
        width / 2,
        height / 2,
        deck - thickness * (style === "kit" ? 4.1 : 0.84),
      ],
      width / 2 + margin,
      height / 2 + margin,
      palette,
      style === "grow-dusk" || style === "kit",
    );
  }
  if (style === "kit") addTurntable(group, width, height, deck);
  if (hasTerrain) {
    // Preserve the visible shoreline and relief of challenge-specific terrain.
    for (let x = 0; x < level.nx; x++)
      for (let y = 0; y < level.ny; y++) {
        const cell = terrainCell(level, x, y);
        if (!cell) continue;
        const top = cell.water ? palette.water : palette.land;
        const cellTop =
          cell.h * CELL_SIZE + deck - (cell.water ? 0.24 * CELL_SIZE : 0);
        const depth = CELL_SIZE + cellTop;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, depth),
          [soft, soft, soft, soft, top, soft].map(
            (color) => new THREE.MeshLambertMaterial({ color }),
          ),
        );
        mesh.position.set(
          (x + 0.5) * CELL_SIZE,
          (y + 0.5) * CELL_SIZE,
          (cellTop - CELL_SIZE) / 2,
        );
        mesh.userData.pickTerrain = !cell.water;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
  } else {
    addSlab(
      group,
      width + 2 * margin,
      height + 2 * margin,
      thickness,
      radius,
      bevel,
      palette.land,
      soft,
      [width / 2, height / 2, deck - thickness - bevel],
    ).userData.pickTerrain = true;
  }
  if (style === "blocks" && !hasTerrain) {
    for (let x = 1; x < level.nx; x += 2)
      for (let y = 1; y < level.ny; y += 2) {
        const tile = new THREE.Mesh(
          new THREE.ShapeGeometry(
            roundedRectangle(
              1.89 * CELL_SIZE,
              1.89 * CELL_SIZE,
              0.15 * CELL_SIZE,
            ),
          ),
          new THREE.MeshLambertMaterial({
            color: (x + y) % 4 ? "#e9d4ba" : "#eedac0",
          }),
        );
        tile.position.set(x * CELL_SIZE, y * CELL_SIZE, deck + 0.008);
        tile.receiveShadow = true;
        group.add(tile);
      }
  }
  if (isGrowthStyle(style) || isTable)
    addPrintedLattice(group, level, deck, style, palette.grid);
}
