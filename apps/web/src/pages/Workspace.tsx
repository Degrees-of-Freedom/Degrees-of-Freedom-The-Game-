import { useEffect, useState } from 'react';
import { Scene } from '../viewer/Scene';
import { LEVELS } from '../game/levels';
import { CELL_SIZE, type LevelId } from '../game/model';
import { useGameStore } from '../game/store';
import { BuildTools } from '../components/BuildTools';
import { StructureInspector } from '../components/StructureInspector';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { StabilityCheckPanel } from '../components/StabilityCheckPanel';
import { analyzeGame, autoDesignGame } from '../game/analysis';
import { useStabilityCheck } from '../game/useStabilityCheck';
import type { VoxelAnalysis } from '../solver/voxel';

export function Workspace() {
  const game = useGameStore();
  const level = LEVELS[game.levelId];
  const [analysis, setAnalysis] = useState<{
    model: typeof game.model;
    level: LevelId;
    result: VoxelAnalysis;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [combo, setCombo] = useState(0);
  const [deformed, setDeformed] = useState(false);
  const [scale, setScale] = useState(1);
  const [utilization, setUtilization] = useState(true);
  const [loads, setLoads] = useState(true);
  const [loadPath, setLoadPath] = useState(false);
  const result =
    analysis?.model === game.model && analysis.level === game.levelId
      ? analysis.result
      : null;
  const stability = useStabilityCheck(game.model);
  function run() {
    // The contract-solver stability check runs alongside the voxel analysis and
    // reports on its own, so a solver failure never blocks the voxel result.
    void stability.run(game.model, level);
    try {
      setAnalysis({
        model: game.model,
        level: game.levelId,
        result: analyzeGame(game.model, level),
      });
      setMessage('');
    } catch (error) {
      setAnalysis(null);
      setMessage(
        `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.matches(
          'input, select, textarea, button',
        ) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === 'r') run();
      if (event.key.toLowerCase() === 'd') setDeformed((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  function autoDesign() {
    try {
      const source = game.model;
      const designed = autoDesignGame(source, level);
      if (designed.changed && game.applyAutoDesign(designed.model, source)) {
        setAnalysis({
          model: useGameStore.getState().model,
          level: game.levelId,
          result: designed.analysis,
        });
        setMessage('Beam sections updated.');
      } else {
        setAnalysis({
          model: source,
          level: game.levelId,
          result: designed.analysis,
        });
        setMessage(
          designed.analysis.error ??
            (designed.analysis.mechanism
              ? 'Resolve the mechanism before auto-design.'
              : 'No beam sections changed.'),
        );
      }
    } catch (error) {
      setMessage(
        `Auto-design failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return (
    <main className="workspace">
      <div className="heading">
        <div>
          <p className="eyebrow">● &nbsp; THE WORKSPACE / VOXEL STRUCT</p>
          <h1>
            Build something <em>brilliant.</em>
          </h1>
          <p>Explore structures, one connection at a time.</p>
        </div>
        <span className="draft">EXPERIMENTAL PROTOTYPE</span>
      </div>
      <div className="workspace-actions">
        <label>
          Challenge{' '}
          <select
            value={game.levelId}
            onChange={(e) => game.setLevel(e.target.value as LevelId)}
          >
            {Object.entries(LEVELS).map(([id, l]) => (
              <option key={id} value={id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            if (!game.loadExample())
              setMessage('No example is available for this challenge.');
            else setMessage('');
          }}
        >
          Load example
        </button>
        {level.random && (
          <button onClick={() => game.newLayout()}>New layout</button>
        )}
        <button onClick={game.undo} disabled={!game.history.length}>
          Undo
        </button>
        <button onClick={game.reset}>Clear</button>
        <button onClick={autoDesign}>Auto-design beams</button>
        <button className="primary-action" onClick={run}>
          Run analysis
        </button>
      </div>
      <div className="layout">
        <BuildTools game={game} />
        <section className="viewport" aria-label="Structural workspace">
          <Scene
            loadPath={loadPath}
            onToggleLoadPath={() => setLoadPath((value) => !value)}
            onMessage={setMessage}
            result={result}
            combo={combo}
            deformed={deformed}
            scale={scale}
            utilization={utilization}
            loads={loads}
          />
          <div className="view-label">
            ● &nbsp; 3D VIEW <span>PERSPECTIVE</span>
          </div>
          <div className="plane-controls">
            <button onClick={() => game.setWorkK(game.workK - 1)}>−</button>
            <span>Build plane: {game.workK * CELL_SIZE} m</span>
            <button onClick={() => game.setWorkK(game.workK + 1)}>+</button>
          </div>
          <div className="view-help">
            DRAG TO ORBIT &nbsp; SCROLL TO ZOOM <span>X / Y / Z</span>
          </div>
        </section>
        <StructureInspector game={game} result={result} setMessage={setMessage}>
          <AnalysisPanel
            result={result}
            message={message}
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
            selectMember={(id) => game.setSelected({ type: 'member', id })}
          />
          <StabilityCheckPanel
            check={stability.check}
            solverName={stability.solverName}
          />
        </StructureInspector>
      </div>
      <footer>
        DESIGNED FOR CURIOUS MINDS ✳{' '}
        <span>A PLAYGROUND FOR STRUCTURAL THINKING</span>
      </footer>
    </main>
  );
}
