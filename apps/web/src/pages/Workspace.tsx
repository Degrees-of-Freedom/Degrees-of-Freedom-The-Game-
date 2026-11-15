import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Scene } from "../viewer/Scene";
import { controlOwnsKey } from "../viewer/keyboardTarget";
import { LEVELS } from "../game/levels";
import { useGameStore } from "../game/store";
import { analyzeGame } from "../game/analysis";
import { analyzeTurn } from "../game/turnAnalysis";
import { isScoredCatalogue } from "../game/cardCatalogue";
import { deformationField } from "../viewer/deformationField";
import { useStabilityCheck } from "../game/useStabilityCheck";
import type { VoxelAnalysis } from "../solver/voxel";
import { StabilityCheckPanel } from "../components/StabilityCheckPanel";
import { modeProgress } from "../game/modes";
import { environmentExample } from "../game/environmentExamples";
import { useEditorSound } from "../game/useEditorSound";
import { createGameSave } from "../game/structuralState";
import { publicTurnModel } from "../game/publicTurnModel";
import { publicRepairReport } from "../game/publicRepairReport";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { ConnectivityPanel } from "../components/ConnectivityPanel";
import { CoordinateEditor, ModelIO } from "../components/RuntimeControls";
import { TurnPanel } from "../components/TurnPanel";
import { SharedTableHandoff } from "../components/SharedTableHandoff";
import { SessionRecovery } from "../components/SessionRecovery";
import { Companion } from "../companion/Companion";
import {
  EnvironmentTools,
  EnvironmentTray,
  EnvironmentInspector,
} from "../components/environment";
import {
  EnvironmentBrand,
  EnvironmentStats,
  EnvironmentStepper,
  TurnBanner,
} from "../components/environment/EnvironmentChrome";
import { EngineeringOptions } from "../components/environment/EngineeringOptions";
import { SceneBoundary } from "../components/environment/SceneBoundary";
import { PauseMenu } from "../components/PauseMenu";
import { getSettings, useSettings } from "../menu/settings";
import { solverForSettings } from "../solver";
import { JointPermissions } from "../components/JointPermissions";
import { editorJointPermissions, jointAtSceneSelection, sharedJointPermissions } from "../viewer/jointPermissions";
import { StructureLibrary } from "../components/StructureLibrary";
import { StoredAnalysisPanel } from "../components/StoredAnalysisPanel";
import { GrowthHelp, growthHint } from "../components/environment/GrowthHelp";

type Drawer = "analysis" | "model" | "build" | "turn" | "library" | null;

/** The environment variants compose the same store, scene and analysis boundary. */
export function Workspace() {
  const game = useGameStore();
  // The structural solver is a setting: the game uses one solver at a time,
  // for this check and to decide each completed shared-table turn.
  const stability = useStabilityCheck(
    game.model,
    LEVELS[game.levelId],
    solverForSettings(useSettings()),
  );
  const { jointDisplay } = useSettings();
  const board = game.mode === "multiplayer" ? game.turn?.board : undefined;
  const editorModel = game.mode !== "multiplayer" ? game.model : undefined;
  const joints = useMemo(() => game.style !== "grow-dusk" ? [] : board ? sharedJointPermissions(board)
    : editorModel ? editorJointPermissions(editorModel) : [], [game.style, board, editorModel]);
  const [permissionPick, setPermissionPick] = useState<{ id: string; selection: typeof game.selected; board: typeof board } | null>(null);
  const selectedJoint = useMemo(() => {
    if (permissionPick && permissionPick.selection === game.selected && permissionPick.board === board)
      return joints.find(joint => joint.id === permissionPick.id);
    if (game.selected?.type === "node") return jointAtSceneSelection(joints, game.selected.key, board ? game.turn : null);
  }, [joints, permissionPick, game.selected, board, game.turn]);
  const jointLayer = useMemo(() => game.style === "grow-dusk" && jointDisplay !== "off"
    ? { joints: jointDisplay === "all" ? joints : selectedJoint ? [selectedJoint] : [], selected: selectedJoint?.id }
    : undefined, [game.style, jointDisplay, joints, selectedJoint]);
  // Multiplayer uses independent member-end connections, not the node model.
  const contractCompatible = game.mode !== "multiplayer";
  const [analysis, setAnalysis] = useState<{
    model: typeof game.model;
    result: VoxelAnalysis;
  } | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(() =>
    new URLSearchParams(window.location.search).has("library") ? "library" :
      game.mode === "multiplayer" && game.turn?.finalScore ? "turn" : null,
  );
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(() => getSettings().showHelpOnStart);
  const [paused, setPaused] = useState(false);
  // A committed board is immutable through staging and cancel. Each advance,
  // new match or restore produces a new board, even for the same seed/seat.
  const [readyBoard, setReadyBoard] = useState<NonNullable<typeof game.turn>["board"] | null>(null);
  // Only a turn actually ended in this workspace can prompt Timburr after
  // handoff. Resume and replay retain the report for deliberate inspection.
  const [pendingRepairNotice, setPendingRepairNotice] = useState<string | null>(null);
  const reports = game.mode === "multiplayer" ? game.turn?.reports : undefined;
  const repairs = useMemo(() => reports?.map(publicRepairReport).filter(item => item !== null), [reports]);
  const latestRepair = repairs?.at(-1);
  const repairNoticeId = game.turn && latestRepair &&
    `repair-speech-1/${game.turn.catalogue}/${game.turn.seed}/${latestRepair.turn}`;
  const companion = { repairs, announceRepair: !!repairNoticeId && repairNoticeId === pendingRepairNotice,
    onPresented: () => setPendingRepairNotice(null) };
  const privateTurn = game.mode === "multiplayer" && !game.turn?.finished ? game.turn : null;
  const privateMatchActive = privateTurn !== null;
  const needsHandoff = !!privateTurn && readyBoard !== privateTurn.board;
  const saveCovered = game.sessionSave === "invalid" || game.sessionSave === "failed" ||
    game.sessionSave === "committing" || (game.sessionSave === "writing" && needsHandoff);
  const covered = game.sessionConflict || saveCovered || needsHandoff;
  const [combo, setCombo] = useState(0);
  const [deformed, setDeformed] = useState(false);
  const [scale, setScale] = useState(0); // zero selects automatic display amplification
  const [reference, setReference] = useState(true);
  const [utilization, setUtilization] = useState(true);
  const [loads, setLoads] = useState(true);
  const [loadPath, setLoadPath] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [libraryIndex, setLibraryIndex] = useState(0);
  const sound = useEditorSound(game.model, covered || paused);
  const settings = useSettings();
  const result = analysis?.model === game.model ? analysis.result : null;
  const field = useMemo(() => deformed && result ? deformationField(result, combo) : undefined, [result, combo, deformed]);
  const autoScale = field?.peakM ? Math.max(1, Math.min(500, Math.round(1.2/field.peakM))) : 1;
  const actualScale = scale || autoScale;
  const scoredPreview = game.mode === "multiplayer" && game.turn && isScoredCatalogue(game.turn.catalogue);
  const style = game.style === "engineering" ? "levels" : game.style;
  const isKit = style === "kit";
  const isLevels = style === "levels";
  const isBlocks = style === "blocks";
  // Grow and Grow Dusk follow the Grow Dusk prototype's layout (see the JSX below).
  const isGrowth = style === "grow" || style === "grow-dusk";
  const isSharedTable = game.mode === "multiplayer";
  const progress = result ? modeProgress(game.mode, result) : null;

  async function endPrivateTurn() {
    const current = useGameStore.getState();
    // A queued click from the previous render cannot pass the new player's turn.
    if (current.mode !== "multiplayer" || !current.turn || current.turn.finished ||
        current.turn.board !== readyBoard || paused || document.hidden || current.turnAnalysing) return;
    const ended = current.turn;
    setMessage("Analysing the turn…");
    const error = await current.endTurn();
    if (error) { setMessage(error); return; }
    setPendingRepairNotice(`repair-speech-1/${ended.catalogue}/${ended.seed}/${ended.turn}`);
    setReadyBoard(null);
    setDrawer(null);
    setMessage("");
  }
  function pause() {
    setReadyBoard(null);
    setPaused(true);
  }
  useLayoutEffect(() => {
    if (game.mode === "multiplayer" && game.turn?.finalScore) setDrawer("turn");
  }, [game.mode, game.turn?.finalScore]);
  useLayoutEffect(() => {
    if (game.sessionSave === "failed") setReadyBoard(null);
  }, [game.sessionSave]);
  useLayoutEffect(() => {
    if (!privateMatchActive) return;
    // Conceal before the browser snapshots a backgrounded page. The turn and
    // its reserved cards stay in the store; readiness exists only in this tab.
    const conceal = () => flushSync(() => {
      setReadyBoard(null);
      setMessage("");
    });
    const visibilityChanged = () => { if (document.hidden) conceal(); };
    window.addEventListener("blur", conceal);
    window.addEventListener("pagehide", conceal);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.removeEventListener("blur", conceal);
      window.removeEventListener("pagehide", conceal);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [privateMatchActive]);
  function run() {
    if (contractCompatible) void stability.run(game.model, LEVELS[game.levelId]);
    try {
      setCombo(0);
      setAnalysis({
        model: game.model,
        result:
          game.mode === "multiplayer" && game.turn
            ? analyzeTurn(game.turn, scoredPreview ? "card-gravity" : "with-self-weight")
            : analyzeGame(game.model, LEVELS[game.levelId]),
      });
      setDrawer("analysis");
      setMessage("Experimental analysis · results for the current model");
    } catch (error) {
      setAnalysis(null);
      setMessage(error instanceof Error ? error.message : "Analysis failed");
      setDrawer("analysis");
    }
  }
  function example() {
    if (game.mode === "creative") {
      const model = environmentExample(
        exampleIndex % 2 === 0 ? "tower" : "portal",
      );
      setMessage(
        game.importModel(createGameSave(game.levelId, model)) ??
          "Example loaded",
      );
      setExampleIndex(exampleIndex + 1);
    } else if (game.mode === "forensics") {
      game.reset();
      setMessage("Repair exercise restarted");
    } else
      setMessage(
        game.loadExample()
          ? "Example loaded"
          : "No example is available for this mode",
      );
  }
  // Grow Dusk is the only environment offered; override any persisted style on entry.
  const setStyle = game.setStyle;
  useLayoutEffect(() => {
    if (useGameStore.getState().style !== "grow-dusk") setStyle("grow-dusk");
  }, [setStyle]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 5500);
    return () => window.clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        covered || paused || event.defaultPrevented ||
        controlOwnsKey(event.target) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === "h" || event.key === "?")
        setHelp((value) => !value);
      if (event.key.toLowerCase() === "r") run();
      if (event.key.toLowerCase() === "m" && !event.repeat) sound.toggle();
      if (event.key === "Escape") {
        setDrawer(null);
        game.setSelected(null);
      }
      if (event.key === "Enter" && !event.repeat && privateTurn) {
        event.preventDefault();
        void endPrivateTurn();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  const historyActions = (
    <>
      <button className="btn" onClick={() => setDrawer("library")}>Structure library</button>
      <button
        className="btn icon"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!game.history.length || game.mode === "multiplayer"}
        onClick={game.undo}
      >
        ↶
      </button>
      <button
        className="btn icon"
        aria-label="Redo"
        title="Redo (Ctrl+Y)"
        disabled={!game.future.length || game.mode === "multiplayer"}
        onClick={game.redo}
      >
        ↷
      </button>
      <span className="sep" />
      <button
        className="btn"
        disabled={game.mode === "multiplayer"}
        onClick={example}
      >
        Load example
      </button>
      <button
        className="btn"
        disabled={game.mode === "multiplayer"}
        onClick={game.reset}
      >
        {game.mode === "forensics" ? "Restart" : "Clear"}
      </button>
    </>
  );
  const analysisActions = (
    <>
      <button className={`btn${result ? " on" : ""}`} onClick={run}>
        Run simulation
      </button>
      {result && (
        <button className="btn" onClick={() => setDrawer("analysis")}>
          Results
        </button>
      )}
      <button
        className="btn"
        onClick={() => setDrawer(drawer === "model" ? null : "model")}
      >
        Solver input
      </button>
      <span className="sep" />
      <button
        className={`btn icon${sound.enabled ? " on" : ""}`}
        title={sound.enabled ? "Mute sound (M)" : "Enable sound (M)"}
        aria-label="Sound"
        aria-pressed={sound.enabled}
        onClick={() => void sound.toggle()}
      >
        {sound.enabled ? "♪" : "♩"}
      </button>
      <button
        className="btn icon"
        aria-label="Controls"
        title="Controls (H)"
        onClick={() => setHelp(!help)}
      >
        ?
      </button>
      <button
        className="btn"
        title="Menu (P)"
        aria-haspopup="dialog"
        onClick={pause}
      >
        Menu
      </button>
    </>
  );
  // Top-right bar in the prototype's order: history, model, analysis, sound and
  // help, menu. "Run simulation" stands where the prototype had its mock
  // "Feedback preview", because the app has an experimental analysis instead.
  const growthActions = (
    <>
      <button
        className="btn icon"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!game.history.length || isSharedTable}
        onClick={game.undo}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 4 3 8l4 4" />
          <path d="M3 8h8a5 5 0 0 1 0 10H8" />
        </svg>
      </button>
      <button
        className="btn icon"
        aria-label="Redo"
        title="Redo (Ctrl+Y)"
        disabled={!game.future.length || isSharedTable}
        onClick={game.redo}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m13 4 4 4-4 4" />
          <path d="M17 8H9a5 5 0 0 0 0 10h3" />
        </svg>
      </button>
      <span className="sep" />
      <button
        className="btn"
        title="Replace the structure with an example"
        disabled={isSharedTable}
        onClick={example}
      >
        Load example
      </button>
      <button
        className="btn"
        title={
          game.mode === "forensics"
            ? "Restore the prepared structure"
            : "Remove every member you placed"
        }
        disabled={isSharedTable}
        onClick={game.reset}
      >
        {game.mode === "forensics" ? "Restart" : "Clear"}
      </button>
      <span className="sep" />
      <button
        className={`btn${result ? " on" : ""}`}
        title="Run the experimental analysis (R)"
        onClick={run}
      >
        Run simulation
      </button>
      {result && (
        <button className="btn" onClick={() => setDrawer("analysis")}>
          Results
        </button>
      )}
      <button
        className={`btn${drawer === "model" ? " on" : ""}`}
        title="Show the solver-input document"
        onClick={() => setDrawer(drawer === "model" ? null : "model")}
      >
        Solver input
      </button>
      <span className="sep" />
      <button
        className="btn icon"
        title="Sound on/off (M)"
        aria-label="Sound"
        aria-pressed={sound.enabled}
        onClick={() => void sound.toggle()}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8v4h3l4 3V5L6 8H3z" fill="currentColor" />
          {sound.enabled ? (
            <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" />
          ) : (
            <path d="m13 8 4 4m0-4-4 4" />
          )}
        </svg>
      </button>
      <button
        className={`btn icon${help ? " on" : ""}`}
        aria-label="Controls"
        title="Controls (H or ?)"
        aria-pressed={help}
        onClick={() => setHelp(!help)}
      >
        <b style={{ fontSize: 16 }}>?</b>
      </button>
      <span className="sep" />
      <button
        className="btn"
        title="Menu (Esc or P)"
        aria-haspopup="dialog"
        onClick={() => setPaused(true)}
      >
        Menu
      </button>
    </>
  );
  // Workspace extras the prototype does not have; kept together, bottom right.
  const secondaryActions = (
    <>
      <button className="btn" onClick={() => setDrawer("build")}>
        Build options
      </button>
      {isGrowth && (
        <button className="btn" onClick={() => setDrawer("library")}>
          Structure library
        </button>
      )}
      {isSharedTable && (
        <button className="btn" onClick={() => setDrawer("turn")}>
          Turn details
        </button>
      )}
    </>
  );
  const showLegend =
    !!result &&
    !result.error &&
    utilization &&
    !loadPath &&
    result.designChecksAvailable !== false;
  const pauseMenu = (
    <PauseMenu open={paused} onOpen={pause} onClose={() => setPaused(false)}
      escapeBusy={!covered && drawer !== null} onMessage={setMessage} />
  );
  if (game.sessionConflict) return <SharedTableHandoff player={1} conflict onReady={() => window.location.reload()} />;
  if (saveCovered) return <SessionRecovery />;
  if (covered && privateTurn) return (
    <>
      <SharedTableHandoff player={privateTurn.playerIndex + 1} onReady={() => {
        if (!paused && !document.hidden) setReadyBoard(privateTurn.board);
      }} />
      {pauseMenu}
    </>
  );
  return (
    <main
      className={`environment${game.turn?.playerIndex === 1 ? " p2" : ""}${settings.reducedMotion ? " rm" : ""}`}
      data-style={style}
    >
      <div id="stage">
        <SceneBoundary>
          <Scene
            jointLayer={jointLayer}
            result={result}
            combo={combo}
            deformed={deformed}
            scale={actualScale}
            field={field}
            reference={reference}
            utilization={utilization && result?.designChecksAvailable !== false}
            loads={loads}
            loadPath={loadPath}
            onToggleLoadPath={() => setLoadPath(!loadPath)}
            onMessage={setMessage}
          />
        </SceneBoundary>
      </div>
      <div id="ui">
        {isKit ? (
          <>
            <div id="top-left">{historyActions}</div>
            <div id="top-right">{analysisActions}</div>
            <TurnBanner onEndTurn={() => void endPrivateTurn()} />
            <div id="corner">
              <EnvironmentBrand />
              <EnvironmentStats />
            </div>
            {game.mode === "multiplayer" &&
              game.turn?.players.map((player, index) => (
                <div
                  key={player.id}
                  id={`strip${index + 1}`}
                  className={`strip panel${game.turn?.playerIndex === index ? " active" : ""}`}
                >
                  <i className="dot" />
                  <div>
                    <b>
                      Player {index + 1}
                      {game.turn?.playerIndex === index && <em>to play</em>}
                    </b>
                    <span>
                      {
                        game.turn?.board.members.filter(
                          (member) => member.owner === player.id,
                        ).length
                      }{" "}
                      sticks
                    </span>
                  </div>
                </div>
              ))}
          </>
        ) : isGrowth ? (
          <>
            <div id="topleft">
              <EnvironmentBrand />
              <TurnBanner onEndTurn={() => void endPrivateTurn()} />
            </div>
            <div id="actions" className="chip">
              {growthActions}
            </div>
            <div id="cornerleft">
              <EnvironmentStats />
            </div>
            <div id="cornerright">
              {help && <GrowthHelp onClose={() => setHelp(false)} />}
              {showLegend && (
                <div id="legend" className="chip show">
                  <b>Utilization</b>
                  <div className="swatches">
                    <span>
                      <i style={{ background: "#4cae77" }} />
                      up to 60%
                    </span>
                    <span>
                      <i style={{ background: "#e5a33f" }} />
                      up to 100%
                    </span>
                    <span>
                      <i style={{ background: "#ed4545" }} />
                      over
                    </span>
                  </div>
                  <p>Experimental analysis, not design evidence.</p>
                </div>
              )}
              <div className="secondary chip">{secondaryActions}</div>
            </div>
          </>
        ) : (
          <>
            <div id="topleft">
              <EnvironmentBrand />
              {!isLevels && <TurnBanner onEndTurn={() => void endPrivateTurn()} />}
            </div>
            <div
              id={isBlocks ? "top-right" : "actions"}
              className={isLevels ? "" : "chip row"}
            >
              {historyActions}
              {analysisActions}
            </div>
            <div id="cornerleft">
              <EnvironmentStats />
              {field && <span className="deformation-readout" role="status">
                {field.spans.size ? `Displacement ×${actualScale}${reference ? " · dashed reference" : ""}` : "Displacement unavailable"}
              </span>}
            </div>
          </>
        )}
        <div id="dock">
          <div id="hint" role="status">
            {game.mode === "creative" && game.tool === "found"
              ? "Click solid ground to place a fixed foundation or select an existing support"
              : game.mode === "forensics"
              ? progress === "complete"
                ? "Structure repaired · experimental checks passed"
                : "Find the floating member and connect it to the supported frame"
              : game.mode === "load-space"
                ? "Carry the suspended load to a foundation"
                : game.chainStart
                  ? "Choose the next point · Esc to release"
                  : game.tool === "joint"
                    ? "Click a joint to explore its degrees of freedom"
                    : game.tool === "found"
                      ? "Click solid ground to place or remove a foundation"
                    : game.tool === "load"
                      ? "Click a joint to place or edit a load"
                      : isBlocks
                        ? "Click a bay face to stack · choose Brace to stiffen"
                        : isKit
                          ? "Take a piece from the tray, then place it on the board"
                          : "Click a joint or a ground point to begin"}
          </div>
          {isKit ? (
            <EnvironmentTray style={game.style} onMessage={setMessage} />
          ) : isGrowth && isSharedTable ? (
            // Cards, not tools, drive a Shared table turn, so the hand takes the dock.
            <div className="shared-hand docked">
              <EnvironmentTray style="kit" onMessage={setMessage} />
            </div>
          ) : (
            <EnvironmentTools style={game.style} onMessage={setMessage} />
          )}
        </div>
        {isLevels && <EnvironmentStepper />}
        {isSharedTable && !isKit && !isGrowth && (
          <div className="shared-hand">
            <EnvironmentTray style="kit" onMessage={setMessage} />
          </div>
        )}
        <EnvironmentInspector onMessage={setMessage} />
        <div className="environment-switch">
          <button className="btn" onClick={() => setDrawer("build")}>
            Build options
          </button>
          {game.mode === "multiplayer" && (
            <button className="btn" onClick={() => setDrawer("turn")}>
              Turn details
            </button>
          )}
        </div>
        {pauseMenu}
        {message && (
          <div id="toast" className="chip show" role="status">
            {message}
          </div>
        )}
        {game.persistenceError && (
          <div className="storage-alert chip" role="alert">
            {game.persistenceError}
          </div>
        )}
        {help && !isGrowth && (
          <section id="help" className="chip card panel show">
            <h3>
              Controls{" "}
              <button
                className="btn icon"
                onClick={() => setHelp(false)}
                aria-label="Close controls"
              >
                ×
              </button>
            </h3>
            <table>
              <tbody>
                <tr>
                  <td>Click</td>
                  <td>place or select</td>
                </tr>
                <tr>
                  <td>Drag · wheel</td>
                  <td>orbit · zoom</td>
                </tr>
                <tr>
                  <td>Wheel · [ ]</td>
                  <td>step overlapping targets while growing</td>
                </tr>
                <tr>
                  <td>1 · 2 · 3</td>
                  <td>member · joint · load</td>
                </tr>
                <tr>
                  <td>X · I</td>
                  <td>erase · inspect</td>
                </tr>
                <tr>
                  <td>Q · E</td>
                  <td>turn the board</td>
                </tr>
                <tr>
                  <td>W · S</td>
                  <td>working level</td>
                </tr>
                <tr>
                  <td>P</td>
                  <td>pause menu</td>
                </tr>
                <tr>
                  <td>F</td>
                  <td>fit structure</td>
                </tr>
                <tr>
                  <td>Ctrl Z · Ctrl Y</td>
                  <td>undo · redo</td>
                </tr>
              </tbody>
            </table>
            <p>
              Build options includes precise coordinates and the engineering
              catalog.
            </p>
          </section>
        )}
        {drawer && (
          <aside
            id="drawer"
            className="show open panel"
            aria-label={`${drawer} drawer`}
          >
            <div className="drawer-heading">
              <h2>
                {drawer === "library" ? "Structure library" : drawer === "analysis"
                  ? "Structural feedback"
                  : drawer === "model"
                    ? "Solver input"
                    : drawer === "turn"
                      ? "Shared table"
                      : "Build options"}
              </h2>
              {!paused && <Companion area="drawer" {...companion} onForemanAccent={sound.foremanAccent} />}
              <button
                className="btn icon"
                aria-label="Close drawer"
                onClick={() => setDrawer(null)}
              >
                ×
              </button>
            </div>
            <div className="drawer-content">
              {drawer === "library" && <StructureLibrary index={libraryIndex} setIndex={setLibraryIndex} />}
              {drawer === "analysis" && (
                <>
                  <p className="analysis-notice">Experimental results · current model</p>
                  {contractCompatible && (
                    <StabilityCheckPanel
                      check={stability.check}
                      solverName={stability.solverName}
                      onNonlinear={stability.supportsNonlinearService ? () => void stability.run(game.model, LEVELS[game.levelId], true) : undefined}
                    />
                  )}
                  {!contractCompatible && <p className="result-source">Selected structural solver: <strong>{stability.solverName}</strong><br />Shared-table analysis currently uses the approximate voxel solver. The selected structural solver is used for single-player checks.</p>}
                  <AnalysisPanel
                    result={result}
                    message={message}
                    combo={combo}
                    setCombo={setCombo}
                    deformed={deformed}
                    setDeformed={setDeformed}
                    scale={scale}
                    setScale={setScale}
                    field={field}
                    actualScale={actualScale}
                    reference={reference}
                    setReference={setReference}
                    shared={game.mode === "multiplayer"}
                    scored={!!scoredPreview}
                    draft={!!game.turn && (game.turn.draft.members.length + game.turn.draft.loads.length + game.turn.draft.connections.length > 0)}
                    utilization={utilization}
                    setUtilization={setUtilization}
                    loads={loads}
                    setLoads={setLoads}
                    loadPath={loadPath}
                    setLoadPath={setLoadPath}
                    selectMember={(id) =>
                      game.setSelected({ type: "member", id })
                    }
                  />
                  <ConnectivityPanel
                    model={game.model}
                    turn={game.mode === "multiplayer" ? game.turn : null}
                    onSelectMember={(id) =>
                      game.setSelected({ type: "member", id })
                    }
                    onSelectNode={(key) =>
                      game.setSelected({ type: "node", key })
                    }
                  />

                </>
              )}
              {drawer === "model" && (
                <>
                  <p>
                    Versioned shared model ·{" "}
                    {game.mode === "multiplayer"
                      ? "public view of the committed board and its end connections"
                      : "grid coordinates are converted at the analysis boundary"}
                    .
                  </p>
                  <pre>
                    {JSON.stringify(
                      game.mode === "multiplayer"
                        ? game.turn && publicTurnModel(game.turn)
                        : game.exportModel(),
                      null,
                      2,
                    )}
                  </pre>
                  <ModelIO game={game} onMessage={setMessage} />
                  <StoredAnalysisPanel />
                </>
              )}
              {drawer === "build" && (
                <>
                  {style === "grow-dusk" && <JointPermissions joints={joints} selected={selectedJoint} mode={jointDisplay}
                    select={id => setPermissionPick({ id, selection: game.selected, board })} />}
                  {game.mode === "challenge" && (
                    <label>
                      Challenge
                      <select
                        value={game.levelId}
                        onChange={(event) => {
                          const id = Object.keys(LEVELS).find(
                            (id) => id === event.target.value,
                          );
                          if (id && id in LEVELS)
                            game.setLevel(id as keyof typeof LEVELS);
                        }}
                      >
                        {Object.entries(LEVELS).map(([id, level]) => (
                          <option key={id} value={id}>
                            {level.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <EngineeringOptions onMessage={setMessage} />
                  <CoordinateEditor game={game} onMessage={setMessage} />
                  <p>
                    Point loads and support laws are edited by selecting their
                    joint.
                  </p>
                  {game.mode !== "multiplayer" && (
                    <button
                      className="btn"
                      onClick={() => game.setTool("found")}
                    >
                      Place foundation
                    </button>
                  )}
                  <ConnectivityPanel
                    model={game.model}
                    turn={game.mode === "multiplayer" ? game.turn : undefined}
                    onSelectMember={(id) =>
                      game.setSelected({ type: "member", id })
                    }
                    onSelectNode={(key) =>
                      game.setSelected({ type: "node", key })
                    }
                  />
                </>
              )}
              {drawer === "turn" && (
                <>
                  <TurnPanel game={game} onMessage={setMessage} onEndTurn={() => void endPrivateTurn()} />
                  <p role="status">{game.sessionSave === "writing" ? "Saving draft. " : ""}{game.savedRevision === null
                    ? "No confirmed save yet." : `Last confirmed save revision ${game.savedRevision}`}</p>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      {!paused && !drawer && !help && <Companion area="board" {...companion} onForemanAccent={sound.foremanAccent} />}
    </main>
  );
}
