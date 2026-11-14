import { useEffect, useState } from 'react';
import { parseStructureLibrary, structureAsset, type StructureRecord } from '../game/structureLibrary';
import { useGameStore } from '../game/store';
import '../styles/library.css';

/** Explicit loads and wrapped cycling keep browsing separate from edited geometry. */
export function StructureLibrary({ index, setIndex }: { index: number; setIndex: (index: number) => void }) {
  const [records, setRecords] = useState<StructureRecord[]>([]);
  const [error, setError] = useState('');
  const load = useGameStore(s => s.loadLibraryModel);
  useEffect(() => {
    const abort = new AbortController();
    fetch(structureAsset('catalog.json'), { signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error(`Library download failed (${response.status}).`); return response.json(); })
      .then(value => setRecords(parseStructureLibrary(value)))
      .catch(e => { if (!abort.signal.aborted) setError(String(e)); });
    return () => abort.abort();
  }, []);
  const record = records[index];
  function open(next: number) {
    const wrapped = (next + records.length) % records.length;
    setIndex(wrapped);
    load(records[wrapped].save.model);
  }
  return <section className="structure-library" aria-label="Structure library">
    {error ? <p role="alert">{error}</p> : !record ? <p>Loading structure library…</p> : <>
      <img src={structureAsset(record.preview)} alt={`Geometry preview of ${record.name}`} width="200" height="150" />
      <div>
        <label>Structure library · {index + 1} / {records.length}{' '}
          <select value={index} onChange={e => setIndex(Number(e.target.value))}>
            {records.map((r, i) => <option key={r.id} value={i}>{r.name} · {r.memberCount} members</option>)}
          </select>
        </label>
        <p>{record.purpose}</p>
        <p>{record.complexity} · {record.nodeCount} nodes · {record.extentMetres.join(' × ')} m · intent: {record.expectation.stability}</p>
        <div className="library-actions">
          <button onClick={() => open(index - 1)}>← Previous & load</button>
          <button onClick={() => open(index)}>Load structure</button>
          <button onClick={() => open(index + 1)}>Next & load →</button>
          <a href={structureAsset(`records/${record.id}.json`)} download>JSON record</a>
          <a href={structureAsset(record.preview)} download>PNG</a>
          <a href={structureAsset('structures.sqlite')} download>SQLite database</a>
        </div>
        <small>Loads into the dedicated Library workspace. Use Run simulation to solve. Intent is qualitative; previews show undeformed geometry.</small>
      </div>
    </>}
  </section>;
}
