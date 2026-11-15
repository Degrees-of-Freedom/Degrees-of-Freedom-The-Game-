import { useEffect, useRef, useState } from 'react';
import { createAnalysisResultsStore, parseStructuralAnalysisRequest, type StructuralAnalysisResult } from '@dof/solver-contract';
import { LOCAL_OPENSEES_URL } from '../solver';
import { runStoredOpenSees } from '../solver/runStoredOpenSees';
import { exampleStructuralRequest } from '../solver/exampleStructuralRequest';

/** Explicitly runs canonical requests; the current voxel game is not silently converted. */
export function StoredAnalysisPanel() {
  const [text, setText] = useState('');
  const [modelId, setModelId] = useState('');
  const [runs, setRuns] = useState<StructuralAnalysisResult[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; inFlight.current?.abort(); }, []);

  function changeText(value: string) {
    generation.current++;
    inFlight.current?.abort();
    setBusy(false);
    setText(value);
  }
  function loadHistory(id: string) {
    try {
      const history = createAnalysisResultsStore(localStorage).read(id);
      if (history.status === 'error') { setRuns([]); setMessage(`Could not read saved runs: ${history.message}`); }
      else { setRuns(history.status === 'found' ? history.results : []); setMessage(history.status === 'found' ? `${history.results.length} saved run(s).` : 'No saved runs for this model.'); }
    } catch { setRuns([]); setMessage('Browser storage is unavailable.'); }
  }
  async function run() {
    const baseUrl = import.meta.env.VITE_OPENSEES_URL || (import.meta.env.DEV ? LOCAL_OPENSEES_URL : undefined);
    if (!baseUrl) { setMessage('No OpenSees service is configured.'); return; }
    if (new TextEncoder().encode(text).byteLength > 2_000_000) { setMessage('The request must be smaller than 2 MB.'); return; }
    let request;
    try { request = parseStructuralAnalysisRequest(JSON.parse(text)); }
    catch { setMessage('Enter a valid structural analysis request.'); return; }
    if (!globalThis.crypto?.randomUUID) { setMessage('A secure browser context is needed to identify this run.'); return; }
    const runId = globalThis.crypto.randomUUID();
    const current = ++generation.current;
    inFlight.current?.abort();
    const controller = new AbortController(); inFlight.current = controller;
    setBusy(true); setMessage('Running an experimental OpenSees check…');
    try {
      const outcome = await runStoredOpenSees(localStorage, request, { baseUrl, runId, signal: controller.signal, isCurrent: () => generation.current === current });
      if (generation.current !== current) return;
      if (outcome.status === 'stored') {
        setModelId(request.snapshot.modelId);
        const history = createAnalysisResultsStore(localStorage).read(request.snapshot.modelId);
        if (history.status === 'found') setRuns(history.results);
        setMessage(`Saved ${outcome.result.status} result. Results are experimental and unverified.`);
      } else if (outcome.status === 'error') setMessage(`Could not save analysis: ${outcome.message}`);
      else setMessage('Analysis was canceled or superseded.');
    } catch { if (generation.current === current) setMessage('Browser storage is unavailable.'); }
    finally { if (generation.current === current) setBusy(false); }
  }
  return (
    <details>
      <summary>Run and review saved structural analyses</summary>
      <p>Use a solver-neutral structural analysis request. The current game model is not automatically converted. OpenSees supports a limited linear subset; results are experimental and not used for scoring.</p>
      <button type="button" className="btn" onClick={() => changeText(JSON.stringify(exampleStructuralRequest, null, 2))}>Load cantilever example</button>
      <label htmlFor="stored-analysis-request">Structural analysis request JSON</label>
      <textarea id="stored-analysis-request" rows={8} value={text} onChange={event => changeText(event.target.value)} />
      <button type="button" className="btn" disabled={busy || !text} onClick={() => void run()}>{busy ? 'Running…' : 'Run and save'}</button>
      <label htmlFor="stored-analysis-model">Model ID</label>
      <input id="stored-analysis-model" value={modelId} onChange={event => setModelId(event.target.value)} />
      <button type="button" className="btn" disabled={!modelId} onClick={() => loadHistory(modelId)}>Load saved runs</button>
      {message && <p role="status">{message}</p>}
      {runs.map(result => <details key={result.runId}><summary>{result.finishedAt} · {result.status} · {result.runId}</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>)}
    </details>
  );
}
