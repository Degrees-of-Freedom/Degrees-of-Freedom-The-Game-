import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { MultiplayerSceneRenderer } from './sceneRenderer';
import { generateTargets, type SnapTarget } from './targets';
import { sceneFlow } from './renderingPolicy';
import type { MultiplayerViewData, PlacementView, SceneHandle, ViewSafeZone, ViewSelection } from './types';
import { familyLabel, freshness } from './viewModel';
import './view.css';

export interface MultiplayerSceneProps {
  readonly data: MultiplayerViewData;
  readonly placement?: PlacementView;
  readonly selection: ViewSelection;
  readonly onSelectionChange: (selection: ViewSelection) => void;
  /** Selects a draft target, never commits a move. Canonical domain rules validate it. */
  readonly onTargetActivate?: (target: SnapTarget) => void;
  readonly reducedMotion?: boolean;
  readonly paused?: boolean;
  readonly onSafeZones?: (zones: readonly ViewSafeZone[]) => void;
  readonly onDispose?: () => void;
}

/** Standalone scene. No store, hidden solver, navigation or private hand is imported. */
export const MultiplayerScene = forwardRef<SceneHandle, MultiplayerSceneProps>(function MultiplayerScene({ data, placement, selection, onSelectionChange, onTargetActivate, reducedMotion, paused = false, onSafeZones, onDispose }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), toolbar = useRef<HTMLDivElement>(null);
  const engine = useRef<MultiplayerSceneRenderer | null>(null);
  const instructions = useId();
  const [mode, setMode] = useState<'webgl' | 'projected'>('webgl');
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [targetId, setTargetId] = useState('');
  const [showFlow, setShowFlow] = useState(true);
  const [showJoints, setShowJoints] = useState<'selected' | 'all' | 'off'>('selected');
  const [sectionMode, setSectionMode] = useState<'readable' | 'true'>('readable');
  const [systemReduced, setSystemReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const motionReduced = reducedMotion ?? systemReduced;
  const trueScaleAvailable = data.members.filter(m => m.family === 'member' || m.family === 'cable').every(m => m.section && m.section.width > 0 && m.section.depth > 0);
  const callbacks = useRef({ onSelectionChange, onTargetActivate, onDispose });
  callbacks.current = { onSelectionChange, onTargetActivate, onDispose };
  const targets = useMemo(() => placement ? generateTargets({ origin: placement.origin, bounds: data.board, maxLength: placement.maxLength,
    quarterPorts: placement.quarterPorts, isLegal: target => placement.isLegal?.(target.position, target.kind === 'quarter' ? target.id : undefined) ?? true }) : [], [placement, data.board]);
  const flow = useMemo(() => sceneFlow(data), [data]);
  const events = useMemo(() => ({
    onSelection: (value: ViewSelection) => callbacks.current.onSelectionChange(value),
    onTarget: (target: SnapTarget) => { setTargetId(target.id); callbacks.current.onTargetActivate?.(target); },
    onFocus: setAnnouncement, onTargetFocus: setTargetId, onMode: setMode,
  }), []);
  useImperativeHandle(ref, () => ({ fit: () => engine.current?.fit(), pause: () => engine.current?.pause(), resume: () => engine.current?.resume(), dispose: () => engine.current?.dispose() }), []);
  useEffect(() => {
    if (!canvas.current || !overlay.current) return;
    try { engine.current = new MultiplayerSceneRenderer(canvas.current, overlay.current, { reducedMotion: motionReduced, paused, showFlow, showJoints, sectionMode }, events); }
    catch (e) { setError(e instanceof Error ? e.message : 'Scene unavailable. Use the accessible element/target selectors.'); }
    return () => { engine.current?.dispose(); engine.current = null; callbacks.current.onDispose?.(); };
  }, []);
  useEffect(() => { engine.current?.setData(data); }, [data]);
  useEffect(() => { engine.current?.setTargets(targets); setTargetId(old => targets.some(t => t.id === old) ? old : ''); }, [targets]);
  useEffect(() => { engine.current?.setSelection(selection); }, [selection]);
  useEffect(() => { engine.current?.update({ reducedMotion: motionReduced, paused, showFlow, showJoints, sectionMode }, events); }, [motionReduced, paused, showFlow, showJoints, sectionMode, events]);
  useEffect(() => { const query = window.matchMedia?.('(prefers-reduced-motion: reduce)'); if (!query) return; const change = () => setSystemReduced(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  useEffect(() => { if (!trueScaleAvailable) setSectionMode('readable'); }, [trueScaleAvailable]);
  useEffect(() => {
    const element = toolbar.current; if (!element || !onSafeZones) return;
    const report = () => { const r = element.getBoundingClientRect(); onSafeZones([{ id: 'scene-controls', x: r.x, y: r.y, width: r.width, height: r.height }]); };
    report(); const observer = new ResizeObserver(report); observer.observe(element); window.addEventListener('resize', report); window.addEventListener('scroll', report, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', report); window.removeEventListener('scroll', report, true); onSafeZones([]); };
  }, [onSafeZones]);
  const selectedNode = selection?.kind === 'node' ? data.joints.find(j => j.id === selection.id) : undefined;
  const diagnostic = data.checkpoint?.modelRevision === data.revision && data.checkpoint.valid ? data.checkpoint.segments.filter(f => f.valid !== false && !f.slack && (f.axial ?? 0) < -1e-8 && data.members.some(m => m.id === f.memberId && m.family === 'cable')) : [];
  const ambiguous = flow.segments.filter(f => f.reason === 'ambiguous' || f.reason === 'unanchored' || f.reason === 'nonconverged');
  return <section className="mp-view" aria-label="Multiplayer structural scene">
    <div className="mp-scene-controls" ref={toolbar}>
      <div className="mp-board-title"><strong>Shared table</strong><span>15 × 15 cells · Z up · height {data.board.height} · 1 unit = {data.metresPerUnit} m</span></div>
      <div className="mp-control-row"><button type="button" onClick={() => engine.current?.fit()}>Fit board</button>
        <label>Joint DOFs <select value={showJoints} onChange={e => setShowJoints(e.target.value as typeof showJoints)}><option value="selected">Selected</option><option value="all">All joints</option><option value="off">Off</option></select></label>
        <label className="mp-check"><input type="checkbox" checked={showFlow} onChange={e => setShowFlow(e.target.checked)} />Load transfer</label>
        <label>Sections <select aria-label="Section scale" value={sectionMode} onChange={e => setSectionMode(e.target.value as typeof sectionMode)}><option value="readable">Readable</option><option value="true" disabled={!trueScaleAvailable}>True scale{!trueScaleAvailable ? ' (dimensions required)' : ''}</option></select></label>
        <label>Inspect <select aria-label="Inspect an element" value={selection?.kind === 'member' ? selection.id : ''} onChange={e => onSelectionChange(e.target.value ? { kind: 'member', id: e.target.value } : null)}><option value="">Choose element</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.id} · {familyLabel(m.family)} · {m.owner}</option>)}</select></label>
      </div>
      {placement && <div className="mp-control-row"><label>Legal targets ({targets.length}) <select aria-label="Legal placement target" value={targetId} onChange={e => { setTargetId(e.target.value); engine.current?.focusTarget(e.target.value); }}><option value="">Choose grid / quarter target</option>{targets.map(t => <option key={t.id} value={t.id}>{t.position.join(', ')} · {t.kind}{t.parentId ? ` · ${t.parentId}` : ''}</option>)}</select></label><button type="button" disabled={!targetId || paused} onClick={() => { if (engine.current) engine.current.activateTarget(targetId); else { const target = targets.find(t => t.id === targetId); if (target) onTargetActivate?.(target); } }}>Use target</button><span>Euclidean max {placement.maxLength}; shorter spans allowed</span></div>}
    </div>
    <div className="mp-scene-stage">
      <canvas ref={canvas} className="mp-webgl" aria-hidden="true" />
      <canvas ref={overlay} className="mp-overlay" tabIndex={0} role="img" aria-label="Interactive 3D board. Use the Inspect and Legal targets selectors for an accessible alternative." aria-describedby={instructions} />
      {paused && <div className="mp-paused">Scene paused</div>}
      {error && <p className="mp-render-error" role="alert">{error}</p>}
      {mode === 'projected' && <span className="mp-render-mode">WebGL unavailable · projected 3D fallback</span>}
    </div>
    <div className="mp-scene-status"><p role="status">{freshness(data)}</p>
      <p className="mp-legend">Flow → receiving nodes/supports · <span className="mp-tension">blue: axial tension</span> · <span className="mp-compression">coral: axial compression</span> · lilac: shear/bending or mixed · ↔ ? ambiguous</p>
      <p>{mode === 'projected' ? 'Projected fallback: schematic thickness. ' : sectionMode === 'true' ? 'Authored member/cable sections at true scale. ' : 'Authored member/cable sections enlarged ×1.2 for readability; unspecified dimensions schematic. '}Spring coils are schematic; both halves depict one element.</p>
      {showFlow && <details><summary>Accessible segment directions</summary><ul>{flow.segments.map(segment => <li key={segment.id}>{segment.id}: {segment.direction ? `${segment.from} → ${segment.to}` : segment.reason}; {segment.style === 'mixed' ? 'shear/bending or mixed action' : segment.style}</li>)}</ul></details>}
      {showFlow && <details><summary>How load-transfer direction is interpreted</summary><p>Explanatory force-weighted harmonic potentials connect the selected checkpoint's loaded nodes (1) to support/safety sinks (0), retaining branches. Arrows follow decreasing potential; this is a graph interpretation of calculated actions, not unique physical attribution, displacement or moving material. Mixed or unsupported evidence is flagged. Tension/compression colour uses axial sign independently. Safety reactions earn no player points.</p></details>}
      {ambiguous.length > 0 && <p>{ambiguous.length} segment(s): direction ambiguous or unsupported; no moving arrows.</p>}
      {diagnostic.length > 0 && <p className="mp-error">Cable compression diagnostic: {diagnostic.map(f => f.memberId).join(', ')}. Flow suppressed for these segments.</p>}
      {selectedNode && <p>Node {selectedNode.id}: original restrained rotations {selectedNode.rotations ? ['X', 'Y', 'Z'].filter((_, i) => selectedNode.rotations![i]).join(', ') || 'none' : 'not supplied'}. {selectedNode.setupLocked ? 'Setup locked. ' : ''}{selectedNode.overrides?.length ? `${selectedNode.overrides.length} separate game safety override(s), neutral reactions.` : ''}</p>}
      <p id={instructions} className="mp-footnote">Drag to orbit; right-drag / two fingers to pan; wheel / pinch to zoom. F fits. Arrow keys traverse targets, [ / ] cycle overlapping depth, Enter uses target. Inspect and target selectors also support keyboard and touch. Node glyph: XYZ global rotations; slash = restrained, curved arrow = free, S = system override.</p>
      <span className="mp-sr-only" aria-live="polite">{announcement}</span>
    </div>
  </section>;
});
