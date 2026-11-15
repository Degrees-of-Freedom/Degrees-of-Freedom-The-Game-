import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { activeTurnHand, nextAnalysisInTurns, remainingTurnDraws, turnJoints, type TurnCard, type TurnState } from "../game/turns";
import { matchesIssueEvidence } from "../game/turnIssues";
import { useGameStore } from "../game/store";
import { useSettings, updateSettings } from "../menu/settings";
import { Scene } from "../viewer/Scene";
import { SceneBoundary } from "./environment/SceneBoundary";
import { ReleaseTargets } from "./ReleaseTargets";
import { ReleaseInspection } from "./ReleaseInspection";
import { useReleaseInspection } from "../viewer/useReleaseInspection";
import { deformationField } from "../viewer/deformationField";
import { boardActions, boardDiagram, type SectionAction } from "../viewer/boardDiagrams";
import { FinalScorePanel } from "./FinalScorePanel";
import { ESCAPE_OWNER } from "./PauseMenu";
import { Companion, type CompanionProps } from "../companion/Companion";
import type { CompanionCue, CompanionCueEvent } from "../companion/motion";
import { sightTurn, turnTransitionCue, type TurnSighting } from "../companion/turnCues";
import type { OverlayLayer } from "../viewer/viewModes";
import { jointAtSceneSelection, sharedJointPermissions } from "../viewer/jointPermissions";
import type { CameraMemory } from "../viewer/sceneView";
import { instabilityModes } from "../viewer/instabilityModes";
import { effectiveJointConnections } from "../game/jointCorrections";
import { computeLoadPath } from "../evaluator/loadPath";
import "./releaseBoard.css";

type Game = ReturnType<typeof useGameStore.getState>;
const order = { element: 0, connection: 1, load: 2 };
const symbols = { element: "Ι", connection: "⊕", load: "↓" };
const kinds = { element: "Element", connection: "Connection", load: "Gravity" };
const seat = (id: string) => id.replace("player-", "Player ");
/** Last public turn shown in this page session; cosmetic state across handoff. */
let lastSighting: TurnSighting | null = null;

function Hand({ game, turn, choose, notify, onEnd, react }: {
  game: Game; turn: TurnState; choose(card: TurnCard): void; notify(message: string): void; onEnd(): void;
  react(cue: CompanionCue): void;
}) {
  const hand = activeTurnHand(turn).sort((a, b) => order[a.kind] - order[b.kind]);
  const selected = hand.find(c => c.id === game.selectedCardId);
  const recent = turn.players[turn.playerIndex].hand.slice(-4).map(c => c.id);
  const slots = { element: 1 - turn.draft.members.length, connection: 2 - turn.draft.connections.length, load: 1 - turn.draft.loads.length };
  const drawsLeft = remainingTurnDraws(turn);
  const staged = slots.element + slots.connection + slots.load < 4;
  return <section className="release-tray" aria-label="Active hand">
    {selected && <div className="release-targetbar" aria-label="Card targeting">
      <span className="release-prompt">{selected.kind === "element"
        ? game.chainStart ? "Choose the end point." : "Choose the start point."
        : selected.kind === "connection" ? "Attach a loose end." : "Choose a load target."}</span>
      <ReleaseTargets key={selected.id} card={selected} game={game} notify={notify} onRejected={() => react({ kind: "invalid" })} />
      <button className="release-back" aria-label="Cancel targeting" onClick={() => { game.selectCard(null); react({ kind: "cancel" }); }}>×</button>
    </div>}
    <div className="release-handline">
      <div className="release-cards" aria-label="Cards">
        {hand.map(card => <button key={card.id} data-card-id={card.id} data-kind={card.kind}
          className="release-card" data-arrival={recent.includes(card.id) ? recent.indexOf(card.id) : undefined}
          aria-pressed={card.id === selected?.id} disabled={game.turnAnalysing || game.sessionSave !== "idle" || drawsLeft > 0 || (!turn.rulesRevision && !slots[card.kind])} onClick={() => choose(card)}>
          <span><i aria-hidden="true">{symbols[card.kind]}</i>{kinds[card.kind]}</span><strong>{card.label}</strong>
        </button>)}
      </div>
      <div className="release-turn-actions">
        {staged && <button disabled={game.sessionSave !== "idle"} title="Undo last placement (Ctrl+Z)" onClick={() => notify(game.undoPlacement() ?? "Last placement undone.")}>Undo</button>}
        {staged && <button disabled={game.sessionSave !== "idle"} onClick={() => { notify(game.cancelDraft() ?? "Draft cancelled."); react({ kind: "cancel" }); }}>Cancel draft</button>}
        <button className="release-end" disabled={game.turnAnalysing || game.sessionSave !== "idle" || drawsLeft > 0} onClick={onEnd} onKeyDown={e => { if (e.repeat) e.preventDefault(); }}>{game.turnAnalysing ? "Calculating…" : staged ? "End turn" : "Pass"}</button>
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
  const [layer, setLayer] = useState<OverlayLayer>("combined");
  const [shear, setShear] = useState<SectionAction | 0>(0);
  const [moment, setMoment] = useState<SectionAction | 0>(0);
  const [amplification, setAmplification] = useState(0);
  const [trueScale, setTrueScale] = useState(false);
  const [showInstability, setShowInstability] = useState(false);
  const [instabilityMode, setInstabilityMode] = useState(0);
  const [playInstability, setPlayInstability] = useState(false);
  const [focusJoint, setFocusJoint] = useState<string>();
  const [skip, setSkip] = useState(false);
  // Status-line animation and scenario motion have independent event identities.
  const [action, setAction] = useState(0);
  const [companionCue, setCompanionCue] = useState<CompanionCueEvent>();
  const react = useCallback((next: CompanionCue) => setCompanionCue(previous => ({ ...next, id: (previous?.id ?? 0) + 1 })), []);
  const settings = useSettings();
  useEffect(() => { setPlayInstability(false); }, [turn.board, settings.reducedMotion, skip]);
  const heading = useRef<HTMLHeadingElement>(null);
  const inspectButton = useRef<HTMLButtonElement>(null);
  const picked = game.selected;
  const draftSize = turn.draft.members.length + turn.draft.connections.length + turn.draft.loads.length;
  const drawsLeft = remainingTurnDraws(turn);
  const counts = { members: turn.draft.members.length, connections: turn.draft.connections.length, loads: turn.draft.loads.length };
  const prior = useRef({ draftSize, ...counts });
  useEffect(() => {
    if (draftSize > prior.current.draftSize) {
      const attached = counts.connections > prior.current.connections;
      cue(attached ? "attach" : "place");
      react({ kind: attached ? "attach" : counts.loads > prior.current.loads ? "stage-load" : "stage-member" });
      setAction(n => n + 1);
      notify("Placement staged.");
    }
    prior.current = { draftSize, ...counts };
  }, [draftSize, counts.members, counts.connections, counts.loads, cue, notify, react]);
  // The board unmounts behind the private handoff. Only the public sighting
  // survives that boundary, never the concealed active hand.
  useEffect(() => {
    const next = turnTransitionCue(lastSighting, turn);
    lastSighting = sightTurn(turn);
    if (next) react(next);
  }, [turn, turn.turn, turn.reports, turn.finished, react]);
  useEffect(() => { if (picked) setInspecting(true); }, [picked]);
  useEffect(() => { if (inspecting) heading.current?.focus({ preventScroll: true }); }, [inspecting]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      const editing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !editing) {
        event.preventDefault();
        if (!event.repeat) notify(game.undoPlacement() ?? "Last placement undone.");
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(`[${ESCAPE_OWNER}]`)) return;
      if (inspecting) { event.preventDefault(); setInspecting(false); game.setSelected(null); inspectButton.current?.focus(); }
      else if (game.chainStart) { event.preventDefault(); game.setChainStart(null); }
      else if (game.selectedCardId) { event.preventDefault(); game.selectCard(null); }
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [inspecting, game, notify]);
  const joints = useMemo(() => sharedJointPermissions({ ...turn.board,
    members: [...turn.board.members, ...turn.draft.members], joints: turnJoints(turn),
    connections: effectiveJointConnections({ ...turn.board, connections: [...turn.board.connections, ...turn.draft.connections] }) }), [turn.board, turn.draft]);
  const joint = picked?.type === "node" ? jointAtSceneSelection(joints, picked.key, turn) : joints.find(j => j.id === focusJoint);
  const jointLayer = useMemo(() => settings.releaseJointDisplay === "off" ? undefined :
    { joints: settings.releaseJointDisplay === "all" ? joints : joint ? [joint] : [], selected: joint?.id }, [settings.releaseJointDisplay, joint, joints]);
  const calculated = turn.checkpoints?.lastAnalysis;
  // Shared table uses accepted checkpoint snapshots. The general view-mode
  // hook can solve on demand, so it must not drive this scheduled route.
  const analysisTurn = useMemo(() => calculated ? { ...turn, board: calculated.board, nextId: calculated.nextId, turn: calculated.turn + 1 } : turn, [turn, calculated]);
  const currentResponse = !turn.rulesRevision || !!calculated && matchesIssueEvidence(turn.board, calculated.board);
  const reading = useReleaseInspection(analysisTurn, (!turn.rulesRevision || !!calculated) && !draftSize && !game.turnAnalysing);
  const result = draftSize || !currentResponse ? null : reading?.response?.result ?? null;
  const turnsToAnalysis = turn.rulesRevision ? nextAnalysisInTurns(turn) : 1;
  const deformed = layer === "shape" || layer === "combined";
  const shadow = layer === "shadow" || layer === "shadow-path";
  const field = useMemo(() => result && (deformed || shadow) ? deformationField(result, 0) : undefined, [result, deformed, shadow]);
  const diagrams = useMemo(() => result ? [shear, moment].flatMap(action => action ? [boardDiagram(result, action)] : []) : [], [result, shear, moment]);
  const scale = amplification || (field?.peakM ? Math.max(1, Math.min(500, Math.round(1.2 / field.peakM))) : 1);
  const report = turn.reports.at(-1);
  const modes = useMemo(() => result ? instabilityModes(result) : [], [result]);
  const selectedMode = Math.min(instabilityMode, Math.max(0, modes.length - 1));
  const nodalMode = modes[selectedMode]?.hasNodalMotion ?? false;
  const pathVisible = layer === "path" || layer === "combined" || layer === "shadow-path";
  const flow = useMemo(() => result && pathVisible ? computeLoadPath(result, 0) : null, [result, pathVisible]);
  const flowPeak = flow ? Math.max(0, ...Array.from(flow.members.values(), member => member.force)) : 0;
  const toggleLayer = (quantity: "shape" | "path") => {
    const shape = quantity === "shape" ? !(deformed || shadow) : deformed || shadow;
    const path = quantity === "path" ? !pathVisible : pathVisible;
    setLayer(shape ? shadow ? path ? "shadow-path" : "shadow" : path ? "combined" : "shape" : path ? "path" : "reference");
  };
  const scopes = reading?.response?.receipt.components;
  const phase = game.turnAnalysing ? "Calculating forces and checking stability…"
    : draftSize ? "Staged changes · forces update at the next checkpoint"
    : !currentResponse ? "Current board awaits the next checkpoint"
    : reading?.error ? "Calculation unavailable · inspect details"
    : !reading?.response ? "Loading the calculated response…"
    : scopes?.some(scope => !scope.verified) ? "Results ready · some components unavailable" : "Results ready · committed structure";
  const status = message || (report ? `Turn ${report.turn} · ${report.status}${report.penalty ? " · −1 point" : ""}`
    : "Select a card to build, or pass.");
  const boardMessage = (text: string) => { notify(text); if (text && game.selectedCardId) react({ kind: "invalid" }); };
  const choose = (card: TurnCard) => {
    setInspecting(false); game.setSelected(null); game.selectCard(game.selectedCardId === card.id ? null : card.id);
    cue("select"); setAction(n => n + 1); notify("");
    react(game.selectedCardId === card.id ? { kind: "cancel" } : { kind: "select", family: card.kind });
  };
  return <main className="release-board" data-style="grow-dusk" data-still={settings.reducedMotion || skip}
    data-glow={settings.glow} aria-label="Grow Dusk">
    <header className="release-header" data-player={turn.playerIndex + 1}>
      <div className="release-title"><small>Grow Dusk</small><h1>{turn.finished ? "Final results" : `Player ${turn.playerIndex + 1} · ${turn.playerIndex === 0 ? "Coral" : "Blue"}`}</h1></div>
      <div className="release-progress"><strong>Round {Math.ceil(turn.turn / 2)} / 8</strong>
        {!turn.finished && <span>{turn.rulesRevision ? "Play any held cards · pass when ready" : `Remaining · ${1 - turn.draft.members.length} element · ${1 - turn.draft.loads.length} load · ${2 - turn.draft.connections.length} connections`}</span>}</div>
      <div className="release-penalties" aria-label="Historical deductions"><small>Deductions</small>
        <div className="release-player-key">{turn.players.map((p, i) => <span key={p.id} data-player={i + 1}>
          <i aria-hidden="true" />{seat(p.id)} · {i === 0 ? "Coral" : "Blue"} · {turn.reports.filter(r => r.playerId === p.id).reduce((sum, r) => sum + r.penalty, 0)}
        </span>)}</div></div>
      <div className="release-nav">
        <button ref={inspectButton} aria-expanded={inspecting} onClick={() => setInspecting(!inspecting)}>Inspect</button>
        <button aria-haspopup="dialog" onClick={onMenu}>Menu</button>
      </div>
      <p className="release-phone-note">For a larger building surface, open this match on a desktop or landscape tablet. Private export is in Menu.</p>
    </header>
    <section className="release-analysisbar" aria-label="Structural analysis controls">
      <div className="release-analysis-state" role="status" aria-live="polite" aria-busy={game.turnAnalysing || (currentResponse && !draftSize && !reading?.response && !reading?.error)}>
        <strong>{phase}</strong><span>{turn.finished ? "Final round complete" : `${turnsToAnalysis} player turn${turnsToAnalysis === 1 ? "" : "s"} until calculation`}
          {calculated && ` · last calculated turn ${calculated.turn}`}</span>
      </div>
      {!turn.rulesRevision && <span className="release-legacy">Earlier saved rules · restart from Menu for three decks and checkpoints.</span>}
      <div className="release-layer-buttons" aria-label="Board overlays">
        <button aria-pressed={deformed || shadow} onClick={() => toggleLayer("shape")}>Deformation</button>
        <button aria-pressed={pathVisible} onClick={() => toggleLayer("path")}>Load paths</button>
        <button aria-pressed={!!shear} onClick={() => setShear(shear ? 0 : 2)}>Shear</button>
        <button aria-pressed={!!moment} onClick={() => setMoment(moment ? 0 : 4)}>Bending</button>
        <button aria-pressed={showInstability} onClick={() => { setShowInstability(!showInstability); setPlayInstability(false); }}>Instability</button>
      </div>
      <label>Node releases<select value={settings.releaseJointDisplay} onChange={e => updateSettings({ releaseJointDisplay: e.target.value as typeof settings.releaseJointDisplay })}>
        <option value="all">All joints</option><option value="selected">Selected joint</option><option value="off">Off</option>
      </select></label>
      <label>Reaction labels<select value={settings.reactionLabels} onChange={e => updateSettings({ reactionLabels: e.target.value as typeof settings.reactionLabels })}>
        <option value="off">Off</option><option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option>
      </select></label>
      {turn.checkpoints && !turn.finished && <label>Calculate every<select value={turn.checkpoints.interval} onChange={e => notify(game.setAnalysisInterval(Number(e.target.value)) ?? "Calculation interval saved.")}>
        {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} player turn{i ? "s" : ""}</option>)}
      </select></label>}
    </section>
    <section className="release-stage" aria-label="Structure board" data-drawer={inspecting}>
      <SceneBoundary release><Scene cameraMemory={cameraMemory} trueScale={trueScale} showInstability={showInstability}
        instabilityMode={selectedMode} playInstability={playInstability && nodalMode && !skip && !settings.reducedMotion} reactionLabels={settings.reactionLabels}
        still={skip || settings.reducedMotion} jointLayer={jointLayer} combo={0} deformed={deformed} shadow={shadow}
        diagrams={diagrams} reference field={field} scale={scale} loads utilization={false} loadPath={pathVisible} result={result} onMessage={boardMessage} /></SceneBoundary>
      {!turn.finished && drawsLeft > 0 && <section className="release-decks" aria-label="Draw four cards">
        <header><strong>Choose your four cards</strong><span role="status">{4 - drawsLeft} of 4 drawn · any mix of decks</span></header>
        <div>{(["members", "connections", "loads"] as const).map((deck, i) => <button key={deck} data-deck={deck}
          disabled={game.turnAnalysing || game.sessionSave !== "idle" || turn.decks[i].length === 0} onClick={() => notify(game.drawCard(deck) ?? "Card drawn.")}
          onKeyDown={e => { if (e.repeat) e.preventDefault(); }}>
          <i aria-hidden="true">{["Ι", "⊕", "↓"][i]}</i><strong>{["Members", "Connections", "Loads"][i]}</strong><span>{turn.decks[i].length} cards</span>
        </button>)}</div>
      </section>}
      {!turn.finished && <p className="release-status" key={action} role="status">{status}</p>}
      {!draftSize && result && !inspecting && <aside className="release-legend" aria-label="Analysis legend">
        {(deformed || shadow) && <p><span className="release-contour" aria-hidden="true" />Deflection · 0–{Number((1000 * (field?.peakM ?? 0)).toPrecision(3))} mm · ×{scale}<br />{shadow ? "Ground shadow · exaggerated displacement" : "Dashed reference · exaggerated shape"}</p>}
        {pathVisible && <p>→ Gravity transfer · peak {Number(flowPeak.toPrecision(3))} kN<br />Illustrative combined gravity transfer.<br />No individual-load attribution.<br />Arrows · <span className="release-tension">blue tension</span> / <span className="release-compression">coral compression</span><br />Violet · shear/bending · static load transfer</p>}
        {settings.releaseJointDisplay !== "off" && <p>Joint compass · bars lock, arrows release<br />Straight axes translate · arcs rotate</p>}
        {!!diagrams.length && diagrams.map(d => <p key={d.action}>{boardActions[d.action]} · peak {Number(d.peak.toPrecision(3))} {d.action < 3 ? "kN" : "kN·m"}</p>)}
        <button onClick={() => setInspecting(true)}>Inspect forces and signs</button>
      </aside>}
      {showInstability && !inspecting && <aside className="release-mode-panel" aria-label="Instability diagnostic">
        {modes.length ? <><label>Solver mode<select value={selectedMode} onChange={e => setInstabilityMode(Number(e.target.value))}>
          {modes.map((mode, i) => <option key={i} value={i}>{i + 1} · {mode.kind}{mode.hasNodalMotion ? "" : " · nodal vector unavailable"}</option>)}
        </select></label><p>{modes.length} returned modes · illustrative normalized solver mode, exaggerated. Joint-linear ghost, not loaded deflection or collapse.</p>
          {!nodalMode && <p>No nodal motion vector was returned for this mode.</p>}
          <button aria-pressed={playInstability && nodalMode} disabled={settings.reducedMotion || skip || !nodalMode} onClick={() => setPlayInstability(!playInstability)}>{playInstability && nodalMode ? "Pause mode" : "Play mode"}</button>
        </> : <p>{draftSize ? "End turn to calculate the staged structure." : "No solver mode vector is available for this board."}</p>}
      </aside>}
      {turn.finished && turn.finalScore && !inspecting && <div className="release-final"><FinalScorePanel score={turn.finalScore} /></div>}
      {!inspecting && <Companion area="board" {...companion} release cue={companionCue} final={turn.finished} skip={skip} />}
      {inspecting && <aside className="release-drawer" aria-label="Inspect structure">
        <header><h2 ref={heading} tabIndex={-1}>Inspect structure</h2><button aria-label="Close inspection" onClick={() => {
          setInspecting(false); game.setSelected(null); inspectButton.current?.focus();
        }}>×</button></header>
        <label>Section display<select value={trueScale ? "true" : "readable"} onChange={e => setTrueScale(e.target.value === "true")}>
          <option value="readable">Readable sections</option><option value="true">True scale</option>
        </select></label>
        <ReleaseInspection game={game} turn={turn} joints={joints} joint={joint} selectJoint={id => { game.setSelected(null); setFocusJoint(id); }}
          draft={!!draftSize} awaitingCheckpoint={!currentResponse} calculatedTurn={calculated?.turn} reading={reading}
          layer={layer} peakM={field?.peakM} setLayer={setLayer} scale={scale} amplification={amplification} setAmplification={setAmplification} />
        {result && <details><summary>Board force diagrams</summary>
          <label>Shear diagram<select value={shear} onChange={e => setShear(Number(e.target.value) as 0 | 1 | 2)}>
            <option value={0}>Off</option><option value={1}>Shear Vy</option><option value={2}>Shear Vz</option>
          </select></label>
          <label>Bending diagram<select value={moment} onChange={e => setMoment(Number(e.target.value) as 0 | 4 | 5)}>
            <option value={0}>Off</option><option value={4}>Moment My</option><option value={5}>Moment Mz</option>
          </select></label>
          {diagrams.map(d => <p key={d.action}>{boardActions[d.action]} · {d.series.length
            ? `peak magnitude ${Number(d.peak.toPrecision(4))} ${d.action < 3 ? "kN · mint" : "kN·m · pink"}`
            : "No verified frame sections"}</p>)}
          {!!diagrams.length && <p>Each peak spans 1.5 m on the board. Positive readings extend toward local +Y for Vy/Mz and +Z for Vz/My. Inspect a member for signed readings.</p>}
        </details>}
        {result && <label className="release-check"><input type="checkbox" checked={showInstability} onChange={e => { setShowInstability(e.target.checked); setPlayInstability(false); }} />
          Mark witnessed instability</label>}
        {showInstability && result && <p>{result.combos[0]?.components?.some(c => c.instabilityWitness)
          ? "Dashed rose segments mark the witnessed region." : "No instability witness is available on this board."}</p>}
      </aside>}
      {!skip && <button className="release-skip" onClick={() => setSkip(true)}>Skip effects</button>}
    </section>
    {!turn.finished && <Hand game={game} turn={turn} choose={choose} notify={notify} onEnd={onEnd} react={react} />}
    {menu}
  </main>;
}
