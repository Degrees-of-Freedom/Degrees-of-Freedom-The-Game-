import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { VoxelAnalysis } from '../solver/voxel';
import { useGameStore } from '../game/store';
import { allNodeKeys, CELL_SIZE, groundK, ITEMS, LEVELS, MEMBER_TYPES, memberIssue, nodeItemIssue, nodeKey, parseNodeKey, terrainCell, type GridPoint, type MemberType, type NodeItem } from '../game/model';

export interface SceneView { result: VoxelAnalysis | null; combo: number; deformed: boolean; scale: number; utilization: boolean; loads: boolean }

/** Three.js owns only presentation and picking; the game store owns the model and rules. */
export function Scene({ result, combo, deformed, scale, utilization, loads }: SceneView) {
  const view = useRef<SceneView>({ result, combo, deformed, scale, utilization, loads });
  view.current = { result, combo, deformed, scale, utilization, loads };
  const refresh = useRef<() => void>(() => {});
  useEffect(() => { refresh.current(); }, [result, combo, deformed, scale, utilization, loads]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce3dd');
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 300); camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x62604d, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-20, -20, 40); scene.add(sun);
    const terrain = new THREE.Group(), structure = new THREE.Group(), guides = new THREE.Group(); scene.add(terrain, structure, guides);
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0x31aa78, depthTest: false })); scene.add(ghost); ghost.visible = false;
    const preview = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x31aa78, depthTest: false })); scene.add(preview); preview.visible = false;
    const dispose = (group: THREE.Group) => { group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } }); group.clear(); };
    type VisualResult = VoxelAnalysis & { ctx?: { keys:string[]; idx:Map<string,number>; act:number[]; aid:number[] }; combos: { fail?:boolean; u?:Float64Array; maxD?:number; vis?:{a:number;v:number[];kind:string}[]; reac?:Record<string,Float64Array> }[] };
    const basePoint = (key: string) => new THREE.Vector3(...parseNodeKey(key).map(v => v * CELL_SIZE) as GridPoint);
    const point = (key: string) => {
      const p = basePoint(key), v = view.current, result = v.result as VisualResult | null, c = result?.combos[v.combo], index = result?.ctx?.idx.get(key), active = index === undefined ? -1 : result?.ctx?.aid[index] ?? -1;
      if (v.deformed && c?.u && active >= 0) { const factor = Math.min(500, 1.2 / (c.maxD || 1)) * v.scale; p.add(new THREE.Vector3(c.u[active*6], c.u[active*6+1], c.u[active*6+2]).multiplyScalar(factor)); }
      return p;
    };
    let currentLevel = '';
    const rebuild = () => {
      const s = useGameStore.getState(), level = LEVELS[s.levelId];
      if (currentLevel !== s.levelId) {
        currentLevel = s.levelId; dispose(terrain);
        const size = CELL_SIZE;
        for (let i = 0; i < level.nx; i++) for (let j = 0; j < level.ny; j++) {
          const cell = terrainCell(level, i, j)!;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(size * .985, size * .985, (cell.h + 1) * size), new THREE.MeshStandardMaterial({ color: cell.water ? '#6094ab' : '#a2b89b', roughness: 1 }));
          mesh.position.set((i + .5) * size, (j + .5) * size, (cell.h - 1) * size / 2); terrain.add(mesh);
        }
        const bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(level.nx * size, level.ny * size, level.nz * size)), new THREE.LineBasicMaterial({ color: 0x849f91, transparent: true, opacity: .5 })); bounds.position.set(level.nx * size / 2, level.ny * size / 2, level.nz * size / 2); terrain.add(bounds);
        if (level.target) { const target = new THREE.Mesh(new THREE.PlaneGeometry(level.nx * size, level.ny * size), new THREE.MeshBasicMaterial({ color: 0xe8ba4b, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false })); target.position.set(level.nx * size / 2, level.ny * size / 2, level.target * size); terrain.add(target); }
        controls.target.set(level.nx * size / 2, level.ny * size / 2, 2); camera.position.set(level.nx * size * 1.3, -level.ny * size, level.nz * size * 1.1); controls.update();
      }
      dispose(structure); dispose(guides);
      const v = view.current, result = v.result as VisualResult | null, resultCombo = result?.combos[v.combo];
      for (const member of s.model.members) {
        const a = point(member.a), b = point(member.b), direction = b.clone().sub(a), length = direction.length();
        const width = member.type === 'cable' ? .06 : member.type === 'shs' ? .12 : member.type === 'glulam' ? .25 : .3;
        const u = result?.members[member.id]?.util; const color = v.utilization && result && !result.error ? (result.mechanism ? '#9b6bff' : u === undefined ? '#777777' : u > 1 ? '#ed4545' : u > .6 ? '#e5a33f' : '#4cae77') : ITEMS[member.type].color;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, length, width), new THREE.MeshStandardMaterial({ color, emissive: s.selected?.type === 'member' && s.selected.id === member.id ? 0x536b54 : 0x000000 }));
        mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); structure.add(mesh);
      }
      for (const key of allNodeKeys(s.model)) {
        const p = point(key), attrs = s.model.attrs[key] || {};
        const node = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 8), new THREE.MeshStandardMaterial({ color: s.selected?.type === 'node' && s.selected.key === key ? '#f0b84b' : '#edf1ed' })); node.position.copy(p); structure.add(node);
        if (attrs.joint) { const joint = new THREE.Mesh(new THREE.BoxGeometry(.42, .42, .42), new THREE.MeshStandardMaterial({ color: '#f39c34' })); joint.position.copy(p); structure.add(joint); }
        if (attrs.found) { const foundation = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, .6), new THREE.MeshStandardMaterial({ color: attrs.locked ? '#777771' : '#bdb8ae' })); foundation.position.copy(p).add(new THREE.Vector3(0, 0, -.3)); structure.add(foundation); }
        if (attrs.load) structure.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), p.clone().add(new THREE.Vector3(0, 0, 2)), 1.8, 0xe74e50, .5, .3));
      }
      if (v.loads && result?.ctx && resultCombo && !resultCombo.fail) {
        const ctx = result.ctx;
        for (const load of resultCombo.vis || []) { const key = ctx.keys[ctx.act[load.a]], dir = new THREE.Vector3(...load.v as GridPoint); if (!key || !dir.length()) continue; dir.normalize(); const p = point(key), length = 1.5; structure.add(new THREE.ArrowHelper(dir,p.clone().addScaledVector(dir,-length),length,load.kind === 'Q' ? 0xe74e50 : 0x58aacf,.4,.22)); }
        for (const [a, reaction] of Object.entries(resultCombo.reac || {})) { const key = ctx.keys[ctx.act[Number(a)]], dir = new THREE.Vector3(reaction[0],reaction[1],reaction[2]); if (!key || dir.length() < .5) continue; dir.normalize(); const p = basePoint(key), length = 1.5; structure.add(new THREE.ArrowHelper(dir,p.clone().addScaledVector(dir,-length),length,0x3aab72,.4,.22)); }
      }
      const z = s.workK * CELL_SIZE, pts: THREE.Vector3[] = [];
      for (let i = 0; i <= level.nx; i++) pts.push(new THREE.Vector3(i * CELL_SIZE, 0, z), new THREE.Vector3(i * CELL_SIZE, level.ny * CELL_SIZE, z));
      for (let j = 0; j <= level.ny; j++) pts.push(new THREE.Vector3(0, j * CELL_SIZE, z), new THREE.Vector3(level.nx * CELL_SIZE, j * CELL_SIZE, z));
      guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x759b96, transparent: true, opacity: .45 })));
    };
    refresh.current = rebuild; rebuild(); const unsubscribe = useGameStore.subscribe(rebuild);
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down: { x: number; y: number; button: number } | null = null;
    type Hit = { kind: 'point'; p: GridPoint; issue: string | null } | { kind: 'member'; id: number } | { kind: 'node'; key: string } | null;
    let hit: Hit = null;
    const pick = (e: PointerEvent) => {
      const s = useGameStore.getState(), level = LEVELS[s.levelId], rect = renderer.domElement.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      const screen = (v: THREE.Vector3) => { const p = v.clone().project(camera); return [(p.x + 1) * rect.width / 2, (1 - p.y) * rect.height / 2, p.z]; };
      let nearNode: string | null = null, nodeDistance = 14;
      for (const key of allNodeKeys(s.model)) { const p = screen(point(key)), d = Math.hypot(p[0] - x, p[1] - y); if (p[2] < 1 && d < nodeDistance) { nearNode = key; nodeDistance = d; } }
      let nearMember: number | null = null, memberDistance = 9;
      for (const m of s.model.members) { const a = screen(point(m.a)), b = screen(point(m.b)), dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy || 1))), d = Math.hypot(a[0]+t*dx-x,a[1]+t*dy-y); if (a[2] < 1 && b[2] < 1 && d < memberDistance) { nearMember = m.id; memberDistance = d; } }
      hit = null; ghost.visible = false; preview.visible = false;
      if (s.tool === 'inspect' || s.tool === 'delete' || s.tool === 'swap') {
        if (nearNode && s.tool !== 'swap' && (s.tool === 'inspect' || s.model.attrs[nearNode])) hit = { kind: 'node', key: nearNode };
        else if (nearMember !== null) hit = { kind: 'member', id: nearMember };
      } else {
        ndc.set(x / rect.width * 2 - 1, -y / rect.height * 2 + 1); ray.setFromCamera(ndc, camera);
        const start = s.chainStart ? parseNodeKey(s.chainStart) : null;
        const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
        const normal = start && !e.shiftKey ? (Math.abs(dir.x) > Math.abs(dir.y) ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0)) : new THREE.Vector3(0,0,1);
        const offset = start && !e.shiftKey ? (normal.x ? start[0] : start[1]) : start && e.shiftKey ? start[2] : s.workK;
        const intersection = ray.ray.intersectPlane(new THREE.Plane(normal, -offset * CELL_SIZE), new THREE.Vector3());
        if (intersection) {
          const p: GridPoint = nearNode && nearNode !== s.chainStart ? parseNodeKey(nearNode) : [Math.max(0, Math.min(level.nx, Math.round(intersection.x/CELL_SIZE))), Math.max(0, Math.min(level.ny, Math.round(intersection.y/CELL_SIZE))), Math.max(0, Math.min(level.nz, Math.round(intersection.z/CELL_SIZE)))];
          p[2] = Math.max(p[2], groundK(level, p[0], p[1]));
          const isMember = MEMBER_TYPES.includes(s.tool as MemberType), issue = isMember ? (start ? memberIssue(level,s.model,start,p,s.tool as MemberType) : null) : nodeItemIssue(level,s.model,p,s.tool as NodeItem);
          hit = { kind: 'point', p, issue }; ghost.position.set(...p.map(v => v * CELL_SIZE) as GridPoint); ghost.material.color.set(issue ? 0xe75151 : 0x31aa78); ghost.visible = true;
          if (start && isMember) { preview.geometry.setFromPoints([point(s.chainStart!), ghost.position]); preview.material.color.copy(ghost.material.color); preview.visible = true; }
        }
      }
      renderer.domElement.title = hit?.kind === 'point' ? (hit.issue || `${hit.p.map(v => v * CELL_SIZE).join(', ')} m`) : hit?.kind === 'member' ? `Member ${hit.id}` : hit?.kind === 'node' ? `Node ${hit.key}` : '';
    };
    const move = (e: PointerEvent) => pick(e);
    const up = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX-down.x,e.clientY-down.y)>5) { down = null; return; }
      const button = down.button; down = null; const s = useGameStore.getState();
      if (button === 2) { s.setChainStart(null); return; } if (button !== 0) return; pick(e);
      if (s.tool === 'inspect') s.setSelected(hit?.kind === 'member' ? { type:'member', id:hit.id } : hit?.kind === 'node' ? { type:'node', key:hit.key } : null);
      else if (s.tool === 'delete') { if (hit?.kind === 'member') s.removeMember(hit.id); else if (hit?.kind === 'node') s.removeNodeAttrs(hit.key); }
      else if (s.tool === 'swap' && hit?.kind === 'member') { if (e.shiftKey) s.swapAllOfType(s.model.members.find(m => m.id === (hit as {kind: "member"; id: number}).id)!.type, s.swapTarget); else s.swapMember(hit.id,s.swapTarget); }
      else if (hit?.kind === 'point' && !hit.issue) { if (MEMBER_TYPES.includes(s.tool as MemberType)) { if (!s.chainStart || !s.addMember(parseNodeKey(s.chainStart),hit.p,s.tool as MemberType)) s.setChainStart(nodeKey(...hit.p)); } else s.toggleAttr(hit.p,s.tool as NodeItem); }
      pick(e);
    };
    const pointerDown = (e: PointerEvent) => { down = { x:e.clientX, y:e.clientY, button:e.button }; };
    const leave = () => { ghost.visible = false; preview.visible = false; };
    const context = (e: Event) => e.preventDefault();
    const keydown = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.matches('input, select, textarea')) return; const s=useGameStore.getState(); if(e.key==='Escape') s.setChainStart(null); else if(e.key==='[') s.setWorkK(s.workK-1); else if(e.key===']') s.setWorkK(s.workK+1); else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='z') { e.preventDefault(); s.undo(); } else if ((e.key==='Delete'||e.key==='Backspace') && s.selected?.type==='member') { e.preventDefault(); s.removeMember(s.selected.id); } };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointerleave', leave); renderer.domElement.addEventListener('contextmenu', context); window.addEventListener('keydown', keydown);
    const resize = () => { const {clientWidth:w,clientHeight:h}=element; if(w && h) { camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); } }; const observer = new ResizeObserver(resize); observer.observe(element); resize(); renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene,camera); });
    return () => { refresh.current = () => {}; unsubscribe(); observer.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); renderer.domElement.removeEventListener('pointerdown',pointerDown); renderer.domElement.removeEventListener('pointermove',move); renderer.domElement.removeEventListener('pointerup',up); renderer.domElement.removeEventListener('pointerleave',leave); renderer.domElement.removeEventListener('contextmenu',context); window.removeEventListener('keydown',keydown); dispose(terrain); dispose(structure); dispose(guides); ghost.geometry.dispose(); ghost.material.dispose(); preview.geometry.dispose(); preview.material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, []);
  return <div className="scene" ref={host} aria-label="3D workspace. Drag to orbit, scroll to zoom, and click to build." />;
}


