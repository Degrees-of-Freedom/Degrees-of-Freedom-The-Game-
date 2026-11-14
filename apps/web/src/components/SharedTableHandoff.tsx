import { useLayoutEffect, useRef } from "react";

/** Only the seat and Ready control are mounted during a private handoff. */
export function SharedTableHandoff({ player, onReady }: { player: number; onReady: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    // A held Enter or Space from End turn must never activate Ready.
    heading.current?.focus({ preventScroll: true });
  }, [player]);
  return (
    <main className="dof-menu dm-pause dm-handoff" aria-labelledby="handoff-heading">
      <section className="dm-pause-panel panel">
        <h1 ref={heading} id="handoff-heading" tabIndex={-1}>Pass to Player {player}</h1>
        <button className="btn mbtn primary" onClick={onReady}
          onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}>
          Ready · Reveal my hand
        </button>
      </section>
    </main>
  );
}
