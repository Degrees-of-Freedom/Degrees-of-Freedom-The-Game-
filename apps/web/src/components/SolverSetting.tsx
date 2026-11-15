import { useEffect, useRef, useState } from "react";
import {
  normalizeServiceUrl,
  updateSettings,
  useSettings,
  type SolverChoice,
} from "../menu/settings";
import { checkOpenSees } from "../solver/opensees";

const CHOICES: { value: SolverChoice; title: string; text: string }[] = [
  {
    value: "rust",
    title: "Rust (in browser)",
    text: "Nonlinear check with card sections, tension-only cables and self-weight. Runs on this computer; nothing to install.",
  },
  {
    value: "opensees",
    title: "OpenSees service",
    text: "Geometrically nonlinear analysis with each member's own section, tension-only cables and buckling checks. Needs the service running (npm run dev:opensees).",
  },
];

type Connection =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "ok"; text: string }
  | { phase: "failed"; text: string };

/**
 * Chooses the backend of the workspace's structural check. Shared by the
 * Settings page and the pause menu. The structure evaluator (results panel,
 * objectives, overlays) is not affected: it always uses the in-browser Rust
 * solver, and this choice only fills the "Structural check" panel.
 */
export function SolverSetting() {
  const settings = useSettings();
  const [address, setAddress] = useState(settings.openSeesUrl);
  const [connection, setConnection] = useState<Connection>({ phase: "idle" });
  const latest = useRef(0);

  // Follow changes made elsewhere (the other settings view, a reset).
  useEffect(() => setAddress(settings.openSeesUrl), [settings.openSeesUrl]);
  useEffect(() => () => void latest.current++, []);

  const valid = normalizeServiceUrl(address);

  function commitAddress() {
    if (valid && valid !== settings.openSeesUrl) {
      updateSettings({ openSeesUrl: valid });
      setConnection({ phase: "idle" });
    }
  }

  async function testConnection() {
    if (!valid) return;
    commitAddress();
    const run = ++latest.current;
    setConnection({ phase: "checking" });
    const health = await checkOpenSees(valid);
    if (run !== latest.current) return;
    setConnection(
      health.status === "ok"
        ? {
            phase: "ok",
            text: `Connected${health.openSeesVersion ? ` to OpenSees ${health.openSeesVersion}` : ""}.`,
          }
        : { phase: "failed", text: health.message },
    );
  }

  return (
    <fieldset className="solver-setting">
      <legend>
        <b>Structural solver</b>
        <span className="d">
          Used by the structural check after Run simulation.
        </span>
      </legend>
      {CHOICES.map((choice) => (
        <label className="setting" key={choice.value}>
          <span>
            <b>{choice.title}</b>
            <span className="d">{choice.text}</span>
          </span>
          <input
            type="radio"
            name="solver"
            value={choice.value}
            checked={settings.solver === choice.value}
            onChange={() => updateSettings({ solver: choice.value })}
          />
        </label>
      ))}
      {settings.solver === "opensees" && (
        <div className="solver-address">
          <label htmlFor="opensees-url">OpenSees service address</label>
          <div className="row">
            <input
              id="opensees-url"
              type="url"
              value={address}
              spellCheck={false}
              aria-invalid={!valid}
              onChange={(event) => setAddress(event.target.value)}
              onBlur={commitAddress}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitAddress();
              }}
            />
            <button
              className="btn"
              type="button"
              disabled={!valid || connection.phase === "checking"}
              onClick={() => void testConnection()}
            >
              {connection.phase === "checking" ? "Checking…" : "Test"}
            </button>
          </div>
          {!valid && (
            <p className="d" role="alert">
              Enter an http:// or https:// address.
            </p>
          )}
          {(connection.phase === "ok" || connection.phase === "failed") && (
            <p
              className={connection.phase === "ok" ? "d ok" : "d bad"}
              role="status"
            >
              {connection.text}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
