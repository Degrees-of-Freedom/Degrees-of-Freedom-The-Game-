import { useState } from "react";
import type { useGameStore } from "../game/store";
import type { TurnCard } from "../game/turns";
import { originalPorts, portLabel, findPort } from "../game/turnPorts";

type Game = ReturnType<typeof useGameStore.getState>;

/** A precise alternative to overlapping 3D picks. Target IDs include the original parent. */
export function TurnQuarterTargets({ game, card, onMessage }: {
  game: Game; card: TurnCard; onMessage: (message: string) => void;
}) {
  const [a, setA] = useState(""), [b, setB] = useState("");
  if (!game.turn || card.kind === "connection") return null;
  const members = game.turn.board.members;
  const ports = members.flatMap(originalPorts);
  if (card.kind === "load") {
    const joints = [...game.turn.board.connections, ...game.turn.draft.connections];
    const active = ports.filter(port => joints.some(j => j.jointId === port.id));
    if (!active.length) return null;
    return <label>Load at quarter joint
      <select value="" onChange={e => {
        if (e.target.value) onMessage(game.playLoad(card.id, e.target.value) ?? "Gravity load staged.");
      }}>
        <option value="">Choose an activated port</option>
        {active.map(port => <option key={port.id} value={port.id}>{portLabel(port)}</option>)}
      </select>
    </label>;
  }
  const choices = ports.map(port =>
    <option key={port.id} value={port.id} disabled={!port.available}>
      {portLabel(port)}{port.available ? "" : " · attachment unavailable"}
    </option>);
  return <details>
    <summary>Quarter-point placement</summary>
    <p>Choose an original port or enter grid coordinates for each end. A connector attaches the staged end.</p>
    {([{ label: "A", value: a, change: setA }, { label: "B", value: b, change: setB }]).map(({ label, value, change }) =>
      <div key={label}>
        <label>End {label} port
          <select value={findPort(members, value) ? value : ""} onChange={e => change(e.target.value)}>
            <option value="">Grid coordinates</option>{choices}
          </select>
        </label>
        {!findPort(members, value) && <label>End {label} grid x,y,z
          <input type="text" value={value} onChange={e => change(e.target.value)} placeholder="1,3,1" />
        </label>}
      </div>)}
    <button disabled={!a.trim() || !b.trim()} onClick={() => {
      onMessage(game.playElement(card.id, a.trim(), b.trim()) ?? "Element staged.");
    }}>Stage element</button>
  </details>;
}
