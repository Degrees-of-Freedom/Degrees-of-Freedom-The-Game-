import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { MenuShell } from "../components/MenuShell";
import { MODE_CATALOG } from "../components/runtimeCatalog";
import { LEVELS } from "../game/levels";
import type { GameMode } from "../game/modes";
import { modeSetup } from "../game/modes";
import type { LevelId } from "../game/model";
import { savedLevel } from "../game/persistence";
import { useGameStore } from "../game/store";
import { KIT_PLAYTEST } from "../game/turns";
import { PLAYTEST_SETTINGS, TURN_RULES, TURN_RULES_NOTES } from "../menu/turnRules";
import { hasSavedProgress } from "../menu/saved";
import { runStart, type StartChoice } from "../menu/startPlan";
import { playerLabel } from "./ModeSelect";

type Option = { value: string; title: string; desc: string; disabled?: boolean };

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

const LEVEL_KIND = { tower: "Tower", bridge: "Bridge", pickup: "Pick-up" } as const;
/** Challenge levels are the tower, bridge and pick-up levels; sandbox levels are not challenges. */
const CHALLENGE_LEVELS = (Object.entries(LEVELS) as [LevelId, (typeof LEVELS)[LevelId]][]).filter(
  ([, level]) => level.type !== "sandbox",
);

function Choices({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="choice-row" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label className="choice" key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span className="face">
            <b>{option.title}</b>
            <span>{option.desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function ModeSetup() {
  const { mode } = useParams();
  const entry = MODE_CATALOG.find((item) => item.id === mode);
  if (!entry) return <Navigate to="/modes" replace />;
  return <Setup key={entry.id} id={entry.id} />;
}

function Setup({ id }: { id: GameMode }) {
  const navigate = useNavigate();
  const entry = MODE_CATALOG.find((item) => item.id === id)!;
  // Snapshot at mount: the store does not change while this page is open.
  const [initial] = useState(() => useGameStore.getState());
  const [levelId, setLevelId] = useState<LevelId>(() => {
    const start = initial.mode === "challenge" ? initial.levelId : savedLevel();
    return CHALLENGE_LEVELS.some(([key]) => key === start) ? start : "tower1";
  });
  const [pick, setPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useMemo(() => hasSavedProgress(id, levelId), [id, levelId]);
  const turn = initial.turn;

  // How to begin. Options appear only when Start would otherwise resume or overwrite something.
  let options: Option[] = [];
  if (id === "creative")
    options = [
      ...(saved
        ? [
            {
              value: "continue",
              title: "Continue your structure",
              desc: "Pick up the structure saved in this browser.",
            },
          ]
        : []),
      {
        value: "example",
        title: "Start with example structure",
        desc: saved
          ? "Replaces your saved structure with a small frame."
          : "Begin from a small frame to change.",
      },
      {
        value: "empty",
        title: "Start empty",
        desc: saved
          ? "Clears your saved structure. Supports and loads set by the level stay."
          : "A blank grid. Build whatever you like.",
      },
    ];
  else if (id === "multiplayer" && turn)
    options = [
      {
        value: "continue",
        title: "Continue match",
        desc: turn.finished
          ? `Finished after ${KIT_PLAYTEST.rounds} rounds. Review the final structure.`
          : `Round ${Math.ceil(turn.turn / 2)} of ${KIT_PLAYTEST.rounds} · Player ${turn.playerIndex + 1} to play.`,
      },
      {
        value: "new",
        title: "New match",
        desc: turn.finished
          ? "Deal a new match. The finished one is replaced."
          : "Available once the current match is finished.",
        disabled: !turn.finished,
      },
    ];
  else if (id !== "multiplayer" && saved)
    options = [
      {
        value: "continue",
        title: id === "challenge" ? "Continue this level" : "Continue your work",
        desc: "Pick up the structure saved in this browser.",
      },
      {
        value: "fresh",
        title: "Start over",
        desc:
          id === "forensics"
            ? "Restores the prepared structure. Your repairs are replaced."
            : "Clears the saved structure. Supports and loads set by the level stay.",
      },
    ];

  const defaultBegin =
    id === "multiplayer" && turn?.finished
      ? "new"
      : options.find((option) => !option.disabled)?.value ?? "continue";
  const begin =
    pick && options.some((option) => option.value === pick && !option.disabled)
      ? pick
      : defaultBegin;

  const choice: StartChoice =
    id === "creative"
      ? { mode: id, begin: begin as "continue" | "example" | "empty" }
      : id === "challenge"
        ? { mode: id, levelId, begin: begin === "fresh" ? "fresh" : "continue" }
        : id === "multiplayer"
          ? { mode: id, begin: begin === "new" ? "new" : "continue" }
          : { mode: id, begin: begin === "fresh" ? "fresh" : "continue" };
  const replaces = begin !== "continue" && options.length > 0 && (saved || id === "multiplayer");
  const startLabel =
    id === "multiplayer"
      ? begin === "new"
        ? "New match"
        : turn
          ? "Continue match"
          : "Start"
      : !options.length
        ? "Start"
        : begin === "continue"
          ? "Continue"
          : begin === "fresh"
            ? "Start over"
            : begin === "example"
              ? "Start with example"
              : "Start empty";

  function start() {
    const message = runStart(choice, useGameStore.getState());
    if (message) setError(message);
    else navigate("/play");
  }

  const fixture = modeSetup("forensics").model;
  const pickup = LEVELS[modeSetup("load-space").levelId];

  return (
    <MenuShell
      title={`${entry.title} setup`}
      documentTitle={`${entry.title} setup`}
      parent="/modes"
      parentLabel="Modes"
      crumb={playerLabel(id)}
    >
      <p className="lede">
        <b>{entry.subtitle.replace(/[.]$/, "")}.</b> {entry.description}
      </p>

      {id === "challenge" && (
        <div className="panel">
          <span className="label">Level</span>
          <div className="levels" role="radiogroup" aria-label="Level">
            {CHALLENGE_LEVELS.map(([key, level]) => (
              <label className="choice level" key={key}>
                <input
                  type="radio"
                  name="level"
                  value={key}
                  checked={levelId === key}
                  onChange={() => {
                    setLevelId(key);
                    setPick(null);
                  }}
                />
                <span className="face">
                  <b>{level.name}</b>
                  <span className="tag">{LEVEL_KIND[level.type as keyof typeof LEVEL_KIND]}</span>
                  <span style={{ gridColumn: "1 / -1" }}>{level.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {id === "forensics" && (
        <div className="panel">
          <span className="label">What you start with</span>
          <h2>Missing connection</h2>
          <p style={{ margin: 0 }}>
            A prepared structure of {fixture.members.length} members: a column
            standing on a foundation, and a separate member with no path to it.
            Connect them, then run the simulation to check the repair.
          </p>
        </div>
      )}

      {id === "load-space" && (
        <div className="panel">
          <span className="label">What you start with</span>
          <h2>{pickup.name}</h2>
          <p style={{ margin: 0 }}>
            {pickup.desc} You begin with a limited supply of members and
            connections.
          </p>
        </div>
      )}

      {id === "multiplayer" && (
        <div className="setup-grid">
          <div className="panel">
            <span className="label">Players</span>
            <p style={{ margin: "0 0 14px" }}>
              Two players in this playtest. They share one table and take turns.
            </p>
            <dl className="facts">
              <dt>Players</dt>
              <dd>{KIT_PLAYTEST.players}</dd>
              <dt>Rounds</dt>
              <dd>{KIT_PLAYTEST.rounds}</dd>
            </dl>
            <p className="quiet">
              Each seat plays once per round. After the last turn, the table shows
              each player’s verified gravity share minus historical penalties.
            </p>
          </div>
          <div className="panel">
            <h2>Confirmed turn rules</h2>
            <ul className="rules">
              {TURN_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <h2 style={{ marginTop: 16 }}>Playtest settings</h2>
            <ul className="rules">
              {PLAYTEST_SETTINGS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {TURN_RULES_NOTES.map((note) => (
              <p className="quiet" key={note}>
                {note}
              </p>
            ))}
          </div>
        </div>
      )}

      {options.length > 0 && (
        <div className="panel">
          <span className="label">
            {id === "multiplayer" ? "Match" : "Starting point"}
          </span>
          <Choices
            name="begin"
            label="Starting point"
            options={options}
            value={begin}
            onChange={setPick}
          />
        </div>
      )}
      <div className="foot">
        <button className="btn primary" type="button" onClick={start}>
          {startLabel} {ARROW}
        </button>
        <span className="note" role="status">
          {error ??
            (replaces
              ? id === "multiplayer"
                ? "The finished match is replaced by a new one."
                : "This replaces your saved structure."
              : options.length && begin === "continue"
                ? "Your saved progress is kept."
                : "Opens in Grow Dusk.")}
        </span>
      </div>
    </MenuShell>
  );
}
