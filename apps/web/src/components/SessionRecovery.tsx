import { useLayoutEffect, useRef, useState } from "react";
import { useGameStore } from "../game/store";

/** This screen mounts without the board, final receipt, or private tray. */
export function SessionRecovery() {
  const game = useGameStore();
  const invalid = game.sessionSave === "invalid";
  const failed = game.sessionSave === "failed";
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [needsCopy, setNeedsCopy] = useState<"backup" | "restart" | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, [invalid, failed]);
  async function recover(choice: "backup" | "restart", external = false) {
    setBusy(true);
    const result = await game.recoverSession(choice, external);
    if (result === "saved") window.location.reload();
    else {
      setNeedsCopy(result === "needs-copy" ? choice : null);
      setBusy(false);
    }
  }
  function download() {
    const bytes = game.privateRecoveryBytes();
    if (bytes === null) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = invalid ? "degrees-of-freedom-original-private-save.json" : "degrees-of-freedom-unsaved-private-match.json";
    link.click();
    setDownloaded(true);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="dof-menu dm-pause dm-handoff" aria-labelledby="save-heading">
    <section className="dm-pause-panel panel" aria-busy={busy}>
      <h1 id="save-heading" tabIndex={-1} ref={heading}>{invalid ? "Recover saved session" : failed ? "Save interrupted" : "Saving turn"}</h1>
      <p role="status">{invalid || failed ? game.persistenceError : "Waiting for local storage to confirm this revision."}</p>
      {!invalid && <p>{game.savedRevision === null ? "No confirmed save yet." : `Last confirmed revision ${game.savedRevision}`}</p>}
      {failed && <>
        <button className="btn mbtn primary" onClick={game.retrySessionSave}>Retry save</button>
        <button className="btn mbtn" onClick={() => window.location.reload()}>Reload previous save</button>
      </>}
      {(failed || invalid) && <>
        <p>Private downloads include the data needed to reconstruct both hands and decks.</p>
        <button className="btn mbtn" onClick={download}>{invalid ? "Download original private save" : "Download unsaved private match"}</button>
      </>}
      {invalid && <>
        {game.hasSessionBackup && <button className="btn mbtn primary" disabled={busy} onClick={() => void recover("backup")}>Restore previous save</button>}
        <button className="btn mbtn" disabled={busy} onClick={() => void recover("restart")}>Keep damaged save and start new match</button>
        {needsCopy && downloaded && <button className="btn mbtn" disabled={busy}
          onClick={() => void recover(needsCopy, true)}>I saved a copy · {needsCopy === "backup" ? "restore previous save" : "start new match"}</button>}
      </>}
    </section>
  </main>;
}
