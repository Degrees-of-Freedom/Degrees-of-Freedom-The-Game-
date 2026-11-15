import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { enterRelease } from "../game/releaseSession";
import { Workspace } from "./Workspace";

/** All reads, replay and first writes occur behind a cover. A new browser may
 * select a reproducible deal with ?seed=<uint32>; existing saves always win. */
export default function ReleaseMatch() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [seed] = useState(() => {
    const value = new URLSearchParams(location.search).get("seed");
    return value !== null && /^\d{1,10}$/.test(value) && Number(value) <= 0xffffffff ? Number(value) : undefined;
  });
  useEffect(() => {
    const active = new AbortController();
    if (location.search) history.replaceState(history.state, "", location.pathname);
    enterRelease(active.signal, seed).then(() => { if (!active.signal.aborted) setReady(true); })
      .catch(cause => { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Match storage is unavailable."); });
    return () => active.abort();
  }, [seed]);
  if (ready) return <Workspace />;
  return <main className="dof-menu dm-pause dm-handoff">
    <section className="dm-pause-panel panel">
      <h1>{error ? "Couldn’t open the match" : "Opening Grow Dusk"}</h1>
      <p role="status">{error || "Checking the local save…"}</p>
      {error && <><button className="btn mbtn primary" onClick={() => location.reload()}>Retry</button>
        <Link className="btn mbtn" to="/">Return to title</Link></>}
    </section>
  </main>;
}

