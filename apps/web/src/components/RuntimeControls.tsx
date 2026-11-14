import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../game/store';
import { type GridPoint, type MemberType } from '../game/model';
import { modeProgress } from '../game/modes';
import type { VoxelAnalysis } from '../solver/voxel';
import { MODE_CATALOG, STYLE_CATALOG } from './runtimeCatalog';
import { MEMBER_TYPES } from '../game/inventory';

type Game = ReturnType<typeof useGameStore.getState>;
export function SessionBar({ game }: { game: Game }) {
  const mode = MODE_CATALOG.find((entry) => entry.id === game.mode)!;
  return <div className="session-bar"><Link to="/">← All modes</Link><strong>{mode.title}</strong><label>Building style <select aria-label="Building style" value={game.style} onChange={(event) => {
    const selected = STYLE_CATALOG.find((item) => item.id === event.target.value);
    if (selected) game.setStyle(selected.id);
  }}>{STYLE_CATALOG.map((style) => <option key={style.id} value={style.id}>{style.title}</option>)}</select></label><p>{STYLE_CATALOG.find((item) => item.id === game.style)?.description}</p></div>;
}

export function ModeObjective({ game, result }: { game: Game; result: VoxelAnalysis | null }) {
  if (game.mode !== 'forensics' && game.mode !== 'load-space') return null;
  const progress = result ? modeProgress(game.mode, result) : 'incomplete';
  return <div className="mode-objective" role="status"><strong>{game.mode === 'forensics' ? 'Repair the structure' : 'Carry the suspended load'}</strong> · {progress === 'complete' ? 'Objective met in the experimental analysis.' : game.mode === 'forensics' ? 'Add members or connections until the structure is connected and stable. Run analysis to check your repair.' : 'Connect the target load to the foundation and meet the challenge checks. Run analysis to test your design.'}</div>;
}

export function ModelIO({ game, onMessage }: { game: Game; onMessage: (message: string) => void }) {
  const [text, setText] = useState('');
  return <details className="model-io"><summary>Save, import and inspect model data</summary><p>Versioned structure data for the current workspace. Import is undoable. The shared-table session saves automatically in this browser.</p><div className="workspace-actions"><button disabled={game.mode === 'multiplayer'} onClick={() => {
    try { setText(JSON.stringify(game.exportModel(), null, 2)); onMessage('Model data ready.'); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'Export failed.'); }
  }}>Show model JSON</button><button disabled={!text || game.mode === 'multiplayer'} onClick={() => {
    try { const issue = game.importModel(JSON.parse(text)); onMessage(issue ?? 'Model imported.'); }
    catch { onMessage('Invalid JSON. The current model has not changed.'); }
  }}>Import model</button><button disabled={!text} onClick={() => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `dof-${game.mode}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }}>Download JSON</button><label>Open JSON <input type="file" accept=".json,application/json" onChange={async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) { onMessage('Choose a model file smaller than 2 MB.'); return; }
    try { setText(await file.text()); } catch { onMessage('The file could not be read.'); }
  }} /></label></div><textarea aria-label="Model JSON" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} /></details>;
}

/** Keyboard-accessible editing shares exactly the same actions as scene picking. */
export function CoordinateEditor({ game, onMessage }: { game: Game; onMessage: (message: string) => void }) {
  const [a, setA] = useState<GridPoint>([1, 3, 0]);
  const [b, setB] = useState<GridPoint>([1, 3, 1]);
  const [type, setType] = useState<MemberType>('shs');
  function coordinates(label: string, value: GridPoint, update: (point: GridPoint) => void) {
    return <div className="coordinate-row"><span>{label}</span>{value.map((entry, index) => <input key={index} aria-label={`${label} ${['X', 'Y', 'Z'][index]}`} type="number" step="1" min="0" value={entry} onChange={(event) => {
      const next: GridPoint = [...value]; next[index] = Number(event.target.value); update(next);
    }} />)}</div>;
  }
  return <details className="coordinate-editor"><summary>Precise placement</summary><p>Coordinates are grid indices. Use the same tools without picking in 3D.</p>{coordinates('Start', a, setA)}{coordinates('End', b, setB)}<label>Member <select aria-label="Precise member type" value={type} onChange={(event) => {
    const next = MEMBER_TYPES.find((entry) => entry === event.target.value); if (next) setType(next);
  }}>{MEMBER_TYPES.map((entry) => <option key={entry}>{entry}</option>)}</select></label><p><button onClick={() => onMessage(game.addMember(a, b, type) ?? 'Member placed.')}>Place member</button></p>{game.mode !== 'multiplayer' && <p><button onClick={() => onMessage(game.addBay(a, [2, 2, 2], type) ?? 'Bay placed.')}>Place bay at start</button></p>}<p><button onClick={() => onMessage(game.toggleAttr(a, 'load') ?? 'Load updated.')}>Load at start</button></p>{game.mode === 'creative' && <p><button onClick={() => onMessage(game.toggleAttr(a, 'found') ?? 'Foundation updated.')}>Foundation at start</button></p>}</details>;
}
