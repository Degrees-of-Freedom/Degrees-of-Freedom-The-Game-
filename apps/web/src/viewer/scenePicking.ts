import * as THREE from "three";
import { controlOwnsKey } from "./keyboardTarget";
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
import { assemblyParts } from "../game/assembly";
import { loadTargets, portLabel, targetCoordinate } from "../game/turnPorts";
import { isReleaseCatalogue } from "../game/cardCatalogue";
import { placementCandidates, placementFromTip, type ElementPlacement } from "../game/cantileverPlacement";
import { attachmentLabel, attachmentQuarter } from "../game/attachmentSites";
import {
  selectedTurnCard,
  turnConnectionTargets,
  turnPointPorts,
  turnPointIssue,
  type ConnectionTarget,
} from "./turnPicking";
import type { SceneHover, SceneView } from "./sceneView";

type Hit =
  | BayHit
  | { kind: "brace"; face: BayFace; issue: string | null }
  | ({ kind: "connection" } & ConnectionTarget)
  | { kind: "point"; p: GridPoint; issue: string | null; target?: string }
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
    const portStack = buildStack(turnPointPorts(s).filter(port => port.available).flatMap(port => {
      const [sx, sy, depth] = screen(basePoint(port.point.join(",")));
      const distance = Math.hypot(sx - x, sy - y);
      if (port.id === s.chainStart || depth < -1 || depth >= 1 || distance > Math.min(13, nodeDistance + 1)) return [];
      return [{ item: port, depth, dist: distance, sx, sy }];
    }), 14);
    let nearMember: number | null = null,
      memberDistance = 9;
    function considerMember(id: number, start: THREE.Vector3, end: THREE.Vector3) {
      const a = screen(start),
        b = screen(end),
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
        nearMember = id;
        memberDistance = d;
      }
    }
    for (const m of s.model.members) {
      if (m.assembly) {
        for (const piece of assemblyParts(m))
          considerMember(m.id, basePoint(piece.a.point.join(",")), basePoint(piece.b.point.join(",")));
      } else considerMember(m.id, point(m.a), point(m.b));
    }
    let hit: Hit = null;
    let turnPreview: ElementPlacement | undefined;
    let stackLabel = "";
    let hoverRole: SceneHover["role"] = null;
    ghost.visible = false;
    preview.visible = false;
    if (card?.kind === "connection") {
      const candidates: StackCandidate<ConnectionTarget>[] = [];
      for (const target of turnConnectionTargets(s)) {
        const member = s.model.members.find(({ id }) => id === target.memberId);
        if (!member) continue;
        // Offset along the member so coincident ends can be picked individually.
        const endpoint = memberEndPosition(point, member, target.end);
        const [sx, sy, depth] = screen(endpoint);
        const distance = Math.hypot(sx - x, sy - y);
        if (depth >= -1 && depth < 1)
          candidates.push({ item: target, sx, sy, depth, dist: distance });
      }
      const choices = buildStack(candidates, 19);
      if (choices.length) {
        const choice = stack.choose(choices.map(({ item }) => `${item.memberId}:${item.end}:${item.key}`), card.id);
        const target = choices[choice].item;
        const member = s.model.members.find(({ id }) => id === target.memberId)!;
        hit = { kind: "connection", ...target };
        ghost.position.copy(memberEndPosition(point, member, target.end));
        ghost.material.color.set("#f6ad49");
        ghost.visible = true;
        if (choices.length > 1) stackLabel = `${choice + 1}/${choices.length}, [ or ] to cycle`;
      } else stack.reset();
    } else if (card?.kind === "load" && s.turn && isReleaseCatalogue(s.turn.catalogue)) {
      const candidates = buildStack(loadTargets(s.turn).flatMap(target => {
        const [sx, sy, depth] = screen(basePoint(target.point));
        const dist = Math.hypot(sx - x, sy - y);
        return depth >= -1 && depth < 1 ? [{ item: target, sx, sy, depth, dist }] : [];
      }), 18);
      if (candidates.length) {
        const index = stack.choose(candidates.map(c => c.item.id), card.id);
        const target = candidates[index].item;
        hit = { kind: "point", p: parseNodeKey(target.point), issue: null, target: target.id };
        stackLabel = target.label + (candidates.length > 1 ? ` · ${index+1}/${candidates.length}, [ or ] to cycle` : "");
        ghost.position.copy(basePoint(target.point));
        ghost.material.color.set("#f6ad49");
        ghost.visible = true;
      } else stack.reset();
    } else if (portStack.length) {
      const choice = stack.choose(portStack.map(x => x.item.id), s.chainStart);
      const port = portStack[choice].item;
      const issue = turnPointIssue(s, port.point, port.id);
      hit = { kind: "point", p: port.point, issue, target: port.id };
      stackLabel = portLabel(port) + (portStack.length > 1 ? ` · ${choice + 1}/${portStack.length} overlapping, [ or ] to cycle` : "");
      ghost.position.set(...port.point).multiplyScalar(CELL_SIZE);
      ghost.material.color.set(issue ? "#e75151" : "#f6ad49");
      ghost.visible = true;
      if (s.chainStart && card?.kind === "element") {
        const anchor = basePoint(targetCoordinate(s.model.members, s.chainStart));
        preview.geometry.dispose();
        preview.geometry = new THREE.BufferGeometry().setFromPoints([anchor, ghost.position]);
        preview.material.color.copy(ghost.material.color);
        preview.visible = true;
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
      const start = s.chainStart ? parseNodeKey(targetCoordinate(s.model.members, s.chainStart)) : null,
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
        if (s.mode === "creative" && tool === "found") {
          // The diorama surface sits slightly below the physical grid.
          // Require a land hit and snap at its structural elevation, even
          // when the active member-construction plane is several levels up.
          intersection = terrainHit
            ? ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1),
                -Math.round(terrainHit.point.z / CELL_SIZE) * CELL_SIZE), new THREE.Vector3())
            : null;
        } else if (
          terrainHit &&
          (!intersection ||
            terrainHit.point.distanceTo(ray.ray.origin) <
              intersection.distanceTo(ray.ray.origin))
        )
          intersection = terrainHit.point;
      }
      const isGrowing = !!start && isMember && !card && isGrowthStyle(s.style);
      if (!isGrowing && !(card?.kind === "element" && s.chainStart)) stack.reset();
      const reachable = isGrowing ? closestGrowthTarget() : null;
      const turnCandidates = card?.kind === "element" && s.chainStart ? buildStack(placementCandidates(s).flatMap(candidate => {
        const [sx, sy, depth] = screen(basePoint(candidate.point.join(",")));
        const dist = Math.hypot(sx - x, sy - y);
        return depth >= -1 && depth < 1 ? [{item: candidate, sx, sy, depth, dist}] : [];
      }), 14) : [];
      const turnCandidate = turnCandidates.length ? turnCandidates[stack.choose(turnCandidates.map(c => c.item.key), s.chainStart)].item : undefined;
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
      } else if (reachable || turnCandidate || (!isGrowing && (intersection || nearNode))) {
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
            : turnCandidate
              ? [...turnCandidate.point]
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
            ? turnPointIssue(s, p, turnCandidate?.key)
            : isMember
              ? start
                ? memberIssue(level, s.model, start, p, tool as MemberType)
                : remaining(level, s.model, tool as MemberType) <= 0
                  ? "No items left in supply"
                  : null
              : nodeItemIssue(level, s.model, p, tool as NodeItem);
          hit = { kind: "point", p, issue, ...(turnCandidate && {target: turnCandidate.key}) };
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
      if (!result || result.error) return label;
      const member = result.members[id];
      if (!member) return label;
      if (result.designChecksAvailable === false) {
        const force = result.combos[view.combo]?.ef?.get(member.e)?.f;
        if (!force) return label;
        const axial = Math.max(Math.abs(force[0]), Math.abs(force[6]));
        return [label, "|N| " + axial.toFixed(1) + " kN"].join(" · ");
      }
      if (member.gov === "Not assessed") return label;
      return [label, (member.util * 100).toFixed(0) + "% utilization", member.gov]
        .filter(Boolean).join(" · ");
    }
    // Draw the complete parent around its pinned support, including the arm
    // behind it. This same derivation is used by keyboard targeting and commit.
    if (card?.kind === "element" && s.chainStart && hit?.kind === "point") {
      const placement = placementFromTip(s, hit.p, hit.target);
      if (!("issue" in placement)) {
        turnPreview = placement;
        const a = basePoint(targetCoordinate(s.model.members, placement.a));
        const b = basePoint(targetCoordinate(s.model.members, placement.b));
        const points = [a, b];
        for (const tip of [a, b]) {
          points.push(tip.clone().add(new THREE.Vector3(0, 0, -0.14)), tip.clone().add(new THREE.Vector3(0, 0, 0.14)));
          points.push(tip.clone().add(new THREE.Vector3(-0.14, 0, 0)), tip.clone().add(new THREE.Vector3(0.14, 0, 0)));
        }
        preview.geometry.dispose();
        preview.geometry = new THREE.BufferGeometry().setFromPoints(points);
        preview.material.color.set("#f6ad49"); preview.visible = true;
        const length = a.distanceTo(b), q = attachmentQuarter(s.attachmentSite) / 4;
        stackLabel = `${length.toFixed(2)} m total · ${(length*q).toFixed(2)} m / ${(length*(1-q)).toFixed(2)} m from attachment · free tips`;
      } else preview.visible = false;
    }
    onHover?.(
      hit?.kind === "point"
        ? { p: hit.p, issue: hit.issue, role: hoverRole, stack: stackLabel,
          ...(turnPreview && {span: {a: parseNodeKey(targetCoordinate(s.model.members, turnPreview.a)), b: parseNodeKey(targetCoordinate(s.model.members, turnPreview.b))}}) }
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
                    attachmentLabel(hit.end),
                    "→", hit.key, stackLabel,
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
      (s.mode === "multiplayer" || !!s.chainStart && isGrowthStyle(s.style)) &&
      stack.size >= 2
    );
  };
  const step = (delta: number) => {
    stack.step(delta);
    if (lastEvent) pick(lastEvent);
  };
  const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || !overStack()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      step(e.deltaY > 0 ? 1 : -1);
  };
  const leave = () => stack.reset();
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
  canvas.addEventListener("pointerleave", leave);
  const onKey = (e: KeyboardEvent) => {
    if (
      (e.key !== "[" && e.key !== "]") ||
      e.defaultPrevented || controlOwnsKey(e.target) ||
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
  return Object.assign(pick, { dispose() {
    canvas.removeEventListener("wheel", onWheel, true);
    canvas.removeEventListener("pointerleave", leave);
    window.removeEventListener("keydown", onKey, true);
  } });
}
