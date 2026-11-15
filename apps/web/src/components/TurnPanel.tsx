import { useGameStore } from "../game/store";
import { activeTurnHand, KIT_PLAYTEST } from "../game/turns";
import { TurnQuarterTargets } from "./TurnQuarterTargets";
import { FinalScorePanel } from "./FinalScorePanel";
import { RepairHistory } from "./RepairHistory";
import { publicTurnReport } from "../game/publicTurnModel";
import { CardDefinitionDetails } from "./CardDefinitionDetails";
import { connectionLocations, findPort, portLabel, systemTarget } from "../game/turnPorts";

type Game = ReturnType<typeof useGameStore.getState>;
export function TurnPanel({
  game,
  onMessage,
  onEndTurn,
}: {
  game: Game;
  onMessage: (message: string) => void;
  onEndTurn: () => void;
}) {
  const turn = game.turn;
  if (game.mode !== "multiplayer" || !turn) return null;
  const player = turn.players[turn.playerIndex];
  const hand = activeTurnHand(turn);
  const selectedCard = hand.find((card) => card.id === game.selectedCardId);
  const members = [...turn.board.members, ...turn.draft.members];
  const connections = [...turn.board.connections, ...turn.draft.connections];
  const report = turn.reports.at(-1);
  const deductions = turn.reports.filter(entry => entry.penalty < 0).map(publicTurnReport);
  return (
    <section className="turn-panel" aria-label="Shared-table turn">
      <h2>
        {turn.finished
          ? "Table complete"
          : `Player ${turn.playerIndex + 1} · Round ${Math.ceil(turn.turn / 2)} of ${KIT_PLAYTEST.rounds}`}
      </h2>
      {turn.finished && (turn.finalScore
        ? <FinalScorePanel score={turn.finalScore} />
        : <p>This legacy playtest ended before final scoring was available.</p>)}
      {deductions.length > 0 && (
        <details>
          <summary>Turn deductions ({deductions.length})</summary>
          {deductions.map(entry => (
            <div key={entry.turn}>
              <strong>Turn {entry.turn} · Player {turn.players.findIndex(p => p.id === entry.playerId) + 1} · −1 point</strong>
              <ul>
                {entry.penaltyReasons.map(item => (
                  <li key={item.id}>
                    Member {item.memberId}{item.end && ` end ${item.end.toUpperCase()}`} · {item.change}{" "}
                    {item.category.replace("-", " ")}. {item.reason}
                    {item.utilization !== undefined && ` · utilization ${item.utilization.toFixed(3)}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
      <RepairHistory reports={turn.reports} />
      {!turn.finished && <p>
        {KIT_PLAYTEST.description} Draw two cards from each deck. Play up to one
        member, one gravity load and two end connections, or pass. This is an
        experimental local playtest.
      </p>}
      {!turn.finished && <p>
        Staged this turn: {turn.draft.members.length}/1 member ·{" "}
        {turn.draft.loads.length}/1 load · {turn.draft.connections.length}/2
        connections.
      </p>}
      {turn.finished && (
        <button
          className="btn primary-action"
          onClick={() => {
            const issue = game.newMatch();
            onMessage(
              issue ?? "New match started. Pass the table to Player 1.",
            );
          }}
        >
          Start another match
        </button>
      )}
      {!turn.finished && (
        <>
          <div className="turn-cards" aria-label={`${player.id} hand`}>
            {hand.map((card) => (
              <button
                key={card.id}
                className="turn-card"
                aria-pressed={selectedCard?.id === card.id}
                onClick={() => game.selectCard(card.id)}
              >
                {card.label}
                <small>{card.kind}</small>
              </button>
            ))}
          </div>
          <p>
            {selectedCard?.kind === "element"
              ? "Choose two points in the scene or use Precise placement to stage this member."
              : selectedCard?.kind === "load"
                ? "Click an existing joint to stage this gravity load."
                : selectedCard?.kind === "connection"
                  ? "Choose an unconnected member end below. Other players’ ends are available too."
                  : "Select a card to play it."}
          </p>
          {selectedCard && <CardDefinitionDetails card={selectedCard} />}
          {selectedCard && <TurnQuarterTargets key={selectedCard.id} game={game} card={selectedCard} onMessage={onMessage} />}
          {selectedCard?.kind === "connection" && (
            <div className="turn-cards">
              {members.filter(member => !member.system).flatMap((member) =>
                (["a", "b"] as const)
                  .filter(
                    (end) =>
                      !connections.some(
                        (connection) =>
                          connection.memberId === member.id &&
                          connection.end === end,
                      ),
                  )
                  .flatMap((end) => connectionLocations(members, member, end).filter(target => !systemTarget(turn, target)).map(target => {
                    const port = findPort(members, target);
                    return (
                    <button
                      key={`${member.id}-${end}-${target}`}
                      className="turn-card"
                      onClick={() =>
                        onMessage(
                          game.playConnection(
                            selectedCard.id,
                            member.id,
                            end,
                            target,
                          ) ?? "End connection staged.",
                        )
                      }
                    >
                      Member {member.id} · end {end.toUpperCase()}
                      <small>{port ? portLabel(port) : `Joint ${target}`}</small>
                    </button>
                  ); })),
              )}
            </div>
          )}
          <div className="workspace-actions">
            <button
              onClick={() =>
                onMessage(
                  game.cancelDraft() ??
                    "Draft cancelled. Your draw is unchanged.",
                )
              }
            >
              Cancel draft
            </button>
            <button
              className="primary-action"
              onClick={onEndTurn}
            >
              End turn / pass
            </button>
          </div>
        </>
      )}
      {!report?.correction && <p className="runtime-status">
        {report?.reason ??
          "Run simulation to inspect loads, reactions and stability with individual end connections. "}
      </p>}`n      {report?.analysis && (
        <details>
          <summary>Last turn reactions (experimental)</summary>
          <ul>
            {report.analysis.foundations.map(({ foundationId, reaction }) => (
              <li key={foundationId}>
                {foundationId.replace("foundation:", "")} ·{" "}
                {reaction.validity === "unavailable"
                  ? "Unavailable"
                  : (reaction.value[2] / 1000).toFixed(2) + " kN vertical"}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Placed connections</summary>
        <ul>
          {connections.map((connection) => (
            <li key={`${connection.memberId}-${connection.end}`}>
              Member {connection.memberId}, end {connection.end.toUpperCase()}:{" "}
              {connection.profile} → {connection.jointId}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}


