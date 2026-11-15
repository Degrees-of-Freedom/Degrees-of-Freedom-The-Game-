import { useState } from "react";
import { connectionChoices } from "../game/cardCatalogue";
import { connectionLabel, memberConnectionFrame, type ConnectionProfile } from "../game/jointFreedom";
import { useGameStore } from "../game/store";
import { findPort, loadTargets, originalPorts, portLabel, systemTarget } from "../game/turnPorts";
import { stageConnection, type TurnCard, type TurnState } from "../game/turns";
import { turnConnectionTargets } from "../viewer/turnPicking";

type Game = ReturnType<typeof useGameStore.getState>;

function ElementCoordinates({ turn, stage }: { turn: TurnState; stage(a: string, b: string): void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const members = [...turn.board.members, ...turn.draft.members];
  const ports = members.filter(m => !m.system).flatMap(originalPorts)
    .filter(port => port.available && !systemTarget(turn, port.id));
  return <details className="release-precision">
    <summary>Precise placement</summary>
    <form onSubmit={event => { event.preventDefault(); if (a.trim() && b.trim()) stage(a.trim(), b.trim()); }}>
      {([{ name: "A", value: a, change: setA }, { name: "B", value: b, change: setB }]).map(end =>
        <fieldset key={end.name}>
          <legend>End {end.name}</legend>
          <select aria-label={`End ${end.name} port`} value={findPort(members, end.value) ? end.value : ""}
            onChange={event => end.change(event.target.value)}>
            <option value="">Grid point</option>
            {ports.map(port => <option key={port.id} value={port.id}>{portLabel(port)}</option>)}
          </select>
          {!findPort(members, end.value) && <input aria-label={`End ${end.name} grid x,y,z`}
            placeholder="x,y,z" value={end.value} required autoComplete="off" onChange={event => end.change(event.target.value)} />}
        </fieldset>)}
      <button type="submit" disabled={!a.trim() || !b.trim()}>Stage element</button>
    </form>
  </details>;
}

/** Selects the same physical identities as scene picking, including coincident loose ends. */
export function ReleaseTargets({ game, card, notify, onRejected }: {
  game: Game; card: TurnCard; notify(message: string): void;
  /** Called when the store rejects a placement (it returned an explanation). */
  onRejected?(): void;
}) {
  const [choice, setChoice] = useState("");
  const report = (error: string | null, staged: string) => { notify(error ?? staged); if (error) onRejected?.(); };
  const turn = game.turn!;
  if (card.kind === "element") return <ElementCoordinates turn={turn}
    stage={(a, b) => report(game.playElement(card.id, a, b), "Element staged.")} />;
  if (card.kind === "load") {
    const targets = loadTargets(turn);
    if (!targets.length) return <span>Place a member above ground to give this load a target.</span>;
    const id = targets.find(item => item.id === choice)?.id ?? targets[0].id;
    return <div className="release-targets">
      <label>Load target<select value={id} onChange={event => setChoice(event.target.value)}>
        {targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
      </select></label>
      <button onClick={() => report(game.playLoad(card.id, id), "Load staged.")}>Place load</button>
    </div>;
  }
  const profiles = connectionChoices(card);
  const profile = profiles.length === 1 ? profiles[0] : game.selectedConnectionProfile;
  // Keep the intended end selected while the player changes its local axes.
  // An incompatible choice reports the conflict instead of moving the target.
  const targets = turnConnectionTargets(turn.rulesRevision ? { ...game, selectedConnectionProfile: undefined } : game);
  const key = (target: typeof targets[number]) => JSON.stringify([target.memberId, target.end, target.key]);
  const target = targets.find(t => key(t) === choice) ?? targets[0];
  const member = target && [...turn.board.members, ...turn.draft.members].find(member => member.id === target.memberId);
  const axes = member && turn.rulesRevision ? memberConnectionFrame(member) : undefined;
  const attachment = target && profile ? stageConnection(turn, card.id, target.memberId, target.end, target.key, profile) : undefined;
  return <div className="release-targets">
    {profiles.length > 1 && <label>{turn.rulesRevision ? "Local rotational locks" : "Rotational locks"}
      <select value={profile ?? ""} onChange={event => game.setConnectionProfile(event.target.value as ConnectionProfile || undefined)}>
        <option value="">Choose axes</option>{profiles.map(p => <option key={p} value={p}>{connectionLabel(p)}</option>)}
      </select></label>}
    {target ? <>
      <label>Connection target<select value={key(target)} onChange={event => setChoice(event.target.value)}>
        {targets.map(item => <option key={key(item)} value={key(item)}>Member {item.memberId} · end {item.end.toUpperCase()} · {item.key}</option>)}
      </select></label>
      {axes && <div className="release-connection-axes" aria-label="Member local axes">
        <strong>Member {member!.id} local axes · X along A → B</strong>
        <span>Directions in global X, Y, Z</span>
        {axes.map((axis, i) => <span key={i}><b>{"XYZ"[i]}</b> ({axis.map(value => Number(value.toFixed(3))).join(", ")})</span>)}
      </div>}
      <button disabled={!attachment?.ok} onClick={() => report(game.playConnection(card.id, target.memberId, target.end, target.key, profile), "Connection staged.")}>Attach end</button>
      {attachment && !attachment.ok && <span role="status">{attachment.reason}</span>}
    </> : profile && <span>No compatible loose end. Place a member or choose another card.</span>}
  </div>;
}
