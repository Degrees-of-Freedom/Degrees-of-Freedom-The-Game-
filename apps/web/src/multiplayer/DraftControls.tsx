import { useState } from "react";
import { type Action, type MultiplayerDomain } from "./domain";
import { loadTargets } from "./domain/loadTargets";

type View = ReturnType<MultiplayerDomain["getPlayerView"]>;
/** Mount in the private draft panel, keyed by match/turn. Dispatch must throw on rejection. */
export function DraftControls({ view, selectedCardId, dispatch, onClose }: {
  view: View; selectedCardId: string | null; dispatch: (action: Action) => void; onClose: () => void;
}) {
  const [error,setError]=useState("");
  const [choice,setChoice]=useState("");
  const load=view.hand.find(c=>c.id===selectedCardId && c.kind==="load");
  const targets=load ? loadTargets(view.original,view.drafts) : [];
  const selected=targets.find(t=>JSON.stringify(t.at)===choice) ?? targets[0];
  return <section aria-label="Draft controls">
    <button type="button" onClick={onClose}>Close draft</button>
    {load && selected && <>
      <label>Load target <select value={JSON.stringify(selected.at)} onChange={e=>setChoice(e.target.value)}>
        {targets.map(t=><option key={JSON.stringify(t.at)} value={JSON.stringify(t.at)}>{t.label}</option>)}
      </select></label>
      <button type="button" onClick={()=>{
        try { dispatch({type:"stage",play:{kind:"load",cardId:load.id,at:selected.at}}); setError(""); }
        catch(issue) { setError(issue instanceof Error ? issue.message : "Unable to place load"); }
      }}>Place load</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
