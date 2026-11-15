import { useState } from "react";
import { CANTILEVER_CATALOGUE, connectionChoices } from "../game/cardCatalogue";
import { attachmentLabel, attachmentQuarter, type AttachmentSite, type InteriorContact } from "../game/attachmentSites";
import { placementAnchorTargets, placementCandidates, placementFromTip } from "../game/cantileverPlacement";
import { connectionLabel, type ConnectionProfile } from "../game/jointFreedom";
import { CELL_SIZE, nodeKey, parseNodeKey } from "../game/model";
import { useGameStore } from "../game/store";
import { findPort, loadTargets, originalPorts, portLabel, systemTarget, targetCoordinate } from "../game/turnPorts";
import { activeTurnHand, type TurnCard, type TurnState } from "../game/turns";
import { turnConnectionTargets } from "../viewer/turnPicking";

type Game = ReturnType<typeof useGameStore.getState>;
type ElementCard = Extract<TurnCard, { kind: "element" }>;
type Notify = (message: string) => void;
const sites: readonly { value: AttachmentSite; label: string }[] = [
  { value: "a", label: "End A" }, { value: "q1", label: "¼" },
  { value: "q2", label: "Middle" }, { value: "q3", label: "¾" }, { value: "b", label: "End B" },
];

function ElementCoordinates({ turn, stage, support }: { turn: TurnState; stage(a: string, b: string): void; support?: string }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const ports = turn.board.members.filter(m => !m.system).flatMap(originalPorts)
    .filter(port => port.available && !systemTarget(turn, port.id));
  return <details className="release-precision">
    <summary>Precise placement</summary>
    <form onSubmit={event => { event.preventDefault(); if (a.trim() && b.trim()) stage(a.trim(), b.trim()); }}>
      <p className="release-placement-note">{support
        ? `Choose both endpoints while keeping the selected ${support}. The element remains unconnected until you play a fixed connector.`
        : "Enter two endpoints. For an overhang, choose an attachment point and free tip above."}</p>
      {([{ name: "A", value: a, change: setA }, { name: "B", value: b, change: setB }]).map(end =>
        <fieldset key={end.name}>
          <legend>End {end.name}</legend>
          <select aria-label={`End ${end.name} port`} value={findPort(turn.board.members, end.value) ? end.value : ""}
            onChange={event => end.change(event.target.value)}>
            <option value="">Grid point</option>
            {ports.map(port => <option key={port.id} value={port.id}>{portLabel(port)}</option>)}
          </select>
          {!findPort(turn.board.members, end.value) && <input aria-label={`End ${end.name} grid x,y,z`}
            placeholder="x,y,z" value={end.value} required autoComplete="off" onChange={event => end.change(event.target.value)} />}
        </fieldset>)}
      <button type="submit" disabled={!a.trim() || !b.trim()}>Stage element</button>
    </form>
  </details>;
}

/** The select controls use the same geometry and authority as scene picks. */
export function ElementPlacementControls({ game, card, notify }: { game: Game; card: ElementCard; notify: Notify }) {
  const [coordinates, setCoordinates] = useState("");
  const turn = game.turn!;
  const anchors = placementAnchorTargets(turn);
  const anchor = anchors.find(target => target.id === game.chainStart);
  const candidates = game.chainStart ? placementCandidates(game) : [];
  const candidate = candidates.find(target => target.key === game.placementTip);
  const pointA = candidate ? parseNodeKey(targetCoordinate(turn.board.members, candidate.a)) : null;
  const pointB = candidate ? parseNodeKey(targetCoordinate(turn.board.members, candidate.b)) : null;
  const lengthM = pointA && pointB ? CELL_SIZE * Math.hypot(...pointB.map((value, axis) => value - pointA[axis])) : 0;
  const fraction = attachmentQuarter(game.attachmentSite) / 4;
  const lengthLabel = (value: number) => Number(value.toPrecision(4)) + " m";
  const supportedSource = turn.catalogue === CANTILEVER_CATALOGUE && card.type !== "cable" && card.type !== "spring" && !card.assembly;
  const canChooseStation = supportedSource && !!anchor;
  const quarter = attachmentQuarter(game.attachmentSite);
  const contact: InteriorContact | undefined = canChooseStation && anchor && (quarter === 1 || quarter === 2 || quarter === 3)
    ? { quarter, target: anchor.id } : undefined;
  const stage = (a: string, b: string) => notify(game.playElement(card.id, a, b, contact) ?? "Element staged. Choose a connector to attach it.");
  const useCoordinates = () => {
    const value = coordinates.trim();
    const point = parseNodeKey(value);
    if (point.length !== 3 || !point.every(Number.isFinite) || nodeKey(...point) !== value) {
      notify("Enter a free tip as x,y,z, for example 8,7,1.");
      return;
    }
    const placement = placementFromTip(game, point);
    if ("issue" in placement) { notify(placement.issue); return; }
    notify(game.playElement(card.id, placement.a, placement.b, placement.contact) ?? "Element staged. Choose a connector to attach it.");
  };
  return <div className="release-placement-controls">
    <div className="release-targets">
      <label>Attachment point
        <select aria-label="Element attachment point" value={anchor?.id ?? ""} onChange={event => {
          game.setChainStart(event.target.value || null); game.setPlacementTip(null); setCoordinates("");
        }}>
          <option value="">Choose on the board or start on the grid</option>
          {anchors.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
        </select>
      </label>
      {game.chainStart && <>
        {canChooseStation && <fieldset className="release-station-controls">
          <legend>Attach at</legend>
          <div role="group" aria-label="Attachment on new element">
            {sites.map(site => <button key={site.value} type="button" aria-pressed={game.attachmentSite === site.value}
              aria-label={`Attach at ${site.label}`} onClick={() => { game.setAttachmentSite(site.value); game.setPlacementTip(null); }}>
              {site.label}
            </button>)}
          </div>
        </fieldset>}
        <label>Build plane
          <select aria-label="Element build plane" value={game.placementPlane} onChange={event => {
            const plane = event.target.value;
            if (plane === "horizontal" || plane === "xz" || plane === "yz") game.setPlacementPlane(plane);
            game.setPlacementTip(null);
          }}>
            <option value="horizontal">Horizontal</option><option value="xz">Vertical XZ</option><option value="yz">Vertical YZ</option>
          </select>
        </label>
        <label>Free tip
          <select aria-label="Element free tip" value={candidate?.key ?? ""} onChange={event => game.setPlacementTip(event.target.value || null)}>
            <option value="">Choose on the board or select a point</option>
            {candidates.map(target => <option key={target.key} value={target.key}>{anchors.find(anchor => anchor.id === target.key)?.label ?? target.point.join(", ")}</option>)}
          </select>
        </label>
        <button type="button" disabled={!candidate} onClick={() => {
          if (candidate) notify(game.playElement(card.id, candidate.a, candidate.b, candidate.contact) ?? "Element staged. Choose a connector to attach it.");
        }}>Place element</button>
      </>}
    </div>
    {candidate && <p className="release-placement-note" role="status">
      Whole element · {lengthLabel(lengthM)}{fraction > 0 && fraction < 1 && ` · Overhangs ${lengthLabel(lengthM * fraction)} + ${lengthLabel(lengthM * (1 - fraction))}`}
      {" · "}{pointA?.join(",")} → {pointB?.join(",")} · Geometry only; attach with a connection card.
    </p>}
    {game.chainStart && !candidates.length && <p className="release-placement-note" role="status">
      No legal grid tips on this plane. Choose another plane or attachment position.
    </p>}
    {game.chainStart && <details className="release-precision">
      <summary>Enter free tip coordinates</summary>
      <form onSubmit={event => { event.preventDefault(); useCoordinates(); }}>
        <label>Free tip x,y,z<input aria-label="Element free tip grid x,y,z" autoComplete="off" value={coordinates}
          placeholder="8,7,1" onChange={event => setCoordinates(event.target.value)} required /></label>
        <button type="submit" disabled={!coordinates.trim()}>Place at coordinates</button>
      </form>
    </details>}
    <ElementCoordinates turn={turn} stage={stage} support={contact ? `${attachmentLabel(game.attachmentSite)} attachment at ${anchor?.label}` : undefined} />
  </div>;
}

/** A deliberate click spends the named hand card; geometry alone stays loose. */
export function StagedAttachmentActions({ game, notify }: { game: Game; notify: Notify }) {
  const turn = game.turn;
  if (!turn || !turn.draft.members.length) return null;
  const anchors = placementAnchorTargets(turn);
  const connections = [...turn.board.connections, ...turn.draft.connections];
  const cards = activeTurnHand(turn).filter(card => card.kind === "connection" && connectionChoices(card).includes("fixed"));
  const rows = turn.draft.members.flatMap(member => {
    const interior = sites.filter(site => site.value !== "a" && site.value !== "b" && member.interiorTargets?.[site.value]);
    const contacts = interior.length ? interior : sites.filter(site => {
      const end = site.value;
      if (end !== "a" && end !== "b") return false;
      return anchors.some(anchor => anchor.id === member.endTargets?.[end] || nodeKey(...anchor.point) === member[end]);
    });
    return contacts.map(site => {
      const attached = connections.some(connection => connection.memberId === member.id && connection.end === site.value);
      const option = attached ? undefined : cards.flatMap(card => {
        const target = turnConnectionTargets({ ...game, selectedCardId: card.id, selectedConnectionProfile: "fixed" })
          .find(target => target.memberId === member.id && target.end === site.value);
        return target ? [{ card, target }] : [];
      })[0];
      return <div className="release-staged-attachment" key={`${member.id}:${site.value}`}>
        <span>Member {member.id} · {attachmentLabel(site.value)} · <strong>{attached ? "Attached" : "Unconnected"}</strong></span>
        {option && <button type="button" data-attachment-card-id={option.card.id} onClick={() =>
          notify(game.playConnection(option.card.id, member.id, site.value, option.target.key, "fixed") ?? "Connection staged.")
        }>Attach with {option.card.label}</button>}
        {!attached && !option && <small>{turn.draft.connections.length >= 2 ? "No connections remaining this turn."
          : "No compatible fixed connector is available. You can leave this element unconnected."}</small>}
      </div>;
    });
  });
  return rows.length ? <div className="release-attachment-actions" aria-label="Staged element attachments">{rows}</div> : null;
}

/** Selects the same physical identities as scene picking, including coincident loose ends. */
export function ReleaseTargets({ game, card, notify }: { game: Game; card: TurnCard; notify: Notify }) {
  const [choice, setChoice] = useState("");
  const turn = game.turn!;
  if (card.kind === "element") return <ElementPlacementControls game={game} card={card} notify={notify} />;
  if (card.kind === "load") {
    const targets = loadTargets(turn);
    if (!targets.length) return <span>Place a member above ground to give this load a target.</span>;
    const id = targets.find(item => item.id === choice)?.id ?? targets[0].id;
    return <div className="release-targets">
      <label>Load target<select value={id} onChange={event => setChoice(event.target.value)}>
        {targets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}
      </select></label>
      <button onClick={() => notify(game.playLoad(card.id, id) ?? "Load staged.")}>Place load</button>
    </div>;
  }
  const profiles = connectionChoices(card);
  const profile = profiles.length === 1 ? profiles[0] : game.selectedConnectionProfile;
  const targets = turnConnectionTargets(game);
  const key = (target: typeof targets[number]) => JSON.stringify([target.memberId, target.end, target.key]);
  const target = targets.find(t => key(t) === choice) ?? targets[0];
  return <div className="release-targets">
    {profiles.length > 1 && <label>Rotational locks
      <select value={profile ?? ""} onChange={event => game.setConnectionProfile(event.target.value as ConnectionProfile || undefined)}>
        <option value="">Choose axes</option>{profiles.map(p => <option key={p} value={p}>{connectionLabel(p)}</option>)}
      </select></label>}
    {target ? <>
      <label>Connection target<select value={key(target)} onChange={event => setChoice(event.target.value)}>
        {targets.map(item => <option key={key(item)} value={key(item)}>Member {item.memberId} · {attachmentLabel(item.end)} · {item.key}</option>)}
      </select></label>
      <button onClick={() => notify(game.playConnection(card.id, target.memberId, target.end, target.key, profile) ?? "Connection staged.")}>{target.end === "a" || target.end === "b" ? "Attach end" : "Attach collar"}</button>
    </> : profile && <span>No compatible attachment point. Place a member or choose another card.</span>}
  </div>;
}
