import { useEffect, useId, useRef, useState } from 'react';
import type { DraftEdit, MemberView, MultiplayerViewData, ViewSafeZone } from './types';
import { canEditMember, draftEditIssue, familyLabel, formatPoint, freshness, spanLength } from './viewModel';
import { sceneFlow } from './renderingPolicy';
import './view.css';

export interface ElementInspectorProps {
  readonly data: MultiplayerViewData;
  readonly memberId: string | null;
  readonly onClose: () => void;
  /** Validated command callback; the inspector does not commit, mutate or solve. */
  readonly onDraftChange?: (memberId: string, edit: DraftEdit) => void;
  readonly onSafeZone?: (zone: ViewSafeZone | null) => void;
}

const maskText = (mask: MemberView['rotations'][number]): string => mask
  ? `Restrained: ${['X', 'Y', 'Z'].filter((_, i) => mask[i]).join(', ') || 'none'}; free: ${['X', 'Y', 'Z'].filter((_, i) => !mask[i]).join(', ') || 'none'}`
  : 'Not supplied';

/** Persistent controlled inspector; all physical changes go through the injected draft callback. */
export function ElementInspector({ data, memberId, onClose, onDraftChange, onSafeZone }: ElementInspectorProps) {
  const member = data.members.find(m => m.id === memberId);
  const panel = useRef<HTMLElement>(null);
  const heading = useId();
  const [coordinates, setCoordinates] = useState(['', '', '']);
  const [issue, setIssue] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = () => { trigger.current?.focus({ preventScroll: true }); onClose(); };
  useEffect(() => { setCoordinates(member?.end.map(String) ?? ['', '', '']); setIssue(null); }, [member]);
  useEffect(() => {
    if (!member || !panel.current) return;
    if (document.activeElement instanceof HTMLElement && !panel.current.contains(document.activeElement)) trigger.current = document.activeElement;
    panel.current.focus({ preventScroll: true });
  }, [memberId]);
  useEffect(() => {
    if (!member || !panel.current || !onSafeZone) return;
    const element = panel.current;
    const report = () => { const r = element.getBoundingClientRect(); onSafeZone({ id: 'element-inspector', x: r.x, y: r.y, width: r.width, height: r.height }); };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(element); window.addEventListener('resize', report); window.addEventListener('scroll', report, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', report); window.removeEventListener('scroll', report, true); onSafeZone(null); };
  }, [memberId, onSafeZone, Boolean(member)]);
  if (!member) return null;
  const editable = canEditMember(member) && Boolean(onDraftChange);
  const current = data.checkpoint?.valid && data.checkpoint.modelRevision === data.revision;
  const results = current ? data.checkpoint!.segments.filter(s => s.memberId === member.id) : [];
  const flow = current ? sceneFlow(data) : null;
  const attachedNodes = new Set([member.startNode, member.endNode, ...member.quarterPorts.flatMap(p => [p.id, ...(p.nodeId ? [p.nodeId] : [])])]);
  const overrides = data.joints.filter(j => attachedNodes.has(j.id)).flatMap(j => (j.overrides ?? []).map(o => ({ ...o, node: j.id })));
  const multiplier = member.family === 'spring-025' ? 0.25 : member.family === 'spring-05' ? 0.5 : null;
  return <aside className="mp-inspector" ref={panel} tabIndex={-1} aria-labelledby={heading} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <header><div><p className="mp-eyebrow">Element properties</p><h2 id={heading}>{familyLabel(member.family)}</h2></div><button type="button" aria-label="Close element inspector" onClick={close}>×</button></header>
    <p className="mp-status">{member.setupLocked ? '🔒 Locked starting column / foundation attachment' : editable ? 'Draft · editable through card choices' : 'Committed · physical properties read-only'}</p>
    <dl>
      <dt>Owner</dt><dd>{member.owner}</dd><dt>Card / element</dt><dd>{member.cardId} / {member.id}</dd>
      <dt>Actual / maximum length</dt><dd>{spanLength(member.start, member.end).toFixed(3)} / {member.maxLength} game units</dd>
      <dt>Scale</dt><dd>1 game unit = {data.metresPerUnit} m</dd>
      <dt>Start / end</dt><dd>{member.startNode}: ({formatPoint(member.start)})<br />{member.endNode}: ({formatPoint(member.end)})</dd>
      <dt>Original quarter ports</dt><dd>{member.quarterPorts.map(p => <div key={p.id}>{p.fraction * 100}% · ({formatPoint(p.position)}) · {p.id}</div>)}</dd>
      <dt>Original start rotations</dt><dd>{maskText(member.rotations[0])}</dd>
      <dt>Original end rotations</dt><dd>{maskText(member.rotations[1])}</dd>
      {member.family !== 'member' && <><dt>Rotational action</dt><dd>Axial-only family: a joint mask does not add member moment stiffness.</dd></>}
      {member.section && <><dt>Authored section</dt><dd>{member.family === 'cable' ? `Round diameter ${member.section.width}` : `${member.section.width} × ${member.section.depth}`} game units</dd></>}
      {multiplier !== null && <><dt>Spring stiffness</dt><dd>{member.spring ? <>k₀ = {member.spring.k0} {member.spring.unit}<br />Multiplier = {multiplier}; effective k = {member.spring.k0 * multiplier} {member.spring.unit}</> : `Multiplier = ${multiplier}; authored k₀ unavailable`}<br /><small>Two schematic coils; one analytical spring.</small></dd></>}
    </dl>
    {editable && <form onSubmit={event => {
      event.preventDefault();
      const edit: DraftEdit = { end: coordinates.map(v => v.trim() === '' ? NaN : Number(v)) as [number, number, number] };
      const error = draftEditIssue(member, edit, data.board); setIssue(error);
      if (!error) onDraftChange?.(member.id, edit);
    }}><fieldset><legend>Draft end · game units</legend><div className="mp-coordinate-fields">{['X', 'Y', 'Z'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`Draft end ${axis}`} type="number" step="any" min="0" max={[15, 15, data.board.height][i]} value={coordinates[i]} onChange={e => setCoordinates(old => old.map((v, j) => j === i ? e.target.value : v))} /></label>)}</div><button type="submit">Apply draft endpoint</button></fieldset><p className="mp-error" role="status">{issue}</p><small>Canonical placement rules still validate the callback. This does not play a card.</small></form>}
    <section><h3>Checkpoint results</h3><p>{freshness(data)}</p><small>Model {data.revision}{data.checkpoint && <> · analyzed {data.checkpoint.modelRevision} · {data.checkpoint.id}</>}</small>
      {results.map(s => <p key={s.id}>{s.id}: {member.family === 'cable' && (s.axial ?? 0) < -1e-8 ? 'Cable compression diagnostic; path suppressed' : s.valid === false || flow?.segments.find(f => f.id === s.id)?.reason === 'unknown' ? 'Unavailable segment scope' : s.slack ? 'Slack cable' : <>action {s.magnitude.toPrecision(3)} {data.checkpoint!.forceUnit}; axial {s.axial === undefined ? 'unknown' : `${s.axial.toPrecision(3)} ${data.checkpoint!.forceUnit} (${Math.abs(s.axial) <= 1e-8 ? 'zero axial' : s.axial > 0 ? 'tension' : 'compression'})`}</>}</p>)}
      {!results.length && <p>No current segment results displayed.</p>}
    </section>
    <section><h3>Game safety overrides · neutral</h3>{!overrides.length && <p>None recorded at these endpoints.</p>}{overrides.map(o => <div className="mp-override" key={o.id}><strong>{o.node}: {o.kind} {o.axes.join('/')}</strong><p>{o.reason}</p><small>Turn {o.originatingTurn} · {o.checkpointId} · global axes · permanent this match · {o.verified ? 'verified record' : 'unresolved record'}</small><p>Safety reaction: {o.reaction ? `${formatPoint(o.reaction)} ${o.reactionUnit ?? ''}` : 'not available'} · no player points</p></div>)}</section>
    <p className="mp-footnote">Player masks remain distinct from system constraints. Inspection never runs analysis.</p>
  </aside>;
}
