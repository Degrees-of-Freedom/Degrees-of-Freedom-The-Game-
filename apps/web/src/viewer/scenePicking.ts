import * as THREE from "three";
import { useGameStore } from "../game/store";
import {
  allNodeKeys,
  CELL_SIZE,
  parseNodeKey,
  type GridPoint,
  type MemberType,
  type NodeItem,
  type Tool,
} from "../game/model";
import { groundK } from "../game/terrain";
import { bayFaces, cycleBayBrace, type BayFace } from "../game/bayBrace";
import { sceneLevel } from "./sceneLevel";
import { MEMBER_TYPES, remaining } from "../game/inventory";
import { memberIssue, nodeItemIssue } from "../game/placementRules";
import { basePoint } from "./sceneResults";
import type { BuildPlane } from "./sceneGeometry";

import {
  DEFAULT_BAY_SIZE,
  pickBayFace,
  previewBay,
  type BayHit,
} from "./bayPreview";
import { GROWTH_ROLE_INDEX, growthTargets } from "./growthTargets";
import {
  buildStack,
  createStackSelector,
  type StackCandidate,
} from "./growthStack";
import { isGrowthStyle, SCENE_STYLES } from "./sceneStyle";
import { memberEndPosition } from "./turnGuides";
import {
  selectedTurnCard,
  turnConnectionTargets,
  turnPointIssue,
  type ConnectionTarget,
} from "./turnPicking";
import type { SceneHover, SceneView } from "./sceneView";

type Hit =
  | BayHit
  | { kind: "brace"; face: BayFace; issue: string | null }
  | ({ kind: "connection" } & ConnectionTarget)
  | { kind: "point"; p: GridPoint; issue: string | null }
  | { kind: "member"; id: number }
  | { kind: "node"; key: string }
  | null;
export function createPicker(
  canvas: HTMLCanvasElement,
  getCamera: () => THREE.Camera,
  terrain: THREE.Group,
  ghost: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
  preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  point: (key: string) => THREE.Vector3,
  buildPlane: () => BuildPlane,
  getView: () => SceneView,
  onHover?: (hover: SceneHover | null) => void,
) {
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2();
  // Which of several overlapping growth targets is chosen (see growthStack.ts).
  const stack = createStackSelector();
  let lastEvent: PointerEvent | null = null;
  const pick = (e: PointerEvent, toolOverride?: Tool) => {
    lastEvent = e;
    const s = useGameStore.getState(),
      level = sceneLevel(s),
      camera = getCamera(),
      card = selectedTurnCard(s),
      tool =
        toolOverride ??
        (card?.kind === "element"
          ? card.type
          : card?.kind === "load"
            ? "load"
            : s.mode === "multiplayer"
              ? "inspect"
              : s.tool),
      rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const screen = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return [((p.x + 1) * rect.width) / 2, ((1 - p.y) * rect.height) / 2, p.z];
    };
    let nearNode: string | null = null,
      nodeDistance = 14;
    for (const key of allNodeKeys(s.model)) {
      if (key === s.chainStart && MEMBER_TYPES.includes(tool as MemberType))
        continue;
      const p = screen(point(key)),
        d = Math.hypot(p[0] - x, p[1] - y);
      if (p[2] < 1 && d < nodeDistance) {
        nearNode = key;
        nodeDistance = d;
      }
    }
    let nearMember: number | null = null,
      memberDistance = 9;
    for (const m of s.model.members) {
      const a = screen(point(m.a)),
        b = screen(point(m.b)),
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1),
          ),
        ),
        d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
      if (a[2] < 1 && b[2] < 1 && d < memberDistance) {
        nearMember = m.id;
        memberDistance = d;
      }
    }
    let hit: Hit = null;
    let stackLabel = "";
    let hoverRole: SceneHover["role"] = null;
    ghost.visible = false;
    preview.visible = false;
    if (card?.kind === "connection") {
      let closest = 19;
      for (const target of turnConnectionTargets(s)) {
        const member = s.model.members.find(({ id }) => id === target.memberId);
        if (!member) continue;
        // Offset along the member so coincident ends can be picked individually.
        const endpoint = memberEndPosition(point, member, target.end);
        const [sx, sy, depth] = screen(endpoint);
        const distance = Math.hypot(sx - x, sy - y);
        if (depth >= -1 && depth < 1 && distance < closest) {
          hit = { kind: "connection", ...target };
          closest = distance;
          ghost.position.copy(endpoint);
        }
      }
      if (hit) {
        ghost.material.color.set("#f6ad49");
        ghost.visible = true;
      }
    } else if (tool === "brace") {
      let closest = 16;
      for (const face of bayFaces(
        s.model,
        getView().baySize ?? DEFAULT_BAY_SIZE,
      )) {
        const [a, , , b] = face.corners;
        const from = new THREE.Vector3(...a).multiplyScalar(CELL_SIZE);
        const to = new THREE.Vector3(...b).multiplyScalar(CELL_SIZE);
        const [ax, ay, az] = screen(from);
        const [bx, by, bz] = screen(to);
        const dx = bx - ax,
          dy = by - ay;
        const t = THREE.MathUtils.clamp(
          ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1),
          0.12,
          0.88,
        );
        const distance = Math.hypot(ax + t * dx - x, ay + t * dy - y);
        if (az < -1 || az >= 1 || bz < -1 || bz >= 1 || distance >= closest)
          continue;
        closest = distance;
        const cycle = cycleBayBrace(level, s.model, face);
        const issue = cycle.ok ? null : cycle.reason;
        hit = { kind: "brace", face, issue };
        const brace = cycle.ok ? cycle.model.members.find(({ id }) => id === s.model.nextId) : undefined;
        const previewPoints = brace
          ? [point(brace.a), point(brace.b)]
          : [from, to];
        preview.geometry.dispose();
        preview.geometry = new THREE.BufferGeometry().setFromPoints(previewPoints);
        preview.material.color.set(issue ? "#e75151" : "#5578c2");
        preview.visible = true;
      }
    } else if (tool === "inspect" || tool === "delete" || tool === "swap") {
      if (
        nearNode &&
        tool !== "swap" &&
        (tool === "inspect" ||
          !!(
            s.model.attrs[nearNode]?.found ||
            s.model.attrs[nearNode]?.joint ||
            s.model.attrs[nearNode]?.load
          ))
      )
        hit = { kind: "node", key: nearNode };
      else if (nearMember !== null) hit = { kind: "member", id: nearMember };
    } else {
      ndc.set((x / rect.width) * 2 - 1, (-y / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const start = s.chainStart ? parseNodeKey(s.chainStart) : null,
        plane = buildPlane();
      const normal =
        plane.axis === "x"
          ? new THREE.Vector3(1, 0, 0)
          : plane.axis === "y"
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);
      const isMember = MEMBER_TYPES.includes(tool as MemberType);
      let intersection = ray.ray.intersectPlane(
        new THREE.Plane(normal, -plane.value * CELL_SIZE),
        new THREE.Vector3(),
      );
      // Before starting a chain, pick the closest terrain top as in the prototype.
      if (!start && s.style !== "levels" && s.style !== "blocks") {
        const terrainHit = ray
          .intersectObjects(terrain.children)
          .find(
            (h) =>
              h.object instanceof THREE.Mesh &&
              h.face &&
              h.face.normal.z > 0.5 &&
              h.object.userData.pickTerrain === true,
          );
        if (
          terrainHit &&
          (!intersection ||
            terrainHit.point.distanceTo(ray.ray.origin) <
              intersection.distanceTo(ray.ray.origin))
        )
          intersection = terrainHit.point;
      }
      const isGrowing = !!start && isMember && !card && isGrowthStyle(s.style);
      if (!isGrowing) stack.reset();
      const reachable = isGrowing ? closestGrowthTarget() : null;
      hoverRole = reachable?.role ?? null;
      if (!card && s.style === "blocks" && isMember && intersection) {
        const baySize = getView().baySize ?? DEFAULT_BAY_SIZE;
        const face = pickBayFace(s, ray.ray, baySize);
        hit = previewBay(
          s,
          intersection,
          baySize,
          tool as MemberType,
          preview,
          face,
        );
      } else if (reachable || (!isGrowing && (intersection || nearNode))) {
        const useExisting =
          nearNode &&
          nearNode !== s.chainStart &&
          (s.style !== "levels" || parseNodeKey(nearNode)[2] === plane.value)
            ? nearNode
            : null;
        const p: GridPoint | null =
          card?.kind === "load"
            ? nearNode
              ? parseNodeKey(nearNode)
              : null
            : reachable
              ? reachable.point
              : useExisting
                ? parseNodeKey(useExisting)
                : intersection
                  ? [
                      Math.max(
                        0,
                        Math.min(
                          level.nx,
                          Math.round(intersection.x / CELL_SIZE),
                        ),
                      ),
                      Math.max(
                        0,
                        Math.min(
                          level.ny,
                          Math.round(intersection.y / CELL_SIZE),
                        ),
                      ),
                      Math.max(
                        0,
                        Math.min(
                          level.nz,
                          Math.round(intersection.z / CELL_SIZE),
                        ),
                      ),
                    ]
                  : null;
        if (p) {
          // Levels preserves the active slice. Invalid underground picks show
          // the same rule feedback as the committed edit.
          if (s.style !== "levels")
            p[2] = Math.max(p[2], groundK(level, p[0], p[1]));
          const issue = card
            ? turnPointIssue(s, p)
            : isMember
              ? start
                ? memberIssue(level, s.model, start, p, tool as MemberType)
                : remaining(level, s.model, tool as MemberType) <= 0
                  ? "No items left in supply"
                  : null
              : nodeItemIssue(level, s.model, p, tool as NodeItem);
          hit = { kind: "point", p, issue };
          ghost.position.set(...p).multiplyScalar(CELL_SIZE);
          const roles = SCENE_STYLES[s.style].roles;
          const roleColor =
            reachable && roles
              ? roles[GROWTH_ROLE_INDEX[reachable.role]]
              : "#31aa78";
          ghost.material.color.set(issue ? "#e75151" : roleColor);
          ghost.visible = true;
          if (start && isMember) {
            preview.geometry.dispose();
            const segments = [
              new THREE.Vector3(...start).multiplyScalar(CELL_SIZE),
              ghost.position,
            ];
            if (s.style === "levels" && start[2] !== p[2]) {
              segments.push(
                segments[0],
                new THREE.Vector3(start[0], start[1], p[2]).multiplyScalar(
                  CELL_SIZE,
                ),
              );
            }
            preview.geometry = new THREE.BufferGeometry().setFromPoints(
              segments,
            );
            preview.material.color.copy(ghost.material.color);
            preview.visible = true;
          }
        }
      }
    }
    function closestGrowthTarget() {
      const candidates: StackCandidate<
        ReturnType<typeof growthTargets>[number]
      >[] = [];
      for (const target of growthTargets(s)) {
        const [sx, sy, depth] = screen(basePoint(target.key));
        if (depth >= -1 && depth < 1)
          candidates.push({
            item: target,
            sx,
            sy,
            depth,
            dist: Math.hypot(sx - x, sy - y),
          });
      }
      // Targets that overlap on screen form a stack; the camera-nearest one
      // is the default and the player can step through the rest.
      const targets = buildStack(candidates);
      if (!targets.length) {
        stack.reset();
        return null;
      }
      const index = stack.choose(
        targets.map((t) => t.item.key),
        s.chainStart,
      );
      if (targets.length > 1)
        stackLabel = `${index + 1} of ${targets.length} overlapping`;
      return targets[index].item;
    }
    function memberTitle(id: number) {
      const view = getView();
      const result = view.result;
      const label = "Member " + id;
      if (!result || result.error || result.mechanism) return label;
      const member = result.members[id];
      if (!member) return label;
      if (result.designChecksAvailable === false) {
        const force = result.combos[view.combo]?.ef?.get(member.e)?.f;
        if (!force) return label;
        const axial = Math.max(Math.abs(force[0]), Math.abs(force[6]));
        return [label, "|N| " + axial.toFixed(1) + " kN"].join(" · ");
      }
      return [label, (member.util * 100).toFixed(0) + "% utilization", member.gov]
        .filter(Boolean).join(" · ");
    }
    onHover?.(
      hit?.kind === "point"
        ? { p: hit.p, issue: hit.issue, role: hoverRole, stack: stackLabel }
        : null,
    );
    // The growth styles label the hovered point in the scene instead of a tooltip.
    const labelledInScene =
      hit?.kind === "point" &&
      isGrowthStyle(s.style) &&
      s.mode !== "multiplayer";
    canvas.title = labelledInScene
      ? ""
      : hit?.kind === "point" || hit?.kind === "bay"
        ? [
            hit.issue || `${hit.p.map((v) => v * CELL_SIZE).join(", ")} m`,
            stackLabel,
          ]
            .filter(Boolean)
            .join(" · ")
        : hit?.kind === "member"
          ? memberTitle(hit.id)
          : hit?.kind === "node"
            ? `Node ${hit.key}`
            : hit?.kind === "brace"
              ? (hit.issue ?? "Cycle panel bracing")
              : hit?.kind === "connection"
                ? [
                    "Connect member",
                    hit.memberId,
                    "end",
                    hit.end.toUpperCase(),
                  ].join(" ")
                : "";
    return hit;
  };

  // Stepping through overlapping targets. These listeners live here so the
  // picker owns its whole behaviour. The wheel listener is a capture listener on
  // the canvas, so it runs before OrbitControls' zoom; the key listener is a
  // capture listener on the window, so `[` and `]` are taken before the working
  // level shortcuts. Both do nothing unless the pointer is over a stack of two or
  // more growth targets, and the key listener removes itself once the canvas has
  // been detached from the document.
  const overStack = () => {
    const s = useGameStore.getState();
    return (
      !!s.chainStart &&
      s.mode !== "multiplayer" &&
      isGrowthStyle(s.style) &&
      stack.size >= 2
    );
  };
  const step = (delta: number) => {
    stack.step(delta);
    if (lastEvent) pick(lastEvent);
  };
  canvas.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      if (!e.deltaY || !overStack()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      step(e.deltaY > 0 ? 1 : -1);
    },
    { capture: true, passive: false },
  );
  canvas.addEventListener("pointerleave", () => stack.reset());
  const onKey = (e: KeyboardEvent) => {
    if (!canvas.isConnected) {
      window.removeEventListener("keydown", onKey, true);
      return;
    }
    if (
      (e.key !== "[" && e.key !== "]") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      !overStack()
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    step(e.key === "]" ? 1 : -1);
  };
  window.addEventListener("keydown", onKey, true);
  return pick;
}
