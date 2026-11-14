import { useEffect, useLayoutEffect, useState } from "react";
import { Scene } from "../viewer/Scene";
import { LEVELS } from "../game/levels";
import { useGameStore } from "../game/store";
import { analyzeGame } from "../game/analysis";
import { analyzeTurn } from "../game/turnAnalysis";
import { stabilityCheckOf, useSolverRuns } from "../game/useSolverRuns";
import { createSolvers, type RunContext } from "../game/solvers";
import { defaultSolver } from "../solver";
import { StabilityCheckPanel } from "../components/StabilityCheckPanel";
import { SolverRunsPanel } from "../components/SolverRunsPanel";
import { modeProgress } from "../game/modes";
import { environmentExample } from "../game/environmentExamples";
import { useEditorSound } from "../game/useEditorSound";
import { createGameSave } from "../game/structuralState";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { ConnectivityPanel } from "../components/ConnectivityPanel";
import { CoordinateEditor, ModelIO } from "../components/RuntimeControls";
import { TurnPanel } from "../components/TurnPanel";
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
import { getSettings, updateSettings, useSettings } from "../menu/settings";
import { StructureLibrary } from "../components/StructureLibrary";

const SOLVERS = createSolvers(defaultSolver);
/** The contract solver whose result the stability panel shows when voxel is the primary solver. */
const DEFAULT_CHECK_ID = "opensees-nonlinear";

type Drawer = "analysis" | "model" | "build" | "turn" | "library" | null;

/** The environment variants compose the same store, scene and analysis boundary. */
export function Workspace() {
  const game = useGameStore();
  const solverRuns = useSolverRuns(game.model, SOLVERS);
  // Multiplayer uses independent member-end connections, not the node model.
  const contractCompatible = game.mode !== "multiplayer";
  const runContext: RunContext = {
    model: game.model,
    level: LEVELS[game.levelId],
    contractCompatible,
    analyzeVoxel: () =>
      game.mode === "multiplayer" && game.turn
        ? analyzeTurn(game.turn)
        : analyzeGame(game.model, LEVELS[game.levelId]),
  };
  const reasons = Object.fromEntries(
    SOLVERS.map((solver) => [solver.id, solver.unavailableReason(runContext)]),
  );
  const stored = useSettings().primarySolver;
  // A stored id that no longer exists or cannot run here falls back to voxel.
  const primary = SOLVERS.some((solver) => solver.id === stored && !reasons[solver.id])
    ? stored
    : "voxel";
  const [drawer, setDrawer] = useState<Drawer>(() =>
    new URLSearchParams(window.location.search).has("library") ? "library" : null,
  );
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(() => getSettings().showHelpOnStart);
  const [paused, setPaused] = useState(false);
  const [combo, setCombo] = useState(0);
  const [deformed, setDeformed] = useState(false);
  const [scale, setScale] = useState(1);
  const [utilization, setUtilization] = useState(true);
  const [loads, setLoads] = useState(true);
  const [loadPath, setLoadPath] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [libraryIndex, setLibraryIndex] = useState(0);
  const sound = useEditorSound(game.model);
  const voxelState = solverRuns.runs.voxel;
  const voxelNative = voxelState?.phase === "done" ? voxelState.run.native : null;
  const result = voxelNative?.kind === "voxel" ? voxelNative.result : null;
  const voxelFailure =
    voxelState?.phase === "done" && !voxelNative ? voxelState.run.message : "";
  const checkId = SOLVERS.find((solver) => solver.id === primary)?.remote
    ? primary
    : DEFAULT_CHECK_ID;
  const style = game.style === "engineering" ? "levels" : game.style;
  const isKit = style === "kit";
  const isLevels = style === "levels";
  const isBlocks = style === "blocks";
  const progress = result ? modeProgress(game.mode, result) : null;

  function run() {
    // Voxel keeps its companion OpenSees check; another primary solver runs alone.
    const ids =
      primary === "voxel"
        ? ["voxel", ...(reasons[DEFAULT_CHECK_ID] ? [] : [DEFAULT_CHECK_ID])]
        : [primary];
    setCombo(0);
    void solverRuns.run(ids, runContext);
    setDrawer("analysis");
    setMessage(
      primary === "voxel"
        ? "Experimental analysis · results for the current model"
        : "Showing the selected solver only · the 3D results come from the voxel solver",
    );
  }
  function compare() {
    setCombo(0);
    void solverRuns.run(
      SOLVERS.filter((solver) => !reasons[solver.id]).map((solver) => solver.id),
      runContext,
    );
    setDrawer("analysis");
    setMessage("Running every available solver, one after another");
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
        (event.target as HTMLElement)?.matches(
          "input, textarea, select, button",
        ) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === "h" || event.key === "?")
        setHelp((value) => !value);
      if (event.key.toLowerCase() === "r") run();
      if (event.key.toLowerCase() === "m") void sound.toggle();
      if (event.key === "Escape") {
        setDrawer(null);
        game.setSelected(null);
      }
      if (event.key === "Enter" && game.mode === "multiplayer")
        setMessage(game.endTurn() ?? "Turn committed");
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
      <select
        className="solver-select"
        aria-label="Solver"
        title="Solver for Run simulation. Voxel also runs the OpenSees check when a service is available."
        value={primary}
        onChange={(event) => updateSettings({ primarySolver: event.target.value })}
      >
        {SOLVERS.map((solver) => (
          <option key={solver.id} value={solver.id} disabled={!!reasons[solver.id]}>
            {solver.label}
            {reasons[solver.id] ? " (unavailable)" : ""}
          </option>
        ))}
      </select>
      <button className={`btn${result ? " on" : ""}`} onClick={run}>
        Run simulation
      </button>
      <button className="btn" disabled={solverRuns.busy} onClick={compare}>
        Compare solvers
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
        title="Sound (M)"
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
        onClick={() => setPaused(true)}
      >
        Menu
      </button>
    </>
  );
  return (
    <main
      className={`environment${game.turn?.playerIndex === 1 ? " p2" : ""}`}
      data-style={style}
    >
      <div id="stage">
        <SceneBoundary>
          <Scene
            result={result}
            combo={combo}
            deformed={deformed}
            scale={scale}
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
            <TurnBanner onMessage={setMessage} />
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
        ) : (
          <>
            <div id="topleft">
              <EnvironmentBrand />
              {!isLevels && <TurnBanner onMessage={setMessage} />}
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
            </div>
          </>
        )}
        <div id="dock">
          <div id="hint" role="status">
            {game.mode === "forensics"
              ? progress === "complete"
                ? "Structure repaired · experimental checks passed"
                : "Find the floating member and connect it to the supported frame"
              : game.mode === "load-space"
                ? "Carry the suspended load to a foundation"
                : game.chainStart
                  ? "Choose the next point · Esc to release"
                  : game.tool === "joint"
                    ? "Click a joint to explore its degrees of freedom"
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
          ) : (
            <EnvironmentTools style={game.style} onMessage={setMessage} />
          )}
        </div>
        {isLevels && <EnvironmentStepper />}
        {game.mode === "multiplayer" && !isKit && (
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
        <PauseMenu
          open={paused}
          onOpen={() => setPaused(true)}
          onClose={() => setPaused(false)}
          escapeBusy={drawer !== null}
          onMessage={setMessage}
        />
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
        {help && (
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
                  <p className="analysis-notice">
                    Experimental analysis · not mock data
                  </p>
                  <AnalysisPanel
                    result={result}
                    message={voxelFailure || message}
                    combo={combo}
                    setCombo={setCombo}
                    deformed={deformed}
                    setDeformed={setDeformed}
                    scale={scale}
                    setScale={setScale}
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
                  {contractCompatible && (
                    <StabilityCheckPanel check={stabilityCheckOf(solverRuns.runs[checkId])} />
                  )}
                  <SolverRunsPanel solvers={SOLVERS} runs={solverRuns.runs} reasons={reasons} />
                </>
              )}
              {drawer === "model" && (
                <>
                  <p>
                    Versioned shared model ·{" "}
                    {game.mode === "multiplayer"
                      ? "the turn log retains individual end connections"
                      : "grid coordinates are converted at the analysis boundary"}
                    .
                  </p>
                  <pre>
                    {JSON.stringify(
                      game.mode === "multiplayer"
                        ? game.turn
                        : game.exportModel(),
                      null,
                      2,
                    )}
                  </pre>
                  <ModelIO game={game} onMessage={setMessage} />
                </>
              )}
              {drawer === "build" && (
                <>
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
                <TurnPanel game={game} onMessage={setMessage} />
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
