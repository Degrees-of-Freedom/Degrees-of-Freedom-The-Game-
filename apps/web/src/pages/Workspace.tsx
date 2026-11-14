import { useState } from 'react';
import { Scene } from '../viewer/Scene';
import { ITEMS, LEVELS, MEMBER_TYPES, remaining, costOf, type LevelId, type MemberType, type Tool, useGameStore } from '../game/store';
import { analyzeVoxel, autoDesignVoxel, type VoxelAnalysis } from '../solver/voxel';

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
  const result = analysis?.model === game.model && analysis.level === game.levelId ? analysis.result : null;
  const selectedId = game.selected?.type === 'member' ? game.selected.id : undefined;
  const selected = game.model.members.find(m => m.id === selectedId);
  function run() {
    try { setAnalysis({ model: game.model, level: game.levelId, result: analyzeVoxel(game.model, level) }); setMessage(''); }
    catch (error) { setMessage(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  function autoDesign() {
    try {
      const source = game.model;
      const designed = autoDesignVoxel(source, level);
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
    <div className="workspace-actions"><label>Challenge <select value={game.levelId} onChange={e => game.setLevel(e.target.value as LevelId)}>{Object.entries(LEVELS).map(([id, l]) => <option key={id} value={id}>{l.name}</option>)}</select></label><button onClick={() => { if (!game.loadExample()) setMessage('No example is available for this challenge.'); else setMessage(''); }}>Load example</button><button onClick={game.undo} disabled={!game.history.length}>Undo</button><button onClick={game.reset}>Clear</button><button onClick={autoDesign}>Auto-design beams</button><button className="primary-action" onClick={run}>Run analysis</button></div>
    <div className="layout"><aside className="panel"><div className="panel-title">01 &nbsp; BUILD TOOLS</div><h2>Your toolkit</h2><p className="muted">{level.desc}</p><div className="tool-list">{tools.filter(t => t.id !== 'load' || level.type === 'sandbox').map(t => { const item = t.id in ITEMS ? ITEMS[t.id as keyof typeof ITEMS] : null; const count = item ? remaining(level, game.model, t.id as keyof typeof ITEMS) : null; return <button className={game.tool === t.id ? 'active-tool' : ''} key={t.id} onClick={() => game.setTool(t.id)}><b style={{ color: item?.color }}>✳</b><span>{t.label}<small>{count === null ? 'Select tool' : count === Infinity ? 'Unlimited' : `${count} available`}</small></span></button>; })}</div>{game.tool === 'swap' && <label className="control-label">Swap to <select value={game.swapTarget} onChange={e => game.setSwapTarget(e.target.value as MemberType)}>{MEMBER_TYPES.map(t => <option key={t} value={t}>{ITEMS[t].label}</option>)}</select></label>}<div className="note">Click to build; drag to orbit. Shift chooses a horizontal build plane. Select Inspect to examine members.</div></aside>
    <section className="viewport" aria-label="Structural workspace"><Scene result={result} combo={combo} deformed={deformed} scale={scale} utilization={utilization} loads={loads} /><div className="view-label">● &nbsp; 3D VIEW <span>PERSPECTIVE</span></div><div className="plane-controls"><button onClick={() => game.setWorkK(game.workK - 1)}>−</button><span>Build plane: {game.workK * 2} m</span><button onClick={() => game.setWorkK(game.workK + 1)}>+</button></div><div className="view-help">DRAG TO ORBIT &nbsp; SCROLL TO ZOOM <span>X / Y / Z</span></div></section>
    <aside className="panel inspector"><div className="panel-title">02 &nbsp; STRUCTURE</div><h2>The details</h2><div className="stat"><span>Members</span><b>{game.model.members.length}</b></div><div className="stat"><span>Cost</span><b>${costOf(game.model).toLocaleString()}</b></div><div className="stat"><span>Budget</span><b>{Number.isFinite(level.budget) ? `$${level.budget.toLocaleString()}` : 'Unlimited'}</b></div>
    {selected && <div className="selection"><h3>Member #{selected.id}</h3><p>{ITEMS[selected.type].label} · {selected.a} → {selected.b}</p><label>Swap to <select value={selected.type} onChange={e => { const issue = game.swapMember(selected.id, e.target.value as MemberType); setMessage(issue ?? ''); }}>{MEMBER_TYPES.map(t => <option key={t} value={t}>{ITEMS[t].label}</option>)}</select></label><button onClick={() => game.removeMember(selected.id)}>Remove member</button></div>}
    {game.selected?.type === 'node' && <div className="selection"><h3>Node {game.selected.key}</h3><p>Attachments: {Object.entries(game.model.attrs[game.selected.key] ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</p></div>}
    <div className="analysis"><div className="panel-title">03 &nbsp; ANALYSIS</div>{message && <p role="status">{message}</p>}{!result ? <p>Run the experimental analysis to see checks. Results clear when the model changes.</p> : result.error ? <p role="alert">Cannot analyse: {result.error}</p> : <><h3>{result.success ? 'Checks passed' : 'Not yet passing'} {result.stars ? '★'.repeat(result.stars) : ''}</h3><ul className="objectives">{result.objectives.map((o, i) => <li key={i}>{o.ok ? '✓' : '✕'} {o.label}{o.detail && <small>{o.detail}</small>}</li>)}</ul><div className="view-options"><label>Load case <select value={combo} onChange={e => setCombo(Number(e.target.value))}>{['ULS wind X', 'ULS wind Y', 'SLS wind X', 'SLS wind Y'].map((name, i) => <option value={i} key={name}>{name}</option>)}</select></label><label><input type="checkbox" checked={deformed} onChange={e => setDeformed(e.target.checked)} /> Deformed shape</label><label>Scale <input type="range" min="0.1" max="3" step="0.1" value={scale} onChange={e => setScale(Number(e.target.value))} /></label><label><input type="checkbox" checked={utilization} onChange={e => setUtilization(e.target.checked)} /> Utilisation colours</label><label><input type="checkbox" checked={loads} onChange={e => setLoads(e.target.checked)} /> Loads and reactions</label></div><p>Approximate prototype results; not for engineering design.</p></>}</div></aside></div><footer>DESIGNED FOR CURIOUS MINDS ✳ <span>A PLAYGROUND FOR STRUCTURAL THINKING</span></footer>
  </main>;
}



