import * as THREE from "three";
import { analyzeConnectivity } from "../game/connectivity";
import { ITEMS } from "../game/inventory";
import { allNodeKeys, CELL_SIZE, parseNodeKey } from "../game/model";
import type { useGameStore } from "../game/store";
import {
  paintedJoint,
  paintedLoad,
  paintedSupport,
  visualLoadDirection,
} from "./scenePieces";
import { isGrowthStyle, SCENE_STYLES } from "./sceneStyle";
import { poseSection, wideFlangeGeometry, type WideFlange } from "./sectionGeometry";
import { assemblyGeometry } from "./assemblyGeometry";
import { springGeometry } from "./springGeometry";
import {
  computeLoadPath,
  traceToGround,
  type LoadPathMember,
} from "../solver/loadPath";
import type { SceneView } from "./sceneView";
export function buildStructure(
  structure: THREE.Group,
  s: ReturnType<typeof useGameStore.getState>,
  v: SceneView,
  point: (key: string) => THREE.Vector3,
  addFlow: (flow: LoadPathMember | undefined, relative: number) => void,
) {
  const result = v.result;
  const palette = SCENE_STYLES[s.style];
  const turn = s.mode === "multiplayer" ? s.turn : null;
  const playerColors = ["#e9806e", "#6a9bd8"];
  const neutralSteel = "#d7b55f";
  // Each rebuilt structure owns its profiles; sliced pieces share the same unit prism.
  const sections = new Map<WideFlange, THREE.BufferGeometry>();
  const turnOwners = new Map(
    turn
      ? [...turn.board.members, ...turn.draft.members].map((member) => [
          member.id,
          member.owner,
        ])
      : [],
  );
  const unsupported = new Set(
    s.style !== "engineering"
      ? analyzeConnectivity(s.model, turn).unsupportedMembers
      : [],
  );
  const activeMembers = new Set(turn?.draft.members.map(({ id }) => id));
  const path = v.loadPath && result ? computeLoadPath(result, v.combo) : null;
  const trace =
    path && s.selected?.type === "node"
      ? traceToGround(path, s.selected.key)
      : null;
  for (const member of s.model.members) {
    const a = point(member.a),
      b = point(member.b);
    const flow = path?.members.get(member.id),
      relative = flow && path ? flow.force / path.maxForce : 0;
    const width = path
      ? relative < 0.01
        ? 0.05
        : 0.05 + 0.42 * Math.sqrt(relative)
      : member.type === "cable"
        ? 0.06
        : member.type === "shs"
          ? 0.12
          : member.type === "glulam"
            ? 0.25
            : 0.3;
    addFlow(flow, relative);
    const u = result?.members[member.id]?.util;
    const [ax, ay, az] = parseNodeKey(member.a);
    const [bx, by, bz] = parseNodeKey(member.b);
    const role = ax === bx && ay === by ? 0 : az === bz ? 1 : 2;
    const owner =
      turn?.players.findIndex(({ id }) => id === turnOwners.get(member.id)) ??
      -1;
    const defaultColor =
      owner >= 0
        ? playerColors[owner]
        : turnOwners.get(member.id) === "neutral" ? neutralSteel : (palette.roles?.[role] ?? ITEMS[member.type].color);
    let color =
      v.utilization && result && !result.error && result.designChecksAvailable !== false
        ? result.mechanism
          ? "#9b6bff"
          : u === undefined
            ? "#777777"
            : u > 1
              ? "#ed4545"
              : u > 0.6
                ? "#e5a33f"
                : "#4cae77"
        : defaultColor;
    if (path)
      color =
        relative < 0.01
          ? "#5a6370"
          : flow?.mode === "tension"
            ? "#4da3ff"
            : flow?.mode === "compression"
              ? "#ff6b4a"
              : flow?.mode === "bending"
                ? "#c58cff"
                : "#5a6370";
    const pending = activeMembers.has(member.id);
    if (member.type === "spring") {
      const mesh = new THREE.Mesh(springGeometry(member, 1.8), new THREE.MeshStandardMaterial({
        color, transparent: pending, opacity: pending ? 0.65 : 1,
        emissive: s.selected?.type === "member" && s.selected.id === member.id ? 0x536b54 : 0,
      }));
      mesh.castShadow = !pending; mesh.receiveShadow = true;
      structure.add(mesh);
      continue;
    }
    if (member.assembly) {
      const connections = [...(turn?.board.connections ?? []), ...(turn?.draft.connections ?? [])];
      const geometry = assemblyGeometry(member, node => {
        const end = node.station === 0 ? "a" : node.station === 1 ? "b" : undefined;
        const key = end ? connections.find(c => c.memberId === member.id && c.end === end)?.jointId ??
          `endpoint:${member.id}:${end}` : node.id;
        return result?.ctx?.idx.has(key) ? point(key) : new THREE.Vector3(...node.point).multiplyScalar(CELL_SIZE);
      });
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color, transparent: pending, opacity: pending ? 0.65 : 1,
        emissive: s.selected?.type === 'member' && s.selected.id === member.id ? 0x536b54 : 0,
      }));
      mesh.castShadow = !pending; mesh.receiveShadow = true;
      structure.add(mesh);
      continue;
    }
    if (
      s.style === "levels" &&
      Math.min(az, bz) < s.workK &&
      Math.max(az, bz) > s.workK
    ) {
      const cut = a.clone().lerp(b, (s.workK - az) / (bz - az));
      addSegment(a, cut, az > s.workK);
      addSegment(cut, b, bz > s.workK);
    } else {
      addSegment(a, b, s.style === "levels" && Math.max(az, bz) > s.workK);
    }

    function addSegment(
      start: THREE.Vector3,
      end: THREE.Vector3,
      aboveSlice: boolean,
    ) {
      const delta = end.clone().sub(start);
      const span = delta.length();
      const isGhost = pending || aboveSlice || unsupported.has(member.id);
      const isRound =
        isGrowthStyle(s.style) || s.style === "kit" || s.style === "blocks";
      const radius = v.loadPath
        ? width / 2
        : CELL_SIZE * (s.style === "kit" ? 0.1 : 0.072);
      let profile: THREE.BufferGeometry | undefined;
      if (member.type === "ipe" || member.type === "heb") {
        profile = sections.get(member.type) ?? wideFlangeGeometry(member.type);
        sections.set(member.type, profile);
      }
      const mesh = new THREE.Mesh(
        profile ?? (isRound
          ? new THREE.CapsuleGeometry(
              radius,
              Math.max(0.01, span - radius * 2),
              6,
              12,
            )
          : new THREE.BoxGeometry(
              s.style === "levels" ? CELL_SIZE * 0.17 : width,
              span,
              s.style === "levels" ? CELL_SIZE * 0.17 : width,
            )),
        new THREE.MeshStandardMaterial({
          color,
          transparent: isGhost,
          opacity: aboveSlice ? 0.3 : pending ? 0.62 : isGhost ? 0.51 : 1,
          depthWrite: !isGhost,
          emissive: trace?.members.has(member.id)
            ? 0x555555
            : s.selected?.type === "member" && s.selected.id === member.id
              ? 0x536b54
              : 0x000000,
        }),
      );
      if (profile) {
        poseSection(mesh, start, end, new THREE.Vector3(bx - ax, by - ay, bz - az));
      } else {
        mesh.position.copy(start).add(end).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      }
      mesh.castShadow = !isGhost && s.style !== "engineering";
      mesh.receiveShadow = s.style !== "engineering";
      structure.add(mesh);
    }
  }
  for (const key of allNodeKeys(s.model)) {
    const p = point(key),
      attrs = s.model.attrs[key] || {};
    if (s.style !== "engineering" && !attrs.target) {
      paintedJoint(
        structure,
        p,
        s.selected?.type === "node" && s.selected.key === key,
        !!attrs.joint && s.mode !== "multiplayer",
        s.style,
        palette.hub,
        s.style === "levels" && parseNodeKey(key)[2] > s.workK,
      );
      if (attrs.found) paintedSupport(structure, p, attrs, s.style);
      const isShowingResult = v.loads && !!result?.combos[v.combo] && !result.combos[v.combo].fail;
      if (attrs.load && !isShowingResult) {
        const directions = s.model.members.flatMap(({ a, b }) => {
          const other = a === key ? b : b === key ? a : null;
          if (!other) return [];
          return [point(other).sub(p).normalize()];
        });
        paintedLoad(structure, p, attrs, s.style, directions, parseNodeKey(key)[2] >= 1);
      }
      continue;
    }
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(trace?.nodes.has(key) ? 0.26 : 0.16, 12, 8),
      new THREE.MeshStandardMaterial({
        transparent: s.style === "levels" && p.z > s.workK * CELL_SIZE,
        opacity: s.style === "levels" && p.z > s.workK * CELL_SIZE ? 0.35 : 1,
        color:
          s.selected?.type === "node" && s.selected.key === key
            ? "#f0b84b"
            : palette.hub,
      }),
    );
    node.position.copy(p);
    structure.add(node);
    if (attrs.joint) {
      const joint = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.42, 0.42),
        new THREE.MeshStandardMaterial({ color: "#f39c34" }),
      );
      joint.position.copy(p);
      structure.add(joint);
    }
    if (attrs.found) {
      const foundation = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.2, 0.6),
        new THREE.MeshStandardMaterial({
          color: attrs.locked ? "#777771" : "#bdb8ae",
        }),
      );
      foundation.position.copy(p).add(new THREE.Vector3(0, 0, -0.3));
      structure.add(foundation);
    }
    if (attrs.target) {
      const rope = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.5),
        new THREE.MeshBasicMaterial({ color: 0x2b2f36 }),
      );
      rope.position.copy(p).add(new THREE.Vector3(0, 0, -0.25));
      structure.add(rope);
      const color =
        !result || result.error
          ? "#e0a030"
          : result.floating.includes(key)
            ? "#ff5a5f"
            : "#3ecf8e";
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.1, 0.9),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
      );
      crate.position.copy(p).add(new THREE.Vector3(0, 0, -0.95));
      structure.add(crate);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#17251e";
        ctx.fillRect(0, 0, 256, 80);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 40px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${attrs.load} kN`, 128, 54);
        const texture = new THREE.CanvasTexture(canvas);
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: texture, depthTest: false }),
        );
        label.position.copy(p).add(new THREE.Vector3(0, 0, -1.6));
        label.scale.set(1.6, 0.5, 1);
        structure.add(label);
      }
    } else if (attrs.load && !(v.loads && result?.combos[v.combo] && !result.combos[v.combo].fail))
      structure.add(
        new THREE.ArrowHelper(
          visualLoadDirection(attrs.loadDirection),
          p
            .clone()
            .addScaledVector(visualLoadDirection(attrs.loadDirection), -2),
          1.8,
          0xe74e50,
          0.5,
          0.3,
        ),
      );
  }
}
