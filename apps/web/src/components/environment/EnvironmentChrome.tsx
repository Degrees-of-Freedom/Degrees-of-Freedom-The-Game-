import { Link } from 'react-router-dom';
import { useGameStore } from '../../game/store';
import { analyzeConnectivity } from '../../game/connectivity';
import { CELL_SIZE } from '../../game/model';
import { STYLE_CATALOG, MODE_CATALOG } from '../runtimeCatalog';

export function EnvironmentBrand() {
  const game = useGameStore();
  return <div id="brand" className="chip card"><Link to="/" title="Choose a mode or environment" aria-label="All environments"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M7 23 15 7 23 23" fill="none" stroke="#4f9da6" strokeWidth="3.4" strokeLinecap="round"/><path d="M7 23h16" stroke="#e3b04b" strokeWidth="3.4" strokeLinecap="round"/><circle cx="15" cy="7" r="3.6" fill="#fbf7ef" stroke="#3f4654" strokeWidth="2"/><circle cx="7" cy="23" r="3" fill="#6d7a8c"/><circle cx="23" cy="23" r="3" fill="#6d7a8c"/></svg></Link><div><b className="brand-name">Degrees of Freedom</b><span className="brand-sub">{STYLE_CATALOG.find((item) => item.id === game.style)?.title} · {MODE_CATALOG.find((item) => item.id === game.mode)?.title}</span></div></div>;
}

export function EnvironmentStats() {
  const game = useGameStore();
  const report = analyzeConnectivity(game.model, game.mode === 'multiplayer' ? game.turn : null);
  return <div id="stats"><div>{report.memberCount} members · {report.lengthMetres.toFixed(1)} m · {report.totalLoadKilonewtons} kN</div><div className="roles"><span><i style={{background:'var(--column, #3f5d8a)'}}/>column</span><span><i style={{background:'var(--beam, #6f8fb8)'}}/>beam</span><span><i style={{background:'var(--brace, #c98a5a)'}}/>brace</span>{report.unsupportedMembers.length > 0 && <span>{report.unsupportedMembers.length} floating</span>}</div></div>;
}

export function EnvironmentStepper() {
  const game = useGameStore();
  if (game.style !== 'levels' && game.style !== 'engineering') return null;
  return <aside id="stepper" className="card" aria-label="Working level"><div className="st-head"><div className="st-level"><div className="st-num">{game.workK}</div><div className="cap"><b>Level</b><span>{(game.workK * CELL_SIZE).toFixed(1)} m</span></div></div><div className="st-keys"><button className="btn" aria-label="Level up" onClick={() => game.setWorkK(game.workK + 1)}>↑ <kbd>W</kbd></button><button className="btn" aria-label="Level down" onClick={() => game.setWorkK(game.workK - 1)}>↓ <kbd>S</kbd></button></div></div><div className="st-rows"><svg width="150" height="182" viewBox="0 0 150 182" aria-label="Elevation levels">{Array.from({length:8}, (_, k) => <g key={k} onClick={() => game.setWorkK(k)}><path d={`M10 ${160-k*20}h110`} stroke={game.workK === k ? '#5b84b1' : '#d9d2c3'} strokeWidth={game.workK === k ? 3 : 1}/><text x="130" y={164-k*20} fontSize="11" fill="#5b6472">{k}</text></g>)}</svg></div><div className="st-view"><span>Q ↶</span><span>X · Y · Z</span><span>↷ E</span></div></aside>;
}

export function TurnBanner({onMessage}:{onMessage:(message:string)=>void}) {
  const game = useGameStore(), turn = game.turn;
  if (game.mode !== 'multiplayer' || !turn) return null;
  return <div id={game.style === 'kit' ? 'banner' : 'turn'} className="chip panel"><div id="who"><b>Player {turn.playerIndex + 1}</b><span>Turn {turn.turn} · round {Math.ceil(turn.turn/2)}</span></div><div className="turn-pips" aria-label="Turn allowances"><span className={turn.draft.members.length ? 'spent' : ''}>1 member</span><span className={turn.draft.loads.length ? 'spent' : ''}>1 load</span><span>{2-turn.draft.connections.length} connections</span></div><button className="btn" disabled={turn.finished} onClick={()=>onMessage(game.endTurn() ?? 'Turn committed · pass the table')}>End turn</button><span className="tag">playtest</span></div>;
}
