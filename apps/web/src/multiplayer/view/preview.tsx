import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ElementInspector } from './ElementInspector';
import { MultiplayerScene } from './MultiplayerScene';
import { sceneFixture } from './fixtures';
import { quarterPorts } from './viewModel';
import type { SceneHandle, ViewSelection } from './types';
import './preview.css';

function Preview() {
  const [data, setData] = useState(sceneFixture);
  const [selection, select] = useState<ViewSelection>({ kind: 'member', id: 'spring-quarter' });
  const [reduced, reduce] = useState(false), [paused, pause] = useState(false), [placing, place] = useState(false);
  const [target, setTarget] = useState('No target selected');
  const scene = useRef<SceneHandle>(null);
  return <main className="mp-preview"><header><h1>Degrees of Freedom · multiplayer view</h1><p>Session 3 standalone integration preview · synthetic evidence, not solver verification</p></header>
    <div className="mp-preview-actions"><button onClick={() => reduce(v => !v)}>Reduced motion: {reduced ? 'on' : 'off'}</button><button onClick={() => pause(v => !v)}>Presentation: {paused ? 'paused' : 'running'}</button>
      <button onClick={() => place(v => !v)}>Placement targets: {placing ? 'on' : 'off'}</button>
      <button onClick={() => setData(old => ({ ...old, revision: old.revision === sceneFixture.revision ? 'pending-turn-4' : sceneFixture.revision }))}>Toggle stale checkpoint</button>
      <button onClick={() => { setData(old => ({ ...old, revision: 'draft-preview', members: old.members.map(m => m.id === 'spring-half' ? { ...m, phase: 'draft' } : m) })); select({ kind: 'member', id: 'spring-half' }); }}>Inspect editable draft</button>
    </div><p className="mp-preview-target" role="status">{target}</p>
    <div className="mp-preview-layout"><MultiplayerScene ref={scene} data={data} selection={selection} onSelectionChange={select} reducedMotion={reduced} paused={paused}
      placement={placing ? { origin: [7.5, 9, 6], maxLength: 10, quarterPorts: data.members.flatMap(m => m.quarterPorts) } : undefined}
      onTargetActivate={t => { setTarget(`${t.id}: ${t.position.join(', ')} (draft selection only)`); select({ kind: 'target', id: t.id }); }} />
      <ElementInspector data={data} memberId={selection?.kind === 'member' ? selection.id : null} onClose={() => select(null)} onDraftChange={(id, edit) => setData(old => ({ ...old, members: old.members.map(m => m.id === id && m.phase === 'draft' && !m.setupLocked ? { ...m, end: edit.end, quarterPorts: quarterPorts(m.id, m.start, edit.end) } : m) }))} />
    </div></main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
