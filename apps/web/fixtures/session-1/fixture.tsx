import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DraftControls } from "../../src/multiplayer/DraftControls";
import { commandFor, createMultiplayerDomain, restoreMultiplayerDomain, type Action } from "../../src/multiplayer/domain";
import { restartMultiplayerMatch } from "../../src/multiplayer/domain/restart";
import { multiplayerFixture } from "../../src/multiplayer/domain/fixtures";

// Isolated interactive adapter for integration checks. Never imported by the game.
const key = "dof-fixture:session-1";
const saved = localStorage.getItem(key);
let domain = saved === null ? createMultiplayerDomain(multiplayerFixture()) : restoreMultiplayerDomain(saved);
function dispatch(action: Action) {
  domain.dispatch(commandFor(domain.getSnapshot(), action));
  localStorage.setItem(key, domain.serialize());
}
if (saved === null) {
  dispatch({ type: "ready" });
  for (let i = 0; i < 4; i++) dispatch({ type: "draw", source: "elementsLoads" });
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState(() => domain.getPlayerView("A"));
  const [cardId, setCardId] = useState("l0");
  const [error, setError] = useState("");
  const loads = view.hand.filter(c=>c.kind==="load");
  const selectedLoadId = loads.find(c=>c.id===cardId)?.id ?? loads[0]?.id ?? "";
  function act(action: Action) {
    dispatch(action);
    setView(domain.getPlayerView("A"));
  }
  return <>
    <h1>Multiplayer draft fixture</h1>
    <button onClick={()=>{
      try {
        const replacement = restartMultiplayerMatch(domain,localStorage,key,question=>window.confirm(question));
        if (!replacement) return;
        domain = replacement;
        setView(domain.getPlayerView("A"));
        setOpen(true);
        setError("");
      } catch (issue) { setError(issue instanceof Error ? issue.message : "Restart failed"); }
    }}>Restart match</button>
    {error && <p role="alert">{error}</p>}
    {view.phase==="handoff" && <button onClick={()=>act({type:"ready"})}>Begin turn</button>}
    {view.phase==="draw" && <button onClick={()=>act({type:"draw",source:"elementsLoads"})}>Draw element or load</button>}
    {view.phase==="play" && (open ? <>
      <label>Load card <select value={selectedLoadId} onChange={e=>setCardId(e.target.value)}>
        {loads.map(c=><option key={c.id}>{c.id}</option>)}
      </select></label>
      <DraftControls key={selectedLoadId} view={view} selectedCardId={selectedLoadId} onClose={()=>setOpen(false)}
        dispatch={act} />
    </> : <button onClick={()=>setOpen(true)}>Open draft</button>)}
    <p role="status">{view.drafts.length} staged · {view.draws.length} drawn</p>
    <ul>{view.drafts.map(p=>p.kind==="load" && <li key={p.cardId}>
      {p.cardId} on {p.at.memberId} at {p.at.quarter}/4
    </li>)}</ul>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
