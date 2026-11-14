import { Link } from "react-router-dom";
import { MenuShell } from "../components/MenuShell";
import { MODE_CATALOG } from "../components/runtimeCatalog";
import { KIT_PLAYTEST } from "../game/turns";
import { MODE_ART } from "../menu/art";
import type { GameMode } from "../game/modes";

const ARROW = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Player count shown on a card; only Shared table is multi-player, from the playtest config. */
export function playerLabel(mode: GameMode): string {
  const count = mode === "multiplayer" ? KIT_PLAYTEST.players : 1;
  return `${count} player${count === 1 ? "" : "s"}`;
}

export function ModeSelect() {
  return (
    <MenuShell
      title="Choose a mode"
      documentTitle="Choose a mode"
      parent="/"
      parentLabel="Home"
    >
      <p className="lede">
        A mode sets the rules. Every mode plays in the Grow Dusk environment.
      </p>
      <div className="cards">
        {MODE_CATALOG.map((mode) => (
          <Link
            key={mode.id}
            className="card"
            to={`/setup/${mode.id}`}
            data-mode={mode.id}
          >
            <div
              className="art"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: MODE_ART[mode.id] }}
            />
            <h3>{mode.title}</h3>
            <div className="sub">{mode.subtitle}</div>
            <p>{mode.description}</p>
            <div className="meta">
              <div className="players">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="8" r="4" />
                  <path d="M2 21c0-4 3-7 7-7s7 3 7 7z" />
                  <circle cx="18" cy="9" r="3" opacity=".7" />
                </svg>
                {playerLabel(mode.id)}
              </div>
              <div className="go">Set up {ARROW}</div>
            </div>
          </Link>
        ))}
      </div>
      <p className="status-note">
        Simulation is experimental and not for engineering design.
      </p>
    </MenuShell>
  );
}
