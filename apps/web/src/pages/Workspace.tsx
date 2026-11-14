import { useEffect, useState } from 'react';
import { Scene } from '../viewer/Scene';
import { ITEMS, LEVELS, MEMBER_TYPES, remaining, costOf, type LevelId, type MemberType, type Tool, useGameStore } from '../game/store';
import { analyzeGame, autoDesignGame } from '../game/analysis';
import type { VoxelAnalysis } from '../solver/voxel';
import { computeLoadPath } from '../solver/loadPath';

const tools: { id: Tool; label: string }[] = [
  { id: 'inspect', label: 'Inspect' }, { id: 'delete', label: 'Remove' }, { id: 'swap', label: 'Swap' },
  ...Object.entries(ITEMS).map(([id, item]) => ({ id: id as Tool, label: item.label })),
];

export function Workspace() {
  const game = useGameStore();
  const level = LEVELS[game.levelId];
  const [analysis, setAnalysis] = useState<{ model: typeof game.model; level: LevelId; result: VoxelAnalysis } | null>(null);
  const [message, setMessage] = useState('');
  const [combo, setCombo] = useState(0);
  const [deformed, setDeformed] = useState(false);
  const [scale, setScale] = useState(1);
  const [utilization, setUtilization] = useState(true);
  const [loads, setLoads] = useState(true);
  const [loadPath, setLoadPath] = useState(false);
  const result = analysis?.model === game.model && analysis.level === game.levelId ? analysis.result : null;
  const path = result && loadPath ? computeLoadPath(result, combo) : null;
  const selectedId = game.selected?.type === 'member' ? game.selected.id : undefined;
  const selected = game.model.members.find(m => m.id === selectedId);
  function run() {
    try { setAnalysis({ model: game.model, level: game.levelId, result: analyzeGame(game.model, level) }); setMessage(''); }
    catch (error) { setAnalysis(null); setMessage(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, select, textarea, button') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'r') run();
      if (event.key.toLowerCase() === 'd') setDeformed(value => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  function autoDesign() {
    try {
      const source = game.model;
      const designed = autoDesignGame(source, level);
      if (designed.changed && game.applyAutoDesign(designed.model, source)) {
        setAnalysis({ model: useGameStore.getState().model, level: game.levelId, result: designed.analysis });
        setMessage('Beam sections updated.');
      } else {
        setAnalysis({ model: source, level: game.levelId, result: designed.analysis });
        setMessage(designed.analysis.error ?? (designed.analysis.mechanism ? 'Resolve the mechanism before auto-design.' : 'No beam sections changed.'));
      }
    } catch (error) { setMessage(`Auto-design failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return <main className="workspace">
    <div className="heading"><div><p className="eyebrow">● &nbsp; THE WORKSPACE / VOXEL STRUCT</p><h1>Build something <em>brilliant.</em></h1><p>Explore structures, one connection at a time.</p></div><span className="draft">EXPERIMENTAL PROTOTYPE</span></div>
    <div className="workspace-actions"><label>Challenge <select value={game.levelId} onChange={e => game.setLevel(e.target.value as LevelId)}>{Object.entries(LEVELS).map(([id, l]) => <option key={id} value={id}>{l.name}</option>)}</select></label><button onClick={() => { if (!game.loadExample()) setMessage('No example is available for this challenge.'); else setMessage(''); }}>Load example</button>{level.random && <button onClick={() => game.newLayout()}>New layout</button>}<button onClick={game.undo} disabled={!game.history.length}>Undo</button><button onClick={game.reset}>Clear</button><button onClick={autoDesign}>Auto-design beams</button><button className="primary-action" onClick={run}>Run analysis</button></div>
    <div className="layout"><aside className="panel"><div className="panel-title">01 &nbsp; BUILD TOOLS</div><h2>Your toolkit</h2><p className="muted">{level.desc}</p><div className="tool-list">{tools.filter(t => t.id !== 'load' || level.type === 'sandbox').map(t => { const item = t.id in ITEMS ? ITEMS[t.id as keyof typeof ITEMS] : null; const count = item ? remaining(level, game.model, t.id as keyof typeof ITEMS) : null; return <button className={game.tool === t.id ? 'active-tool' : ''} key={t.id} onClick={() => game.setTool(t.id)}><b style={{ color: item?.color }}>✳</b><span>{t.label}<small>{count === null ? 'Select tool' : count === Infinity ? 'Unlimited' : `${count} available`}</small></span></button>; })}</div>{game.tool === 'swap' && <label className="control-label">Swap to <select value={game.swapTarget} onChange={e => game.setSwapTarget(e.target.value as MemberType)}>{MEMBER_TYPES.map(t => <option key={t} value={t}>{ITEMS[t].label}</option>)}</select></label>}<div className="note">Click to build; drag to orbit. Shift chooses a horizontal build plane. Select Inspect to examine members. R runs analysis; D toggles deformation.</div></aside>
    <section className="viewport" aria-label="Structural workspace"><Scene loadPath={loadPath} onToggleLoadPath={() => setLoadPath(value => !value)} onMessage={setMessage} result={result} combo={combo} deformed={deformed} scale={scale} utilization={utilization} loads={loads} /><div className="view-label">● &nbsp; 3D VIEW <span>PERSPECTIVE</span></div><div className="plane-controls"><button onClick={() => game.setWorkK(game.workK - 1)}>−</button><span>Build plane: {game.workK * 2} m</span><button onClick={() => game.setWorkK(game.workK + 1)}>+</button></div><div className="view-help">DRAG TO ORBIT &nbsp; SCROLL TO ZOOM <span>X / Y / Z</span></div></section>
    <aside className="panel inspector"><div className="panel-title">02 &nbsp; STRUCTURE</div><h2>The details</h2><div className="stat"><span>Members</span><b>{game.model.members.length}</b></div><div className="stat"><span>Cost</span><b>${costOf(game.model).toLocaleString()}</b></div><div className="stat"><span>Budget</span><b>{Number.isFinite(level.budget) ? `$${level.budget.toLocaleString()}` : 'Unlimited'}</b></div>
    {selected && <div className="selection"><h3>Member #{selected.id}</h3><p>{ITEMS[selected.type].label} · {selected.a} → {selected.b}</p><label>Swap to <select value={selected.type} onChange={e => { const issue = game.swapMember(selected.id, e.target.value as MemberType); setMessage(issue ?? ''); }}>{MEMBER_TYPES.map(t => <option key={t} value={t}>{ITEMS[t].label}</option>)}</select></label><button onClick={() => game.removeMember(selected.id)}>Remove member</button>{result?.members[selected.id] && <><h3>Design checks</h3>{Object.entries(result.members[selected.id].checks).map(([name, value]) => <div className="stat" key={name}><span>{name}</span><b>{Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—"}</b></div>)}{result.members[selected.id].slack && <p>Cable is slack in at least one load case.</p>}</>}</div>}
    {game.selected?.type === 'node' && <div className="selection"><h3>Node {game.selected.key}</h3><p>Attachments: {Object.entries(game.model.attrs[game.selected.key] ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</p></div>}
    <div className="analysis"><div className="panel-title">03 &nbsp; ANALYSIS</div>{message && <p role="status">{message}</p>}{!result ? <p>Run the experimental analysis to see checks. Results clear when the model changes.</p> : result.error ? <p role="alert">Cannot analyse: {result.error}</p> : <><h3>{result.success ? 'Checks passed' : 'Not yet passing'} {result.stars ? '★'.repeat(result.stars) : ''}</h3><ul className="objectives">{result.objectives.map((o, i) => <li key={i}>{o.ok ? '✓' : '✕'} {o.label}{o.detail && <small>{o.detail}</small>}</li>)}</ul><div className="stat"><span>Mass</span><b>{result.mass?.toFixed(2)} t</b></div><div className="stat"><span>Maximum utilisation</span><b>{result.mechanism || result.maxU === undefined ? "—" : `${(result.maxU * 100).toFixed(0)}%`}</b></div><h3>Most utilised members</h3>{Object.entries(result.members).sort((a, b) => b[1].util - a[1].util).slice(0, 8).map(([id, member]) => <button className="member-result" key={id} onClick={() => game.setSelected({type: "member", id: Number(id)})}>#{id} · {member.gov} <b>{(member.util * 100).toFixed(0)}%</b></button>)}<div className="view-options"><label>Load case <select value={combo} onChange={e => setCombo(Number(e.target.value))}>{['ULS wind X', 'ULS wind Y', 'SLS wind X', 'SLS wind Y'].map((name, i) => <option value={i} key={name}>{name}</option>)}</select></label><label><input type="checkbox" checked={deformed} onChange={e => setDeformed(e.target.checked)} /> Deformed shape</label><label>Scale <input type="range" min="0.1" max="3" step="0.1" value={scale} onChange={e => setScale(Number(e.target.value))} /></label><label><input type="checkbox" checked={utilization} onChange={e => setUtilization(e.target.checked)} /> Utilisation colours</label><label><input type="checkbox" checked={loadPath} onChange={e => setLoadPath(e.target.checked)} /> Load path (L)</label>{path && <div><p>Force-weighted routes are illustrative.</p>{path.shares.map(share => <div className="stat" key={share.key}><span>Support {share.key}</span><b>{(share.fraction * 100).toFixed(0)}%</b></div>)}</div>}<label><input type="checkbox" checked={loads} onChange={e => setLoads(e.target.checked)} /> Loads and reactions</label></div><p>Approximate prototype results; not for engineering design.</p></>}</div></aside></div><footer>DESIGNED FOR CURIOUS MINDS ✳ <span>A PLAYGROUND FOR STRUCTURAL THINKING</span></footer>
  </main>;
}









