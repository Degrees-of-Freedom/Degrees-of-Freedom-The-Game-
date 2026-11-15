import * as THREE from "three";
import { controlOwnsKey } from "./keyboardTarget";
import { useGameStore } from "../game/store";
import {
  nodeKey,
  parseNodeKey,
  type MemberType,
  type NodeItem,
  type Tool,
} from "../game/model";
import { MEMBER_TYPES } from "../game/inventory";
import type { SceneHover, SceneView } from "./sceneView";
import type { BuildPlane } from "./sceneGeometry";
import { createPicker } from "./scenePicking";
import { selectedTurnCard } from "./turnPicking";
import { targetCoordinate } from "../game/turnPorts";
import { isGrowthStyle } from "./sceneStyle";
export function bindSceneInteraction(
  canvas: HTMLCanvasElement,
  getCamera: () => THREE.Camera,
  terrain: THREE.Group,
  ghost: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
  preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  point: (key: string) => THREE.Vector3,
  getView: () => SceneView,
  rebuild: () => void,
  getCameraActions: () => { fit(): void; orbit(step: number): void },
  onHover?: (hover: SceneHover | null) => void,
) {
  let shiftDown = false;
  // The build plane follows the current camera when a member is being chained.
  const buildPlane = (): BuildPlane => {
    const s = useGameStore.getState(),
      start = s.chainStart ? parseNodeKey(targetCoordinate(s.model.members, s.chainStart)) : null;
    if (s.style === "levels" || s.style === "blocks")
      return { axis: "z", value: s.workK };
    if (!start || shiftDown)
      return { axis: "z" as const, value: start ? start[2] : s.workK };
    const direction = new THREE.Vector3();
    getCamera().getWorldDirection(direction);
    return Math.abs(direction.x) > Math.abs(direction.y)
      ? { axis: "x" as const, value: start[0] }
      : { axis: "y" as const, value: start[1] };
  };
  const pick = createPicker(
    canvas,
    getCamera,
    terrain,
    ghost,
    preview,
    point,
    buildPlane,
    getView,
    onHover,
  );
  let down: { x: number; y: number; button: number; pointerId: number; alt: boolean; anchor?: string; started: boolean } | null = null;
  // Last pointer position over the canvas, so Delete can act on the hovered piece.
  let lastPointer: PointerEvent | null = null;
  let pointerInside = false;
  /** Right-click, Alt+click or Delete: take away the piece under the pointer. */
  const removeAt = (e: PointerEvent) => {
    const s = useGameStore.getState();
    const target = pick(e, "delete");
    if (target?.kind === "member") s.removeMember(target.id);
    else if (
      target?.kind === "node" &&
      (!s.model.attrs[target.key]?.locked || s.model.attrs[target.key]?.joint)
    ) {
      s.removeNodeAttrs(target.key);
    }
  };
  const moved = (e: PointerEvent, gesture: NonNullable<typeof down>) =>
    Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 5;
  const move = (e: PointerEvent) => {
    lastPointer = e;
    pointerInside = true;
    if (down?.pointerId === e.pointerId && down.anchor && !down.started && moved(e, down)) {
      down.started = true;
      useGameStore.getState().setChainStart(down.anchor);
    }
    pick(e);
  };
  const up = (e: PointerEvent) => {
    const gesture = down;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    down = null;
    const dragged = moved(e, gesture) || gesture.started;
    if (dragged && !gesture.anchor) return;
    const s = useGameStore.getState();
    if (dragged && gesture.anchor && !gesture.started) s.setChainStart(gesture.anchor);
    const button = gesture.button;
    if (button === 2 || (button === 0 && gesture.alt)) {
      if (s.chainStart || s.mode === "multiplayer") s.setChainStart(null);
      else removeAt(e);
      return;
    }
    if (button !== 0) return;
    const hit = pick(e);
    const card = selectedTurnCard(s);
    const buildingMember = MEMBER_TYPES.includes(s.tool as MemberType);
    if (s.mode !== "multiplayer" && buildingMember && s.style === "levels" && e.shiftKey && hit?.kind === "point") {
      const [i, j, k] = hit.p;
      const issue = k === 0
        ? "There is no level below the board."
        : s.addMember(hit.p, [i, j, k - 1], s.tool as MemberType);
      getView().onMessage?.(issue ?? "");
      pick(e);
      return;
    }
    if (s.mode !== "multiplayer" && buildingMember && (isGrowthStyle(s.style) || s.style === "levels")) {
      const start = useGameStore.getState().chainStart;
      if (!hit || (hit.kind === "point" && start === nodeKey(...hit.p))) {
        s.setChainStart(null);
        pick(e);
        return;
      }
      if (dragged && hit.kind !== "point") return;
    }
    if (s.mode === "multiplayer") {
      let issue: string | null = null;
      if (card?.kind === "connection" && hit?.kind === "connection")
        issue = s.playConnection(card.id, hit.memberId, hit.end, hit.key);
      else if (card && hit?.kind === "point") {
        issue = hit.issue;
        const target = hit.target ?? nodeKey(...hit.p);
        if (!issue && card.kind === "load") issue = s.playLoad(card.id, target);
        else if (!issue && card.kind === "element") {
          if (s.chainStart)
            issue = s.playElement(card.id, s.chainStart, target);
          else s.setChainStart(target);
        }
      } else if (!card) {
        s.setSelected(
          hit?.kind === "member"
            ? { type: "member", id: hit.id }
            : hit?.kind === "node"
              ? { type: "node", key: hit.key }
              : null,
        );
      }
      getView().onMessage?.(issue ?? "");
    } else if (s.mode === "creative" && s.tool === "found") {
      if (hit?.kind === "point") {
        const issue = s.placeFoundation(hit.p);
        getView().onMessage?.(issue ?? "");
      } else getView().onMessage?.("Choose a solid ground point on the board.");
    } else if (s.tool === "inspect")
      s.setSelected(
        hit?.kind === "member"
          ? { type: "member", id: hit.id }
          : hit?.kind === "node"
            ? { type: "node", key: hit.key }
            : null,
      );
    else if (s.tool === "delete") {
      if (hit?.kind === "member") {
        s.removeMember(hit.id);
        getView().onMessage?.("");
      } else if (hit?.kind === "node") {
        if (s.model.attrs[hit.key]?.locked && !s.model.attrs[hit.key]?.joint)
          getView().onMessage?.(
            s.model.attrs[hit.key]?.target
              ? "Challenge weights cannot be removed."
              : "Abutment bearings cannot be removed.",
          );
        else {
          s.removeNodeAttrs(hit.key);
          getView().onMessage?.("");
        }
      }
    } else if (s.tool === "swap" && hit?.kind === "member") {
      const member = s.model.members.find((m) => m.id === hit.id);
      if (member) {
        if (e.shiftKey) {
          const count = s.swapAllOfType(member.type, s.swapTarget);
          getView().onMessage?.(
            count
              ? `Swapped ${count} member${count === 1 ? "" : "s"}.`
              : "No members could be swapped; check the target section and supply.",
          );
        } else getView().onMessage?.(s.swapMember(hit.id, s.swapTarget) ?? "");
      }
    } else if (
      hit?.kind === "point" &&
      s.style !== "engineering" &&
      ((s.tool === "load" && s.model.attrs[nodeKey(...hit.p)]?.load) ||
        s.tool === "joint" ||
        s.tool === "found")
    ) {
      const key = nodeKey(...hit.p);
      if (!hit.issue || s.model.attrs[key]) {
        s.setSelected({ type: "node", key });
        getView().onMessage?.("");
      } else getView().onMessage?.(hit.issue);
    } else if (hit?.kind === "brace") {
      getView().onMessage?.(
        hit.issue ?? s.cycleBrace(hit.face) ?? "",
      );
    } else if (hit?.kind === "bay") {
      getView().onMessage?.(
        hit.issue ?? s.addBay(hit.p, hit.size, hit.type) ?? "",
      );
    } else if (hit?.kind === "point" && hit.issue)
      getView().onMessage?.(hit.issue);
    else if (hit?.kind === "point" && !hit.issue) {
      if (MEMBER_TYPES.includes(s.tool as MemberType)) {
        const start = useGameStore.getState().chainStart;
        const issue = start
          ? s.addMember(parseNodeKey(start), hit.p, s.tool as MemberType)
          : null;
        getView().onMessage?.(issue ?? "");
        if (!issue) s.setChainStart(nodeKey(...hit.p));
      } else {
        const issue = s.toggleAttr(hit.p, s.tool as NodeItem);
        if (!issue && s.style !== "engineering" && s.tool === "load")
          s.setSelected({ type: "node", key: nodeKey(...hit.p) });
        getView().onMessage?.(issue ?? "");
      }
    }
    pick(e);
  };
  const pointerDown = (e: PointerEvent) => {
    if (down) return;
    down = { x: e.clientX, y: e.clientY, button: e.button, pointerId: e.pointerId, alt: e.altKey, started: false };
    const s = useGameStore.getState();
    if (e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || s.mode === "multiplayer" ||
      !isGrowthStyle(s.style) || !MEMBER_TYPES.includes(s.tool as MemberType)) return;
    const hit = pick(e);
    if (hit?.kind !== "point" || hit.issue && !s.chainStart) return;
    const rect = canvas.getBoundingClientRect();
    const projected = new THREE.Vector3().copy(point(nodeKey(...hit.p))).project(getCamera());
    const px = rect.left + (projected.x + 1) * rect.width / 2;
    const py = rect.top + (1 - projected.y) * rect.height / 2;
    if (Math.hypot(e.clientX - px, e.clientY - py) > 15) return;
    down.anchor = s.chainStart ?? nodeKey(...hit.p);
    canvas.setPointerCapture(e.pointerId);
    // Reserve anchor drags for building. Empty-space and secondary drags
    // continue to reach OrbitControls.
    e.stopImmediatePropagation();
  };
  const cancelPointer = (e: PointerEvent) => {
    if (down?.pointerId !== e.pointerId) return;
    if (down.started) useGameStore.getState().setChainStart(null);
    down = null;
  };
  const clearPreview = () => {
    ghost.visible = false;
    preview.visible = false;
    onHover?.(null);
  };
  const leave = () => {
    pointerInside = false;
    clearPreview();
  };
  const context = (e: Event) => e.preventDefault();
  const keydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || controlOwnsKey(e.target)) return;
    if (e.key === "Shift" && !shiftDown) {
      shiftDown = true;
      rebuild();
    }
    const s = useGameStore.getState();
    const key = e.key.toLowerCase();
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (["f", "q", "e", "pageup", "pagedown"].includes(key) || s.style === "levels" && ["w", "s"].includes(key) || s.style === "kit" && ["a", "d"].includes(key))
    ) {
      e.preventDefault();
      if (key === "f") getCameraActions().fit();
      else if (key === "q" || key === "e" || key === "a" || key === "d")
        getCameraActions().orbit(key === "q" || key === "a" ? -1 : 1);
      else s.setWorkK(s.workK + (key === "pageup" || key === "w" ? 1 : -1));
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && s.style !== "engineering" && ["x", "i", "1", "2", "3", "4"].includes(key)) {
      const tools: Partial<Record<string, Tool>> = s.style === "blocks"
        ? { "1": "shs", "2": "brace", "3": "joint", "4": "load", x: "delete", i: "inspect" }
        : { "1": "shs", "2": "joint", "3": "load", x: "delete", i: "inspect" };
      const tool = tools[key];
      if (tool) {
        // As in the prototype, changing tool lets go of the selected joint or load.
        if (isGrowthStyle(s.style) && s.mode !== "multiplayer") s.setSelected(null);
        s.setTool(tool);
      }
    } else if (e.key.toLowerCase() === "l" && !e.ctrlKey && !e.metaKey)
      getView().onToggleLoadPath?.();
    else if (e.key === "Escape") s.setChainStart(null);
    else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const tools: Tool[] = [
        "inspect",
        "delete",
        "swap",
        "shs",
        "glulam",
        "ipe",
        "heb",
        "cable",
        "joint",
        "found",
      ];
      const tool = tools[(Number(e.key) + 9) % 10];
      if (tool) s.setTool(tool);
    } else if (e.key === "[") s.setWorkK(s.workK - 1);
    else if (e.key === "]") s.setWorkK(s.workK + 1);
    else if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) s.redo();
      else s.undo();
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      s.selected?.type === "member"
    ) {
      e.preventDefault();
      s.removeMember(s.selected.id);
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      isGrowthStyle(s.style) &&
      s.mode !== "multiplayer" &&
      !s.chainStart &&
      pointerInside &&
      lastPointer
    ) {
      // As in the prototype: point at a piece and press Delete.
      e.preventDefault();
      removeAt(lastPointer);
    }
  };
  const keyup = (e: KeyboardEvent) => {
    if (e.key === "Shift") {
      shiftDown = false;
      rebuild();
    }
  };
  window.addEventListener("keyup", keyup);
  canvas.addEventListener("pointerdown", pointerDown, true);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("contextmenu", context);
  window.addEventListener("keydown", keydown);
  return {
    buildPlane,
    clearPreview,
    dispose() {
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancelPointer);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("contextmenu", context);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    },
  };
}
