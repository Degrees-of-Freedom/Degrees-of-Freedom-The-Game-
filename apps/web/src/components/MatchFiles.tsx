import { useRef, useState } from "react";
import { useGameStore } from "../game/store";
import { publicTurnModel } from "../game/publicTurnModel";
import { MAX_PRIVATE_BYTES } from "../game/releaseSave";

export function downloadMatch(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MatchFiles({onImported}: {onImported: () => void}) {
  const game = useGameStore();
  const [selected, setSelected] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const turn = game.turn;
  if (!turn || !game.importPrivateMatch) return null;
  function savePublic() {
    if (!turn) return;
    const final = turn.finalScore;
    const result = final && { winners: final.winners, partial: final.partial, awards: final.awards,
      neutralShare: final.neutralShare, unknownGravityKN: final.unknownGravityKN, totalGravityKN: final.totalGravityKN };
    downloadMatch(new Blob([JSON.stringify({ ...publicTurnModel(turn), result }, null, 2)], {type:"application/json"}), "grow-dusk-public-summary.json");
  }
  async function restore() {
    if (!selected || !game.importPrivateMatch || busy) return;
    setBusy(true);
    try {
      if (selected.size > MAX_PRIVATE_BYTES) throw new Error("Private match files are limited to 8 MiB.");
      const bytes = new TextDecoder("utf-8", {fatal:true}).decode(await selected.arrayBuffer());
      const problem = await game.importPrivateMatch(bytes);
      if (problem) setError(problem);
      else onImported();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the selected file."); }
    finally { setBusy(false); }
  }
  return <div className="mlist">
    <p>Confirmed revision {game.savedRevision ?? "pending"}</p>
    <button className="btn mbtn" onClick={savePublic}>Export public summary</button>
    <button className="btn mbtn" onClick={() => {
      const bytes = game.privateRecoveryBytes();
      if (bytes !== null) downloadMatch(new Blob([bytes], {type:"application/json"}), "grow-dusk-private.json");
    }}>Export private match</button>
    <p className="mnote">Private files include both hands and deck order.</p>
    <input ref={chooser} type="file" hidden accept=".json,application/json" onChange={e => {
      setSelected(e.target.files?.[0] ?? null); setError(""); e.target.value = "";
    }}/>
    <button className="btn mbtn" disabled={busy} onClick={() => chooser.current?.click()}>Import private match</button>
    {selected && <div><p>Replace this match with {selected.name}?</p>
      <button className="btn mbtn" disabled={busy} onClick={() => {setSelected(null);setError("");}}>Cancel import</button>
      <button className="btn mbtn" disabled={busy} onClick={() => void restore()}>Validate and replace</button>
    </div>}
    {error && <><p role="alert">{error}</p>
      {selected && <button className="btn mbtn" onClick={() => downloadMatch(selected, selected.name)}>Download original file</button>}</>}
  </div>;
}
