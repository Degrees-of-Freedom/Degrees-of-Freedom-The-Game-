import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMemberGeometryCache, type MemberGeometryCache } from './geometry';
import type { SegmentFlow } from './flow';
import { sceneFlow, sceneFlowPositions } from './renderingPolicy';
import { cycleTargetStackIndex, pickTargetStack, targetSalience, type SnapTarget } from './targets';
import type { MultiplayerViewData, SceneHandle, Vec3, ViewSelection } from './types';
import { familyLabel } from './viewModel';

export interface RendererCallbacks {
  onSelection(selection: ViewSelection): void;
  onTarget(target: SnapTarget): void;
  onFocus(text: string): void;
  onTargetFocus(id: string): void;
  onMode(mode: 'webgl' | 'projected'): void;
}
export interface RendererOptions {
  reducedMotion: boolean;
  paused: boolean;
  showFlow: boolean;
  showJoints: 'selected' | 'all' | 'off';
  sectionMode: 'readable' | 'true';
}
interface Projected { x: number; y: number; depth: number; visible: boolean }
interface TargetProjection extends Projected { item: SnapTarget; sx: number; sy: number; dist: number }
interface FlowTrack { flow: SegmentFlow; a: THREE.Vector3; b: THREE.Vector3 }
const palette = { member: '#d4bc8b', cable: '#83cdeb', 'spring-025': '#9adbb7', 'spring-05': '#cbabef' };
const axisColors = ['#f28e94', '#a5d995', '#8dbffc'];

/** A scene owns its GPU resources, event listeners and animation loop; nothing touches game state. */
export class MultiplayerSceneRenderer implements SceneHandle {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 500);
  private readonly controls: OrbitControls;
  private renderer: THREE.WebGLRenderer | null = null;
  private lostRenderer: THREE.WebGLRenderer | null = null;
  private readonly context: CanvasRenderingContext2D;
  private readonly world = new THREE.Group();
  private geometry: MemberGeometryCache = createMemberGeometryCache();
  private readonly sectionGeometries = new Map<string, MemberGeometryCache>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly ownedGeometry: THREE.BufferGeometry[] = [];
  private readonly cleanups: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly temp = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = { x: -10000, y: -10000 };
  private readonly startPointer = { x: 0, y: 0 };
  private readonly projected = new Map<string, Projected>();
  private targetProjections: TargetProjection[] = [];
  private targets: readonly SnapTarget[] = [];
  private flowTracks: FlowTrack[] = [];
  private memberMeshes: THREE.Mesh[] = [];
  private springPaths = new Map<string, readonly THREE.Vector3[]>();
  private data: MultiplayerViewData | null = null;
  private selection: ViewSelection = null;
  private width = 1;
  private height = 1;
  private frame = 0;
  private disposed = false;
  private paused = false;
  private hidden = false;
  private stackIndex = 0;
  private stackIdentity = '';
  private readonly pointers = new Set<number>();
  private gestureWasMultiTouch = false;
  private readonly salience = { opacity: 1, radius: 5 };
  private focusedTarget: string | null = null;
  private elapsed = 0;
  private lastTime = 0;
  private options: RendererOptions;
  private callbacks: RendererCallbacks;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlay: HTMLCanvasElement, options: RendererOptions, callbacks: RendererCallbacks) {
    this.options = options; this.callbacks = callbacks; this.paused = options.paused;
    const context = overlay.getContext('2d');
    if (!context) throw new Error('A 2D canvas is required for the accessible point overlay.');
    this.context = context;
    this.camera.up.set(0, 0, 1);
    this.scene.background = new THREE.Color('#111f27');
    this.scene.add(new THREE.HemisphereLight(0xd8efff, 0x433627, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(8, -6, 20); this.scene.add(light, this.world);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      callbacks.onMode('webgl');
    } catch {
      // Same camera/picking and canvas overlay remain usable on machines without WebGL.
      canvas.hidden = true; callbacks.onMode('projected');
    }
    this.controls = new OrbitControls(this.camera, overlay);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.minZoom = 0.25; this.controls.maxZoom = 12;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.listen(overlay, 'pointermove', (event: PointerEvent) => { const r = overlay.getBoundingClientRect(); this.pointer.x = event.clientX - r.left; this.pointer.y = event.clientY - r.top; });
    this.listen(overlay, 'pointerleave', () => { this.pointer.x = this.pointer.y = -10000; });
    this.listen(overlay, 'pointerdown', (event: PointerEvent) => { if (!this.pointers.size) this.gestureWasMultiTouch = false; this.pointers.add(event.pointerId); if (this.pointers.size > 1) this.gestureWasMultiTouch = true; this.startPointer.x = event.clientX; this.startPointer.y = event.clientY; overlay.focus({ preventScroll: true }); });
    this.listen(overlay, 'pointerup', (event: PointerEvent) => { this.pointers.delete(event.pointerId); if (!this.paused && event.button === 0 && !this.gestureWasMultiTouch && Math.hypot(event.clientX - this.startPointer.x, event.clientY - this.startPointer.y) < 6) this.pick(event); });
    this.listen(overlay, 'pointercancel', (event: PointerEvent) => { this.pointers.delete(event.pointerId); });
    this.listen(overlay, 'contextmenu', (event: Event) => event.preventDefault());
    this.listen(overlay, 'keydown', (event: KeyboardEvent) => this.key(event));
    this.listen(document, 'visibilitychange', () => { this.hidden = document.hidden; if (this.hidden) this.stop(); else this.start(); });
    this.listen(canvas, 'webglcontextlost', (event: Event) => { event.preventDefault(); this.lostRenderer = this.renderer; this.renderer = null; canvas.hidden = true; this.callbacks.onMode('projected'); });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(overlay.parentElement!);
    this.resize(); this.start();
  }

  private listen<E extends Event>(target: EventTarget, name: string, listener: (event: E) => void): void {
    const callback = listener as EventListener;
    target.addEventListener(name, callback); this.cleanups.push(() => target.removeEventListener(name, callback));
  }
  update(options: RendererOptions, callbacks: RendererCallbacks): void {
    if (this.disposed) return;
    const sectionsChanged = this.options.sectionMode !== options.sectionMode;
    this.options = options; this.callbacks = callbacks;
    if (sectionsChanged && this.data) this.setData(this.data);
    if (options.paused) this.pause(); else this.resume();
    this.renderOnce();
  }
  setSelection(selection: ViewSelection): void { if (this.disposed) return; this.selection = selection; if (this.paused) this.renderOnce(); }
  setTargets(targets: readonly SnapTarget[]): void {
    if (this.disposed) return;
    this.targets = targets;
    this.targetProjections = targets.map(item => ({ item, x: 0, y: 0, sx: 0, sy: 0, depth: 0, dist: Infinity, visible: false }));
    if (!targets.some(t => t.id === this.focusedTarget)) this.focusedTarget = null;
    this.stackIdentity = ''; this.stackIndex = 0;
    if (this.data) this.fit();
    if (this.paused) this.renderOnce();
  }
  focusTarget(id: string): void {
    if (this.disposed) return;
    this.focusedTarget = id;
    this.callbacks.onTargetFocus(id);
    const target = this.targets.find(t => t.id === id);
    if (target) this.callbacks.onFocus(this.targetLabel(target));
  }
  activateTarget(id: string): void { if (this.disposed || this.paused) return; const target = this.targets.find(t => t.id === id); if (target) this.callbacks.onTarget(target); }

  setData(data: MultiplayerViewData): void {
    if (this.disposed) return;
    const first = this.data === null;
    this.data = data;
    this.world.clear(); this.memberMeshes = []; this.springPaths.clear();
    this.geometry.dispose(); this.geometry = createMemberGeometryCache();
    this.sectionGeometries.forEach(cache => cache.dispose()); this.sectionGeometries.clear();
    for (const g of this.ownedGeometry) g.dispose(); this.ownedGeometry.length = 0;
    this.projected.clear();
    const material = (color: string) => {
      let mat = this.materials.get(color);
      if (!mat) { mat = new THREE.MeshStandardMaterial({ color, metalness: 0.22, roughness: 0.47 }); this.materials.set(color, mat); }
      return mat;
    };
    const up = new THREE.Vector3(0, 1, 0);
    for (const m of data.members) {
      const a = new THREE.Vector3(...m.start), b = new THREE.Vector3(...m.end);
      const length = a.distanceTo(b); if (!(length > 0)) continue;
      const scale = this.options.sectionMode === 'true' ? 1 : 1.2;
      let cache = this.geometry;
      if (m.section && m.section.width > 0 && m.section.depth > 0 && Number.isFinite(m.section.width) && Number.isFinite(m.section.depth)) {
        const key = `${m.section.width}:${m.section.depth}:${scale}`;
        let sized = this.sectionGeometries.get(key);
        if (!sized) { sized = createMemberGeometryCache({ memberWidth: m.section.width * scale, memberDepth: m.section.depth * scale, cableRadius: m.section.width * scale / 2 }); this.sectionGeometries.set(key, sized); }
        cache = sized;
      }
      const mesh = new THREE.Mesh(cache.get(m.family.startsWith('spring') ? 'spring' : m.family === 'cable' ? 'cable' : 'member', length), material(palette[m.family]));
      mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
      if (m.rollRadians && Number.isFinite(m.rollRadians)) mesh.rotateY(m.rollRadians);
      mesh.userData.memberId = m.id; this.world.add(mesh); this.memberMeshes.push(mesh);
      if (m.family.startsWith('spring')) {
        const direction = new THREE.Vector3(...m.end).sub(a).normalize();
        const perpendicular = direction.clone().cross(Math.abs(direction.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)).normalize();
        const other = perpendicular.clone().cross(direction).normalize();
        const path: THREE.Vector3[] = [];
        for (let sample = 0; sample <= 128; sample++) {
          const t = sample / 128, half = t < 0.5 ? t : 1 - t;
          const coil = Math.max(0, Math.min(1, (half - 0.06) / 0.36));
          const radius = half > 0.06 && half < 0.42 ? Math.min(0.16, length * 0.09) * Math.sin(Math.min(1, coil * 8, (1 - coil) * 8) * Math.PI / 2) : 0;
          path.push(new THREE.Vector3(...m.start).lerp(new THREE.Vector3(...m.end), t).addScaledVector(perpendicular, Math.cos(coil * Math.PI * 6) * radius).addScaledVector(other, Math.sin(coil * Math.PI * 6) * radius));
        }
        this.springPaths.set(m.id, path);
      }
    }
    const boardGeometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    for (let i = 0; i <= 15; i++) vertices.push(i, 0, -0.035, i, 15, -0.035, 0, i, -0.035, 15, i, -0.035);
    boardGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); this.ownedGeometry.push(boardGeometry);
    const boardLines = new THREE.LineSegments(boardGeometry, this.gridMaterial); this.world.add(boardLines);
    for (const joint of data.joints) {
      this.projected.set(joint.id, { x: 0, y: 0, depth: 0, visible: false });
      if (joint.foundationOwner) {
        // Only supplied setup bases are drawn. Safety overrides never create a base or prop.
        const geometry = new THREE.BoxGeometry(0.65, 0.65, 0.16); this.ownedGeometry.push(geometry);
        const base = new THREE.Mesh(geometry, material('#647b8b')); base.position.set(...joint.position); base.position.z -= 0.08; this.world.add(base);
      }
    }
    const flow = sceneFlow(data);
    const positions = sceneFlowPositions(data);
    this.flowTracks = flow.segments.flatMap(segment => {
      const a = positions.get(segment.a), b = positions.get(segment.b);
      return a && b ? [{ flow: segment, a: new THREE.Vector3(...a), b: new THREE.Vector3(...b) }] : [];
    });
    if (first) this.fit();
    if (this.paused) this.renderOnce();
  }
  private readonly gridMaterial = new THREE.LineBasicMaterial({ color: '#354d59', transparent: true, opacity: 0.55 });
  fit(): void {
    if (!this.data || this.disposed) return;
    const height = Math.max(3, ...this.data.members.flatMap(m => [m.start[2], m.end[2]]), ...this.targets.map(t => t.position[2]));
    this.controls.target.set(7.5, 7.5, height * 0.35);
    this.camera.position.set(27, -20, 25 + height * 0.3); this.camera.zoom = 1;
    this.camera.lookAt(this.controls.target); this.camera.updateMatrixWorld();
    // Fit all eight board/model corners in camera space, including horizontal 0..15 boundaries.
    let maxX = 1, maxY = 1;
    for (const x of [0, 15]) for (const y of [0, 15]) for (const z of [0, height]) {
      this.temp.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      maxX = Math.max(maxX, Math.abs(this.temp.x)); maxY = Math.max(maxY, Math.abs(this.temp.y));
    }
    const halfHeight = Math.max(maxY, maxX / (this.width / this.height)) * 1.18;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.right = halfHeight * this.width / this.height; this.camera.left = -this.camera.right;
    this.camera.updateProjectionMatrix(); this.controls.update();
    if (this.paused) this.renderOnce();
  }
  private resize(): void {
    const r = this.overlay.parentElement!.getBoundingClientRect();
    const oldAspect = this.width / this.height;
    this.width = Math.max(1, r.width); this.height = Math.max(1, r.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(this.width * ratio); this.overlay.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.renderer?.setSize(this.width, this.height, false);
    this.camera.right *= (this.width / this.height) / oldAspect; this.camera.left = -this.camera.right; this.camera.updateProjectionMatrix();
    if (this.data) this.fit();
  }
  private project(point: Vec3 | THREE.Vector3, into: Projected): void {
    if (point instanceof THREE.Vector3) this.temp.copy(point); else this.temp.set(...point);
    this.temp.project(this.camera);
    into.x = (this.temp.x + 1) * this.width / 2; into.y = (1 - this.temp.y) * this.height / 2; into.depth = this.temp.z;
    into.visible = this.temp.z >= -1 && this.temp.z <= 1;
  }
  private readonly p1: Projected = { x: 0, y: 0, depth: 0, visible: true };
  private readonly p2: Projected = { x: 0, y: 0, depth: 0, visible: true };
  private draw(): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.renderer) this.drawProjectedMembers();
    if (!this.data) return;
    const selectedMember = this.selection?.kind === 'member' ? this.data.members.find(m => m.id === this.selection!.id) : undefined;
    if (selectedMember) { ctx.strokeStyle = '#fff5b5'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); this.line(selectedMember.start, selectedMember.end); ctx.setLineDash([]); }
    for (const j of this.data.joints) {
      const point = this.projected.get(j.id)!; this.project(j.position, point);
      if (point.visible) {
        if (!this.renderer && j.foundationOwner) { ctx.fillStyle = '#71899b'; ctx.fillRect(point.x - 9, point.y - 4, 18, 8); }
        ctx.fillStyle = '#dce6eb'; ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fill();
        const selected = this.selection?.kind === 'node' && this.selection.id === j.id || selectedMember && (selectedMember.startNode === j.id || selectedMember.endNode === j.id);
        if (this.options.showJoints === 'all' || this.options.showJoints === 'selected' && selected) {
          // One compact screen-size glyph at the shared node. Axis labels encode global rotations.
          for (let axis = 0; axis < 3; axis++) {
            const x = point.x + (axis - 1) * 15, y = point.y - 15;
            ctx.strokeStyle = axisColors[axis]; ctx.fillStyle = axisColors[axis]; ctx.lineWidth = j.rotations?.[axis] ? 2.6 : 1;
            ctx.setLineDash(j.rotations?.[axis] ? [] : [2, 2]); ctx.beginPath(); ctx.arc(x, y, 6, -0.3, Math.PI * 1.6); ctx.stroke(); ctx.setLineDash([]);
            if (j.rotations?.[axis]) { ctx.beginPath(); ctx.moveTo(x - 4, y + 4); ctx.lineTo(x + 4, y - 4); ctx.stroke(); }
            else if (j.rotations) { ctx.beginPath(); ctx.moveTo(x + 2, y - 6); ctx.lineTo(x - 1, y - 3); ctx.lineTo(x - 3, y - 7); ctx.stroke(); }
            ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('XYZ'[axis], x, y - 9);
          }
          if (!j.rotations) { ctx.fillStyle = '#c5ccd0'; ctx.fillText('?', point.x + 24, point.y - 15); }
          if (j.overrides?.length) { ctx.fillStyle = '#ffc969'; ctx.font = 'bold 10px system-ui'; ctx.fillText('S', point.x + 25, point.y + 5); }
        }
        if (j.setupLocked) { ctx.fillStyle = '#e1c587'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('LOCK', point.x, point.y + 16); }
      }
    }
    if (this.options.showFlow) this.drawFlow();
    for (const target of this.targetProjections) {
      this.project(target.item.position, target); target.sx = target.x; target.sy = target.y;
      target.dist = Math.hypot(target.x - this.pointer.x, target.y - this.pointer.y);
      if (!target.visible) continue;
      const chosen = target.item.id === this.focusedTarget || this.selection?.kind === 'target' && this.selection.id === target.item.id;
      const salience = targetSalience(target.dist, chosen, this.salience);
      ctx.globalAlpha = salience.opacity; ctx.fillStyle = chosen ? '#fff4b5' : target.item.kind === 'quarter' ? '#eebbe5' : '#a8d4e6';
      ctx.beginPath(); ctx.arc(target.x, target.y, salience.radius, 0, Math.PI * 2); ctx.fill();
      if (chosen) { ctx.strokeStyle = '#fff4b5'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(target.x, target.y, salience.radius + 4, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  private drawProjectedMembers(): void {
    const ctx = this.context; ctx.fillStyle = '#111f27'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = '#354d59'; ctx.lineWidth = 1;
    for (let i = 0; i <= 15; i++) { this.line([i, 0, 0], [i, 15, 0]); this.line([0, i, 0], [15, i, 0]); }
    if (!this.data) return;
    for (const member of this.data.members) {
      ctx.strokeStyle = palette[member.family]; ctx.lineCap = 'round';
      if (member.family.startsWith('spring')) {
        ctx.lineWidth = 1.8; ctx.beginPath();
        const path = this.springPaths.get(member.id)!;
        for (let sample = 0; sample < path.length; sample++) {
          this.project(path[sample], this.p1); if (!sample) ctx.moveTo(this.p1.x, this.p1.y); else ctx.lineTo(this.p1.x, this.p1.y);
        }
        ctx.stroke();
      } else {
        ctx.lineWidth = member.family === 'cable' ? 1.8 : 7; this.line(member.start, member.end);
        if (member.family === 'member') { ctx.strokeStyle = '#f0dfb7'; ctx.lineWidth = 2; this.line(member.start, member.end); }
      }
    }
  }
  private line(a: Vec3, b: Vec3): void { this.project(a, this.p1); this.project(b, this.p2); this.context.beginPath(); this.context.moveTo(this.p1.x, this.p1.y); this.context.lineTo(this.p2.x, this.p2.y); this.context.stroke(); }
  private drawFlow(): void {
    const ctx = this.context;
    for (const track of this.flowTracks) {
      const flow = track.flow;
      if (flow.reason !== 'flow' && flow.reason !== 'ambiguous') continue;
      this.project(track.a, this.p1); this.project(track.b, this.p2);
      ctx.strokeStyle = flow.style === 'tension' ? '#7ccdf5' : flow.style === 'compression' ? '#f5a183' : '#e5c8fb'; ctx.lineWidth = 1.8;
      if (!flow.direction) {
        ctx.fillStyle = '#f4d58d'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('↔ ?', (this.p1.x + this.p2.x) / 2, (this.p1.y + this.p2.y) / 2 - 8); continue;
      }
      const dx = (this.p2.x - this.p1.x) * flow.direction, dy = (this.p2.y - this.p1.y) * flow.direction;
      const length = Math.hypot(dx, dy); if (length < 12) continue;
      const ux = dx / length, uy = dy / length;
      const count = length < 80 ? 1 : 3;
      for (let i = 0; i < count; i++) {
        const t = this.options.reducedMotion ? (i + 1) / (count + 1) : 0.12 + ((this.elapsed * 0.32 + i / count) % 1) * 0.76;
        const origin = flow.direction === 1 ? this.p1 : this.p2;
        const x = origin.x + dx * t, y = origin.y + dy * t;
        const size = 4 + 3 * flow.normalizedMagnitude;
        ctx.beginPath(); ctx.moveTo(x - ux * size - uy * size * 0.7, y - uy * size + ux * size * 0.7); ctx.lineTo(x, y); ctx.lineTo(x - ux * size + uy * size * 0.7, y - uy * size - ux * size * 0.7); ctx.stroke();
      }
    }
  }
  private targetLabel(target: SnapTarget): string { return `${target.kind} ${target.position.join(', ')}${target.parentId ? ` on ${target.parentId}` : ''}`; }
  private pick(event: PointerEvent): void {
    const r = this.overlay.getBoundingClientRect(); this.pointer.x = event.clientX - r.left; this.pointer.y = event.clientY - r.top;
    for (const t of this.targetProjections) t.dist = Math.hypot(t.sx - this.pointer.x, t.sy - this.pointer.y);
    const stack = pickTargetStack(this.targetProjections.filter(t => t.visible));
    if (stack.length) {
      const identity = stack.map(t => t.item.id).join('|'); if (identity !== this.stackIdentity) this.stackIndex = 0;
      this.stackIdentity = identity; this.stackIndex %= stack.length;
      const target = stack[this.stackIndex].item; this.focusTarget(target.id); this.callbacks.onSelection({ kind: 'target', id: target.id }); this.callbacks.onTarget(target); return;
    }
    const node = [...this.projected.entries()].filter(([, p]) => p.visible && Math.hypot(p.x - this.pointer.x, p.y - this.pointer.y) <= 11).sort((a, b) => a[1].depth - b[1].depth)[0];
    if (node) { this.callbacks.onSelection({ kind: 'node', id: node[0] }); return; }
    this.raycaster.setFromCamera(new THREE.Vector2(this.pointer.x / this.width * 2 - 1, 1 - this.pointer.y / this.height * 2), this.camera);
    const hit = this.raycaster.intersectObjects(this.memberMeshes)[0];
    if (hit) { this.callbacks.onSelection({ kind: 'member', id: String(hit.object.userData.memberId) }); return; }
    // Stable screen-space corridor also makes slender cable/spring picking practical.
    let closest: { id: string; distance: number; depth: number } | null = null;
    for (const m of this.data?.members ?? []) {
      this.project(m.start, this.p1); this.project(m.end, this.p2);
      const dx = this.p2.x - this.p1.x, dy = this.p2.y - this.p1.y;
      const t = Math.max(0, Math.min(1, ((this.pointer.x - this.p1.x) * dx + (this.pointer.y - this.p1.y) * dy) / (dx * dx + dy * dy || 1)));
      const distance = Math.hypot(this.pointer.x - this.p1.x - t * dx, this.pointer.y - this.p1.y - t * dy);
      if (distance <= 9 && (!closest || distance < closest.distance)) closest = { id: m.id, distance, depth: this.p1.depth };
    }
    this.callbacks.onSelection(closest ? { kind: 'member', id: closest.id } : null);
  }
  private key(event: KeyboardEvent): void {
    if (this.paused) return;
    if (event.key === 'f' || event.key === 'F') { event.preventDefault(); this.fit(); return; }
    if (event.key === 'Escape') { this.focusedTarget = null; this.callbacks.onSelection(null); return; }
    if (event.key === '[' || event.key === ']') {
      const stack = pickTargetStack(this.targetProjections.filter(t => t.visible));
      if (stack.length) { event.preventDefault(); const identity = stack.map(t => t.item.id).join('|'); if (identity !== this.stackIdentity) this.stackIndex = 0; this.stackIdentity = identity; this.stackIndex = cycleTargetStackIndex(this.stackIndex, stack.length, event.key === '[' ? -1 : 1); this.focusTarget(stack[this.stackIndex].item.id); } return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && this.targets.length) {
      event.preventDefault(); const current = this.targets.findIndex(t => t.id === this.focusedTarget);
      this.focusTarget(this.targets[cycleTargetStackIndex(current, this.targets.length, event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)].id); return;
    }
    if (event.key === 'Enter' && this.focusedTarget) { event.preventDefault(); this.activateTarget(this.focusedTarget); }
  }
  private tick = (time: number): void => {
    this.frame = 0;
    if (this.disposed || this.paused || this.hidden) return;
    this.elapsed += this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0; this.lastTime = time;
    this.controls.update(); this.camera.updateMatrixWorld(); this.renderer?.render(this.scene, this.camera); this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };
  private renderOnce(): void { if (!this.data || this.disposed) return; this.camera.updateMatrixWorld(); this.renderer?.render(this.scene, this.camera); this.draw(); }
  private start(): void { if (!this.frame && !this.disposed && !this.paused && !this.hidden) this.frame = requestAnimationFrame(this.tick); }
  private stop(): void { cancelAnimationFrame(this.frame); this.frame = 0; this.lastTime = 0; }
  pause(): void { if (this.disposed) return; this.paused = true; this.controls.enabled = false; this.stop(); }
  resume(): void { if (this.disposed) return; this.paused = false; this.controls.enabled = true; this.start(); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.stop(); this.resizeObserver.disconnect(); this.cleanups.forEach(fn => fn()); this.controls.dispose();
    this.world.clear(); this.geometry.dispose(); this.sectionGeometries.forEach(cache => cache.dispose()); this.sectionGeometries.clear(); for (const g of this.ownedGeometry) g.dispose(); this.materials.forEach(m => m.dispose()); this.gridMaterial.dispose(); this.renderer?.dispose(); this.lostRenderer?.dispose();
    this.memberMeshes = []; this.flowTracks = []; this.targets = []; this.targetProjections = []; this.projected.clear(); this.springPaths.clear(); this.data = null;
  }
}
