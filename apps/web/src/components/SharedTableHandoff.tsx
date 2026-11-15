import { useLayoutEffect, useRef } from "react";
import type { TurnState } from "../game/turns";

/** The backdrop draws committed members only; private hands and drafts never mount here. */
export function SharedTableHandoff({ player, onReady, conflict = false, board }: { player: number; onReady: () => void; conflict?: boolean; board?: TurnState["board"] }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    // A held Enter or Space from End turn must never activate Ready.
    heading.current?.focus({ preventScroll: true });
  }, [player, conflict]);
  return (
    <main className={`dof-menu dm-pause dm-handoff${conflict ? "" : " dm-pass"}`} aria-labelledby="handoff-heading">
      {!conflict && <div className="dm-pass-backdrop" aria-hidden="true">
        <svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice">
          <path d="M0 300 L400 165 L800 300 L800 500 L0 500 Z" fill="#b89868" />
          {board?.members.map(member => {
            const project = (key: string) => {
              const [x, y, z] = key.split(",").map(Number);
              return [400 + (x - y) * 22, 345 + (x + y - 15) * 8 - z * 28];
            };
            const [x1, y1] = project(member.a), [x2, y2] = project(member.b);
            return <line key={member.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={member.owner === "player-2" ? "#83b8d6" : "#edac8d"} strokeWidth="7" strokeLinecap="round" />;
          })}
        </svg>
      </div>}
      <section className={`dm-pause-panel${conflict ? " panel" : " dm-pass-message"}`}>
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
