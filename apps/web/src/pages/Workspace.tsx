import { useGameStore } from '../game/store';
import { Scene } from '../viewer/Scene';
import { BuildTools, Inspector } from '../components/Panels';

export function Workspace() {
  const model = useGameStore((s) => s.model);
  const analysis = useGameStore((s) => s.analysis);
  const loadModel = useGameStore((s) => s.loadModel);
  const runAnalysis = useGameStore((s) => s.runAnalysis);
  const result = analysis.phase === 'done' ? analysis.result : undefined;
  const empty = model.nodes.length === 0;

  return (
    <main className="workspace">
      <div className="heading">
        <div>
          <p className="eyebrow">● &nbsp; THE WORKSPACE / NEW PROJECT</p>
          <h1>Let’s build something <em>brilliant.</em></h1>
          <p>Explore structures, one connection at a time.</p>
        </div>
        <span className="draft">● &nbsp; NEW PROJECT</span>
      </div>
      <div className="layout">
        <BuildTools onLoadExample={(example) => loadModel(example.build())} />
        <section className="viewport" aria-label="Structural workspace">
          <Scene model={model} result={result} />
          <div className="view-label">● &nbsp; 3D VIEW <span>PERSPECTIVE</span></div>
          {empty && (
            <div className="view-message">
              <span>✳</span>
              <strong>A little room to think.</strong>
              <p>Your structure will take shape here.</p>
            </div>
          )}
          {result?.status === 'success' && (
            <div className="legend"><i className="tension" /> Tension <i className="compression" /> Compression</div>
          )}
          {result?.status === 'unstable' && (
            <div className="legend"><i className="mechanism" /> How it moves</div>
          )}
          <div className="view-help">↗ &nbsp; DRAG TO ORBIT &nbsp;&nbsp; SCROLL TO ZOOM <span>X / Y / Z</span></div>
        </section>
        <Inspector model={model} analysis={analysis} onRun={() => void runAnalysis()} />
      </div>
      <footer>DESIGNED FOR CURIOUS MINDS ✳ <span>A PLAYGROUND FOR STRUCTURAL THINKING</span></footer>
    </main>
  );
}
