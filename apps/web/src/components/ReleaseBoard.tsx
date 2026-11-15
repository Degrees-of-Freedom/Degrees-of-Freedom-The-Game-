import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { activeTurnHand, type TurnCard, type TurnState } from "../game/turns";
import { useGameStore } from "../game/store";
import { useSettings } from "../menu/settings";
import { Scene } from "../viewer/Scene";
import { SceneBoundary } from "./environment/SceneBoundary";
import { ReleaseTargets } from "./ReleaseTargets";
import { ReleaseInspection } from "./ReleaseInspection";
import { boardActions } from "../viewer/boardDiagrams";
import { overlayLayer } from "../viewer/viewModes";
import { useBoardView, ViewLegends, ViewModesPanel } from "./viewModes";
import { FinalScorePanel } from "./FinalScorePanel";
import { Companion, type CompanionProps } from "../companion/Companion";
import { jointAtSceneSelection, sharedJointPermissions } from "../viewer/jointPermissions";
import type { CameraMemory } from "../viewer/sceneView";
import "./releaseBoard.css";

type Game = ReturnType<typeof useGameStore.getState>;
const order = { element: 0, connection: 1, load: 2 };
const symbols = { element: "Ι", connection: "⊕", load: "↓" };
const kinds = { element: "Element", connection: "Connection", load: "Gravity" };
const seat = (id: string) => id.replace("player-", "Player ");

function Hand({ game, turn, choose, notify, onEnd }: {
  game: Game; turn: TurnState; choose(card: TurnCard): void; notify(message: string): void; onEnd(): void;
}) {
  const hand = activeTurnHand(turn).sort((a, b) => order[a.kind] - order[b.kind]);
  const selected = hand.find(c => c.id === game.selectedCardId);
  const recent = turn.players[turn.playerIndex].hand.slice(-4).map(c => c.id);
  const slots = { element: 1 - turn.draft.members.length, connection: 2 - turn.draft.connections.length, load: 1 - turn.draft.loads.length };
  const staged = slots.element + slots.connection + slots.load < 4;
  return <section className="release-tray" aria-label="Active hand">
    {selected && <div className="release-targetbar" aria-label="Card targeting">
      <span className="release-prompt">{selected.kind === "element"
        ? game.chainStart ? "Choose the end point." : "Choose the start point."
        : selected.kind === "connection" ? "Attach a loose end." : "Choose a load target."}</span>
      <ReleaseTargets key={selected.id} card={selected} game={game} notify={notify} />
      <button className="release-back" aria-label="Cancel targeting" onClick={() => game.selectCard(null)}>×</button>
    </div>}
    <div className="release-handline">
      <div className="release-cards" aria-label="Cards">
        {hand.map(card => <button key={card.id} data-card-id={card.id} data-kind={card.kind}
          className="release-card" data-arrival={recent.includes(card.id) ? recent.indexOf(card.id) : undefined}
          aria-pressed={card.id === selected?.id} disabled={!slots[card.kind]} onClick={() => choose(card)}>
          <span><i aria-hidden="true">{symbols[card.kind]}</i>{kinds[card.kind]}</span><strong>{card.label}</strong>
        </button>)}
      </div>
      <div className="release-turn-actions">
        {staged && <button onClick={() => notify(game.cancelDraft() ?? "Draft cancelled.")}>Cancel draft</button>}
        <button className="release-end" onClick={onEnd} onKeyDown={e => { if (e.repeat) e.preventDefault(); }}>{staged ? "End turn" : "Pass"}</button>
      </div>
    </div>
  </section>;
}

export function ReleaseBoard({ game, turn, message, notify, onEnd, onMenu, menu, companion, cameraMemory, cue }: {
  game: Game; turn: TurnState; message: string; notify(message: string): void;
  onEnd(): void; onMenu(): void; menu: ReactNode; companion: Omit<CompanionProps, "area">;
  cameraMemory: CameraMemory; cue(event: "select" | "place" | "attach" | "result"): void;
}) {
  const [inspecting, setInspecting] = useState(false);
  const [trueScale, setTrueScale] = useState(false);
  const [focusJoint, setFocusJoint] = useState<string>();
  const [skip, setSkip] = useState(false);
  const [action, setAction] = useState(0);
  const settings = useSettings();
  const heading = useRef<HTMLHeadingElement>(null);
  const inspectButton = useRef<HTMLButtonElement>(null);
  const picked = game.selected;
  const draftSize = turn.draft.members.length + turn.draft.connections.length + turn.draft.loads.length;
  const prior = useRef({ draftSize, connections: turn.draft.connections.length });
  useEffect(() => {
    if (draftSize > prior.current.draftSize) {
      cue(turn.draft.connections.length > prior.current.connections ? "attach" : "place");
      setAction(n => n + 1);
      notify("Placement staged.");
    }
    prior.current = { draftSize, connections: turn.draft.connections.length };
  }, [draftSize, turn.draft.connections.length, cue, notify]);
  useEffect(() => { if (picked) setInspecting(true); }, [picked]);
  useEffect(() => { if (inspecting) heading.current?.focus({ preventScroll: true }); }, [inspecting]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (inspecting) { event.preventDefault(); setInspecting(false); game.setSelected(null); inspectButton.current?.focus(); }
      else if (game.chainStart) { event.preventDefault(); game.setChainStart(null); }
      else if (game.selectedCardId) { event.preventDefault(); game.selectCard(null); }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [inspecting, game]);
  const joints = useMemo(() => sharedJointPermissions(turn.board), [turn.board]);
  const joint = picked?.type === "node" ? jointAtSceneSelection(joints, picked.key, turn) : joints.find(j => j.id === focusJoint);
  const view = useBoardView(turn, !!draftSize, joints.length);
  const { modes, result, field, diagrams, scale, reading } = view;
  const jointLayer = useMemo(() => settings.jointDisplay === "off" ? undefined :
    { joints: settings.jointDisplay === "all" ? joints : joint ? [joint] : [], selected: joint?.id, labels: modes.labels },
  [settings.jointDisplay, joint, joints, modes.labels]);
  const press = view.press;
  const toggleLoadPath = useCallback(() => press("loadPath"), [press]);
  const report = turn.reports.at(-1);
  const status = message || (report ? `Turn ${report.turn} · ${report.status}${report.penalty ? " · −1 point" : ""}`
    : "Select a card to build, or pass.");
  const choose = (card: TurnCard) => {
    setInspecting(false); game.setSelected(null); game.selectCard(game.selectedCardId === card.id ? null : card.id);
    cue("select"); setAction(n => n + 1); notify("");
  };
  return <main className="release-board" data-style="grow-dusk" data-still={settings.reducedMotion || skip}
    data-glow={settings.glow} aria-label="Grow Dusk">
    <header className="release-header">
      <div className="release-title"><small>Grow Dusk</small><h1>{turn.finished ? "Final results" : `Player ${turn.playerIndex + 1}`}</h1></div>
      <div className="release-progress"><strong>Round {Math.ceil(turn.turn / 2)} / 8</strong>
        {!turn.finished && <span>Remaining · {1 - turn.draft.members.length} element · {1 - turn.draft.loads.length} load · {2 - turn.draft.connections.length} connections</span>}</div>
      <div className="release-penalties" aria-label="Historical deductions"><small>Deductions</small>
        <span>{turn.players.map(p => `${seat(p.id)} · ${turn.reports.filter(r => r.playerId === p.id).reduce((sum, r) => sum + r.penalty, 0)}`).join("　")}</span></div>
      <div className="release-nav">
        <button ref={inspectButton} aria-expanded={inspecting} onClick={() => setInspecting(!inspecting)}>Inspect</button>
        <button aria-haspopup="dialog" onClick={onMenu}>Menu</button>
      </div>
      <p className="release-phone-note">For a larger building surface, open this match on a desktop or landscape tablet. Private export is in Menu.</p>
    </header>
    <section className="release-stage" aria-label="Structure board" data-drawer={inspecting}>
      <SceneBoundary release><Scene cameraMemory={cameraMemory} trueScale={trueScale} showInstability={modes.instability} still={skip || settings.reducedMotion}
        jointLayer={jointLayer} combo={0} deformed={modes.deflection === "shape"} shadow={modes.deflection === "shadow"} labels={modes.labels}
        diagrams={diagrams} reference field={field} scale={scale} loads={modes.reactions} utilization={false} loadPath={modes.loadPath}
        onToggleLoadPath={toggleLoadPath} result={result} onMessage={notify} /></SceneBoundary>
      <ViewModesPanel modes={modes} jointsShown={view.jointsShown} open={view.panelOpen} scale={scale}
        onOpenChange={view.setPanelOpen} onPress={press} dispatch={view.dispatch} />
      <ViewLegends legends={view.legends} />
      {!turn.finished && <p className="release-status" key={action} role="status">{status}</p>}
      {turn.finished && turn.finalScore && !inspecting && <div className="release-final"><FinalScorePanel score={turn.finalScore} /></div>}
      {!inspecting && <Companion area="board" {...companion} release action={action} final={turn.finished} skip={skip} />}
      {inspecting && <aside className="release-drawer" aria-label="Inspect structure">
        <header><h2 ref={heading} tabIndex={-1}>Inspect structure</h2><button aria-label="Close inspection" onClick={() => {
          setInspecting(false); game.setSelected(null); inspectButton.current?.focus();
        }}>×</button></header>
        <label>Section display<select value={trueScale ? "true" : "readable"} onChange={e => setTrueScale(e.target.value === "true")}>
          <option value="readable">Readable sections</option><option value="true">True scale</option>
        </select></label>
        <ReleaseInspection game={game} turn={turn} joints={joints} joint={joint} selectJoint={id => { game.setSelected(null); setFocusJoint(id); }}
          responseOpen={view.responseOpen} onResponse={view.openResponse} draft={!!draftSize} reading={reading}
          layer={overlayLayer(view.state)} peakM={field?.peakM} setLayer={layer => view.dispatch({ type: "overlay", layer })} scale={scale}
          amplification={view.state.amplification} setAmplification={value => view.dispatch({ type: "amplification", value })} />
        {result && <details><summary>Board force diagrams</summary>
          <label>Shear diagram<select value={modes.shear ? modes.shearAxis : 0} onChange={e => {
            const axis = Number(e.target.value);
            if (axis === 1 || axis === 2) view.dispatch({ type: "shearAxis", axis });
            else if (modes.shear) press("shear");
          }}>
            <option value={0}>Off</option><option value={1}>Shear Vy</option><option value={2}>Shear Vz</option>
          </select></label>
          <label>Bending diagram<select value={modes.moment ? modes.momentAxis : 0} onChange={e => {
            const axis = Number(e.target.value);
            if (axis === 4 || axis === 5) view.dispatch({ type: "momentAxis", axis });
            else if (modes.moment) press("moment");
          }}>
            <option value={0}>Off</option><option value={4}>Moment My</option><option value={5}>Moment Mz</option>
          </select></label>
          {diagrams.map(d => <p key={d.action}>{boardActions[d.action]} · {d.series.length
            ? `peak magnitude ${Number(d.peak.toPrecision(4))} ${d.action < 3 ? "kN · mint" : "kN·m · pink"}`
            : "No verified frame sections"}</p>)}
          {!!diagrams.length && <p>Each peak spans 1.5 m on the board. Positive readings extend toward local +Y for Vy/Mz and +Z for Vz/My. Inspect a member for signed readings.</p>}
        </details>}
        {result && <label className="release-check"><input type="checkbox" checked={modes.instability} onChange={() => press("instability")} />
          Mark witnessed instability</label>}
        {modes.instability && result && <p>{result.combos[0]?.components?.some(c => c.instabilityWitness)
          ? "Dashed rose segments mark the witnessed region." : "No instability witness is available on this board."}</p>}
      </aside>}
      {!skip && <button className="release-skip" onClick={() => setSkip(true)}>Skip effects</button>}
    </section>
    {!turn.finished && <Hand game={game} turn={turn} choose={choose} notify={notify} onEnd={onEnd} />}
    {menu}
  </main>;
}
