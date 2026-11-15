import { useState } from 'react';
import { Link } from 'react-router-dom';
import { candidates, finishDemoTurn, newModel, selectCandidate, train, type Skill } from '../game/aiLab';
import { createTurnGame } from '../game/turns';

export function AiLab() {
  const [model, setModel] = useState(newModel);
  const [game, setGame] = useState(() => createTurnGame(1));
  const [skill, setSkill] = useState<Skill>('advanced');
  const [mode, setMode] = useState<'human' | 'ai'>('human');
  const [log, setLog] = useState<string[]>([]);
  const options = candidates(game);
  const play = (choice: typeof options[number] | undefined) => {
    const player = game.players[game.playerIndex].id;
    setLog(old => [`Turn ${game.turn} · ${player}: ${choice?.label ?? 'passed'}${choice ? ` (proxy ${choice.reward.toFixed(1)})` : ''}`, ...old]);
    setGame(finishDemoTurn(choice?.state ?? game));
  };
  return <main style={{ maxWidth: 980, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui', lineHeight: 1.5 }}>
    <Link to="/">← Main menu</Link><h1>AI turn lab</h1>
    <p>Experiment with the Shared table turn engine. Train a small linear model on simulated legal plays, then try a turn or watch AI players take turns.</p>
    <p><strong>Prototype:</strong> the training reward favors attached, upward and diagonal plays. It is a teaching proxy, not a structural solve, verified safety, or official score. The limited move generator does not cover every legal move.</p>
    <section><h2>1. Train</h2><p>{model.examples} training examples · weights {model.weights.map(n => n.toFixed(2)).join(', ')}</p>
      <button onClick={() => setModel(train(model, 100, model.examples + 1))}>Train 100 simulated matches</button>{' '}
      <button onClick={() => setModel(newModel())}>Reset model</button>
    </section>
    <section><h2>2. Play</h2><label>Opponent skill <select value={skill} onChange={e => setSkill(e.target.value as Skill)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>{' '}
      <label>Players <select value={mode} onChange={e => setMode(e.target.value as 'human' | 'ai')}><option value="human">You vs AI</option><option value="ai">AI vs AI</option></select></label>{' '}
      <button onClick={() => { setGame(createTurnGame(1)); setLog([]); }}>New match</button>
      <p>{game.finished ? 'Match complete' : `Turn ${game.turn}: ${game.players[game.playerIndex].id}`} · {game.board.members.length} members · {game.board.loads.length} loads</p>
      {!game.finished && (mode === 'ai' || game.playerIndex === 1 ? <button onClick={() => play(selectCandidate(options, model, skill))}>Play AI turn</button> : <><p>Choose a generated move:</p><select key={game.turn} id="move" defaultValue="0">{options.map((option, i) => <option key={i} value={i}>{option.label}</option>)}</select>{' '}<button onClick={() => { const select = document.getElementById('move') as HTMLSelectElement; play(options[Number(select.value)]); }}>Play selected turn</button>{' '}<button onClick={() => play(undefined)}>Pass</button></>)}
      {!game.finished && options.length === 0 && <p>No generated element play is available; the turn will pass.</p>}
    </section><section><h2>Turn log</h2><ol>{log.map((entry, i) => <li key={i}>{entry}</li>)}</ol></section>
  </main>;
}
