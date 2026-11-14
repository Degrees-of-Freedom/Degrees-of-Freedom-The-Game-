import { Link } from "react-router-dom";
import { useGameStore } from "../../game/store";
import { analyzeConnectivity } from "../../game/connectivity";
import { CELL_SIZE } from "../../game/model";
import { LEVELS } from "../../game/levels";
import { STYLE_CATALOG, MODE_CATALOG } from "../runtimeCatalog";
import { KIT_PLAYTEST } from "../../game/turns";

/** Player colours of the Grow Dusk prototype's turn chip. */
const PLAYER_COLORS = ["#e9806e", "#6a9bd8", "#d9a53a", "#8cc7b5"];

function EnvironmentMark({ style }: { style: ReturnType<typeof useGameStore.getState>["style"] }) {
  if (style === "levels") return (
    <svg viewBox="0 0 28 28" aria-hidden="true" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M14 15.5 25 21l-11 5.5L3 21z M14 9 25 14.5 14 20 3 14.5z" fill="#f4f0e6" stroke="#2f3b52" />
      <path d="M14 2.5 25 8 14 13.5 3 8z" fill="#9ec3e6" stroke="#5b84b1" />
    </svg>
  );
  if (style === "blocks") return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="7" y="7" width="18" height="18" fill="none" stroke="#bda88a" strokeWidth="2" />
      <path d="M7 25 25 7" stroke="#e8735a" strokeWidth="3.2" strokeLinecap="round" />
      {[3, 21].flatMap((x) => [3, 21].map((y) => <rect key={x + "," + y} x={x} y={y} width="8" height="8" rx="2.2" fill="#3b4252" />))}
    </svg>
  );
  if (style === "kit") return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <path d="m4 23 10-15m2 15 10-15" fill="none" strokeWidth="4" strokeLinecap="round" stroke="#e9806e" />
      <path d="m11 23 11-15" fill="none" strokeWidth="4" strokeLinecap="round" stroke="#6a9bd8" />
    </svg>
  );
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <path d="M7 23 15 7 23 23" fill="none" stroke={style === "grow-dusk" ? "#8cc7b5" : "#4f9da6"} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M7 23h16" stroke={style === "grow-dusk" ? "#6a9bd8" : "#e3b04b"} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="15" cy="7" r="3.6" fill={style === "grow-dusk" ? "#f3ead8" : "#fbf7ef"} stroke={style === "grow-dusk" ? "#22313f" : "#3f4654"} strokeWidth="2" />
      <circle cx="7" cy="23" r="3" fill={style === "grow-dusk" ? "#f2b134" : "#6d7a8c"} />
      <circle cx="23" cy="23" r="3" fill={style === "grow-dusk" ? "#f2b134" : "#6d7a8c"} />
    </svg>
  );
}

export function EnvironmentBrand() {
  const game = useGameStore();
  const modeTitle = MODE_CATALOG.find((item) => item.id === game.mode)?.title;
  // Growth styles use the prototype's brand chip: product, environment, then
  // the mode on its own amber row (and the level for challenges).
  if (game.style === "grow" || game.style === "grow-dusk")
    return (
      <div id="brand" className="chip">
        <Link to="/" title="Main menu" aria-label="Main menu">
          <EnvironmentMark style={game.style} />
        </Link>
        <div>
          <b className="brand-name">Degrees of Freedom</b>
          <span className="brand-sub">
            {game.style === "grow-dusk" ? "Grow · Dusk" : "Grow"}
          </span>
          <span id="mode-row">
            <b id="mode-name">{modeTitle}</b>
          </span>
          {game.mode === "challenge" && (
            <span id="mode-level">Level: {LEVELS[game.levelId].name}</span>
          )}
        </div>
      </div>
    );
  return (
    <div id="brand" className="chip card">
      <Link
        to="/"
        title="Main menu"
        aria-label="Main menu"
      >
        <EnvironmentMark style={game.style} />
      </Link>
      <div>
        <b className="brand-name">Degrees of Freedom</b>
        <span className="brand-sub">
          {STYLE_CATALOG.find((item) => item.id === game.style)?.title} ·{" "}
          {MODE_CATALOG.find((item) => item.id === game.mode)?.title}
        </span>
      </div>
    </div>
  );
}

export function EnvironmentStats() {
  const game = useGameStore();
  const report = analyzeConnectivity(
    game.model,
    game.mode === "multiplayer" ? game.turn : null,
  );
  return (
    <div id="stats">
      <div>
        {report.memberCount} members · {report.lengthMetres.toFixed(1)} m ·{" "}
        {report.totalLoadKilonewtons} kN
      </div>
      <div className="roles">
        <span>
          <i style={{ background: "var(--column, #3f5d8a)" }} />
          column
        </span>
        <span>
          <i style={{ background: "var(--beam, #6f8fb8)" }} />
          beam
        </span>
        <span>
          <i style={{ background: "var(--brace, #c98a5a)" }} />
          brace
        </span>
        {report.unsupportedMembers.length > 0 &&
          (game.style === "grow" || game.style === "grow-dusk" ? (
            <span className="fl show">
              <i />
              {report.unsupportedMembers.length} not connected to a support
            </span>
          ) : (
            <span>{report.unsupportedMembers.length} floating</span>
          ))}
      </div>
    </div>
  );
}

export function EnvironmentStepper() {
  const game = useGameStore();
  if (game.style !== "levels" && game.style !== "engineering") return null;
  const maxLevel = LEVELS[game.levelId].nz;
  return (
    <aside id="stepper" className="card" aria-label="Working level">
      <div className="st-head">
        <div className="st-level">
          <div className="st-num">{game.workK}</div>
          <div className="cap">
            <b>Level</b>
            <span>{(game.workK * CELL_SIZE).toFixed(1)} m</span>
          </div>
        </div>
        <div className="st-keys">
          <button
            className="btn"
            aria-label="Level up"
            disabled={game.workK >= maxLevel}
            onClick={() => game.setWorkK(game.workK + 1)}
          >
            ↑ <kbd>W</kbd>
          </button>
          <button
            className="btn"
            aria-label="Level down"
            disabled={game.workK <= 0}
            onClick={() => game.setWorkK(game.workK - 1)}
          >
            ↓ <kbd>S</kbd>
          </button>
        </div>
      </div>
      <div className="st-rows">
        <svg
          width="150"
          height="182"
          viewBox="0 0 150 182"
          aria-label="Elevation levels"
        >
          {Array.from({ length: maxLevel + 1 }, (_, k) => (
            <g key={k} role="button" tabIndex={0} aria-label={`Go to level ${k}`} onClick={() => game.setWorkK(k)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); game.setWorkK(k); } }}>
              <path
                d={`M10 ${160 - k * 150 / Math.max(maxLevel, 1)}h110`}
                stroke={game.workK === k ? "#5b84b1" : "#d9d2c3"}
                strokeWidth={game.workK === k ? 3 : 1}
              />
              <text x="130" y={164 - k * 150 / Math.max(maxLevel, 1)} fontSize="11" fill="#5b6472">
                {k}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="st-view">
        <span>Q ↶</span>
        <span>X · Y · Z</span>
        <span>↷ E</span>
      </div>
    </aside>
  );
}

export function TurnBanner({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const game = useGameStore(),
    turn = game.turn;
  if (game.mode !== "multiplayer" || !turn) return null;
  // Growth styles use the prototype's turn chip: player dot and name, a tag,
  // End turn. The round count and the independent 1 / 1 / 2 allowances come
  // from the confirmed turn rules (docs/kb/turn-criteria.md); the prototype
  // only counted turns.
  if (game.style === "grow" || game.style === "grow-dusk") {
    const round = Math.ceil(turn.turn / turn.players.length);
    return (
      <div
        id="turn"
        className="chip"
        title="Local playtest. Each turn: up to one member, one load and two connections, or pass."
      >
        <span className="who">
          <span
            className="dot"
            style={{ background: PLAYER_COLORS[turn.playerIndex % 4] }}
          />
          <span id="turn-text">
            {turn.finished
              ? "Match complete"
              : `Player ${turn.playerIndex + 1} · round ${Math.min(round, KIT_PLAYTEST.rounds)} of ${KIT_PLAYTEST.rounds}`}
          </span>
        </span>
        <span className="turn-pips" aria-label="Turn allowances">
          <span className={turn.draft.members.length ? "spent" : ""}>
            1 member
          </span>
          <span className={turn.draft.loads.length ? "spent" : ""}>1 load</span>
          <span className={turn.draft.connections.length >= 2 ? "spent" : ""}>
            {2 - turn.draft.connections.length} connections
          </span>
        </span>
        <span className="tag">playtest</span>
        <button
          className="btn"
          disabled={turn.finished}
          title="End turn (Enter)"
          onClick={() =>
            onMessage(game.endTurn() ?? "Turn committed · pass the table")
          }
        >
          End turn
        </button>
      </div>
    );
  }
  return (
    <div id={game.style === "kit" ? "banner" : "turn"} className="chip panel">
      <div id="who">
        <b>Player {turn.playerIndex + 1}</b>
        <span>
          Turn {turn.turn} · round {Math.ceil(turn.turn / 2)}
        </span>
      </div>
      <div className="turn-pips" aria-label="Turn allowances">
        <span className={turn.draft.members.length ? "spent" : ""}>
          1 member
        </span>
        <span className={turn.draft.loads.length ? "spent" : ""}>1 load</span>
        <span>{2 - turn.draft.connections.length} connections</span>
      </div>
      <button
        className="btn"
        disabled={turn.finished}
        onClick={() =>
          onMessage(game.endTurn() ?? "Turn committed · pass the table")
        }
      >
        End turn
      </button>
      <span className="tag">playtest</span>
    </div>
  );
}
