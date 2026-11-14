import { useLayoutEffect, useRef } from "react";

/** Only the seat and Ready control are mounted during a private handoff. */
export function SharedTableHandoff({ player, onReady, conflict = false }: { player: number; onReady: () => void; conflict?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    // A held Enter or Space from End turn must never activate Ready.
    heading.current?.focus({ preventScroll: true });
  }, [player, conflict]);
  return (
    <main className="dof-menu dm-pause dm-handoff" aria-labelledby="handoff-heading">
      <section className="dm-pause-panel panel">
        <h1 ref={heading} id="handoff-heading" tabIndex={-1}>{conflict ? "Saved session changed" : `Pass to Player ${player}`}</h1>
        {conflict && <p>Another tab updated the saved game. Reload to continue from its latest turn.</p>}
        <button className="btn mbtn primary" onClick={onReady}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>
          {conflict ? "Reload saved game" : "Ready · Reveal my hand"}
        </button>
      </section>
    </main>
  );
}
