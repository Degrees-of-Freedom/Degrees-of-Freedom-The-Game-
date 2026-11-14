import { useState } from 'react';
import { useGameStore } from '../game/store';
import { activeTurnHand, KIT_PLAYTEST } from '../game/turns';

type Game = ReturnType<typeof useGameStore.getState>;
export function TurnPanel({ game, onMessage }: { game: Game; onMessage: (message: string) => void }) {
  const turn = game.turn;
  const [revealedTurn, setRevealedTurn] = useState<number | null>(null);
  if (game.mode !== 'multiplayer' || !turn) return null;
  const player = turn.players[turn.playerIndex];
  const hand = activeTurnHand(turn);
  const selectedCard = hand.find((card) => card.id === game.selectedCardId);
  const members = [...turn.board.members, ...turn.draft.members];
  const connections = [...turn.board.connections, ...turn.draft.connections];
  const report = turn.reports.at(-1);
  const revealed = revealedTurn === turn.turn;
  return <section className="turn-panel" aria-label="Shared-table turn">
    <h2>{turn.finished ? 'Table complete' : `Player ${turn.playerIndex + 1} · Round ${Math.ceil(turn.turn / 2)} of ${KIT_PLAYTEST.rounds}`}</h2>
    <p>{KIT_PLAYTEST.description} Draw two cards from each deck. Play up to one member, one gravity load and two end connections, or pass. This is an experimental local playtest.</p>
    <p>Staged this turn: {turn.draft.members.length}/1 member · {turn.draft.loads.length}/1 load · {turn.draft.connections.length}/2 connections.</p>
    {!turn.finished && !revealed && <button className="resume-link" onClick={() => setRevealedTurn(turn.turn)}>Reveal Player {turn.playerIndex + 1}’s hand</button>}
    {!turn.finished && revealed && <><div className="turn-cards" aria-label={`${player.id} hand`}>{hand.map((card) => <button key={card.id} className="turn-card" aria-pressed={selectedCard?.id === card.id} onClick={() => game.selectCard(card.id)}>{card.label}<small>{card.kind}</small></button>)}</div>
      <p>{selectedCard?.kind === 'element' ? 'Choose two points in the scene or use Precise placement to stage this member.' : selectedCard?.kind === 'load' ? 'Click an existing joint to stage this gravity load.' : selectedCard?.kind === 'connection' ? 'Choose an unconnected member end below. Other players’ ends are available too.' : 'Select a card to play it.'}</p>
      {selectedCard?.kind === 'connection' && <div className="turn-cards">{members.flatMap((member) => (['a', 'b'] as const).filter((end) => !connections.some((connection) => connection.memberId === member.id && connection.end === end)).map((end) => <button key={`${member.id}-${end}`} className="turn-card" onClick={() => onMessage(game.playConnection(selectedCard.id, member.id, end) ?? 'End connection staged.')}>Member {member.id} · end {end.toUpperCase()}<small>Joint {member[end]}</small></button>))}</div>}
      <div className="workspace-actions"><button onClick={() => onMessage(game.cancelDraft() ?? 'Draft cancelled. Your draw is unchanged.')}>Cancel draft</button><button className="primary-action" onClick={() => { const issue = game.endTurn(); onMessage(issue ?? 'Turn committed. Pass the table to the next player.'); }}>End turn / pass</button></div>
    </>}
    <p className="runtime-status">{report?.reason ?? 'Individual end-connection analysis is unavailable. Turns retain legal placements, report unresolved analysis and apply no physical penalty or reaction score.'}</p>
    <details><summary>Placed connections</summary><ul>{connections.map((connection) => <li key={`${connection.memberId}-${connection.end}`}>Member {connection.memberId}, end {connection.end.toUpperCase()}: {connection.profile} → {connection.jointId}</li>)}</ul></details>
  </section>;
}
