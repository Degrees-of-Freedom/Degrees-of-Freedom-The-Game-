import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DraftControls } from "../../src/multiplayer/DraftControls";
import { commandFor, createMultiplayerDomain, type Action } from "../../src/multiplayer/domain";
import { multiplayerFixture } from "../../src/multiplayer/domain/fixtures";

// Isolated interactive adapter for integration checks. Never imported by the game.
const domain = createMultiplayerDomain(multiplayerFixture());
function dispatch(action: Action) {
  domain.dispatch(commandFor(domain.getSnapshot(), action));
}
dispatch({ type: "ready" });
for (let i = 0; i < 4; i++) dispatch({ type: "draw", source: "elementsLoads" });

function Fixture() {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState(() => domain.getPlayerView("A"));
  const [cardId, setCardId] = useState("l0");
  return <>
    <h1>Multiplayer draft fixture</h1>
    {open ? <>
      <label>Load card <select value={cardId} onChange={e=>setCardId(e.target.value)}>
        {view.hand.filter(c=>c.kind==="load").map(c=><option key={c.id}>{c.id}</option>)}
      </select></label>
      <DraftControls key={cardId} view={view} selectedCardId={cardId} onClose={()=>setOpen(false)}
        dispatch={action=>{ dispatch(action); setView(domain.getPlayerView("A")); }} />
    </> : <button onClick={()=>setOpen(true)}>Open draft</button>}
    <p role="status">{view.drafts.length} staged · {view.draws.length} drawn</p>
    <ul>{view.drafts.map(p=>p.kind==="load" && <li key={p.cardId}>
      {p.cardId} on {p.at.memberId} at {p.at.quarter}/4
    </li>)}</ul>
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
