import * as THREE from 'three';
import { useGameStore } from '../game/store';
import {
  nodeKey,
  parseNodeKey,
  type MemberType,
  type NodeItem,
  type Tool,
} from '../game/model';
import { MEMBER_TYPES } from '../game/inventory';
import type { SceneView } from './sceneView';
import type { BuildPlane } from './sceneGeometry';
import { createPicker } from './scenePicking';
import { selectedTurnCard } from './turnPicking';
export function bindSceneInteraction(
  canvas: HTMLCanvasElement,
  getCamera: () => THREE.Camera,
  terrain: THREE.Group,
  ghost: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
  preview: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  point: (key: string) => THREE.Vector3,
  getView: () => SceneView,
  rebuild: () => void,
) {
  let shiftDown = false;
  // The build plane follows the current camera when a member is being chained.
  const buildPlane = (): BuildPlane => {
    const s = useGameStore.getState(),
      start = s.chainStart ? parseNodeKey(s.chainStart) : null;
    if (s.style === 'levels' || s.style === 'blocks') return { axis: 'z', value: s.workK };
    if (!start || shiftDown)
      return { axis: 'z' as const, value: start ? start[2] : s.workK };
    const direction = new THREE.Vector3();
    getCamera().getWorldDirection(direction);
    return Math.abs(direction.x) > Math.abs(direction.y)
      ? { axis: 'x' as const, value: start[0] }
      : { axis: 'y' as const, value: start[1] };
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
  );
  let down: { x: number; y: number; button: number } | null = null;
  const move = (e: PointerEvent) => pick(e);
  const up = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      down = null;
      return;
    }
    const button = down.button;
    down = null;
    const s = useGameStore.getState();
    if (button === 2) {
      s.setChainStart(null);
      return;
    }
    if (button !== 0) return;
    const hit = pick(e);
    const card = selectedTurnCard(s);
    if (s.mode === 'multiplayer') {
      let issue: string | null = null;
      if (card?.kind === 'connection' && hit?.kind === 'connection')
        issue = s.playConnection(card.id, hit.memberId, hit.end, hit.key);
      else if (card && hit?.kind === 'point') {
        issue = hit.issue;
        if (!issue && card.kind === 'load') issue = s.toggleAttr(hit.p, 'load');
        else if (!issue && card.kind === 'element') {
          if (s.chainStart) issue = s.addMember(parseNodeKey(s.chainStart), hit.p, card.type);
          else s.setChainStart(nodeKey(...hit.p));
        }
      } else if (!card) {
        s.setSelected(hit?.kind === 'member' ? { type: 'member', id: hit.id } : hit?.kind === 'node' ? { type: 'node', key: hit.key } : null);
      }
      getView().onMessage?.(issue ?? '');
    } else if (s.tool === 'inspect')
      s.setSelected(
        hit?.kind === 'member'
          ? { type: 'member', id: hit.id }
          : hit?.kind === 'node'
            ? { type: 'node', key: hit.key }
            : null,
      );
    else if (s.tool === 'delete') {
      if (hit?.kind === 'member') {
        s.removeMember(hit.id);
        getView().onMessage?.('');
      } else if (hit?.kind === 'node') {
        if (s.model.attrs[hit.key]?.locked && !s.model.attrs[hit.key]?.joint)
          getView().onMessage?.(
            s.model.attrs[hit.key]?.target
              ? 'Challenge weights cannot be removed.'
              : 'Abutment bearings cannot be removed.',
          );
        else {
          s.removeNodeAttrs(hit.key);
          getView().onMessage?.('');
        }
      }
    } else if (s.tool === 'swap' && hit?.kind === 'member') {
      const member = s.model.members.find((m) => m.id === hit.id);
      if (member) {
        if (e.shiftKey) {
          const count = s.swapAllOfType(member.type, s.swapTarget);
          getView().onMessage?.(
            count
              ? `Swapped ${count} member${count === 1 ? '' : 's'}.`
              : 'No members could be swapped; check the target section and supply.',
          );
        } else getView().onMessage?.(s.swapMember(hit.id, s.swapTarget) ?? '');
      }
    } else if (hit?.kind === 'bay') {
      getView().onMessage?.(hit.issue ?? s.addBay(hit.p, hit.size, hit.type) ?? '');
    } else if (hit?.kind === 'point' && hit.issue)
      getView().onMessage?.(hit.issue);
    else if (hit?.kind === 'point' && !hit.issue) {
      if (MEMBER_TYPES.includes(s.tool as MemberType)) {
        const issue = s.chainStart ? s.addMember(parseNodeKey(s.chainStart), hit.p, s.tool as MemberType) : null;
        getView().onMessage?.(issue ?? '');
        if (!issue) s.setChainStart(nodeKey(...hit.p));
      } else
        getView().onMessage?.(s.toggleAttr(hit.p, s.tool as NodeItem) ?? '');
    }
    pick(e);
  };
  const pointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, button: e.button };
  };
  const leave = () => {
    ghost.visible = false;
    preview.visible = false;
  };
  const context = (e: Event) => e.preventDefault();
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Shift' && !shiftDown) {
      shiftDown = true;
      rebuild();
    }
    if ((e.target as HTMLElement)?.matches('input, select, textarea')) return;
    const s = useGameStore.getState();
    if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey)
      getView().onToggleLoadPath?.();
    else if (e.key === 'Escape') s.setChainStart(null);
    else if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const tools: Tool[] = [
        'inspect',
        'delete',
        'swap',
        'shs',
        'glulam',
        'ipe',
        'heb',
        'cable',
        'joint',
        'found',
      ];
      const tool = tools[(Number(e.key) + 9) % 10];
      if (tool) s.setTool(tool);
    } else if (e.key === '[') s.setWorkK(s.workK - 1);
    else if (e.key === ']') s.setWorkK(s.workK + 1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      s.undo();
    } else if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      s.selected?.type === 'member'
    ) {
      e.preventDefault();
      s.removeMember(s.selected.id);
    }
  };
  const keyup = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      shiftDown = false;
      rebuild();
    }
  };
  window.addEventListener('keyup', keyup);
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('contextmenu', context);
  window.addEventListener('keydown', keydown);
  return {
    buildPlane,
    clearPreview: leave,
    dispose() {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('contextmenu', context);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    },
  };
}
