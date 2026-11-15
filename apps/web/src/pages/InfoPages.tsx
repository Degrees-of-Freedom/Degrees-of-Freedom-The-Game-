import { SolverSetting } from "../components/SolverSetting";
import { MenuShell } from "../components/MenuShell";
import {
  DEFAULT_SETTINGS,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from "../menu/settings";

export function HowToPlay() {
  return <MenuShell title="How to play" documentTitle="How to play" parent="/" parentLabel="Home">
    <p className="lede">Build together. See how much gravity each foundation carries after eight rounds.</p>
    <section className="panel"><h2>Your turn</h2>
      <ol className="rules">
        <li>Pass the device to the named player. Ready reveals their hand, including two cards from each deck. Unused cards stay in hand.</li>
        <li>Select a card and choose its target. Each turn allows one element, one gravity load and two end connections. Endpoints and original quarter points are available on either player’s pieces.</li>
        <li>Connect an end to transfer force. Ends at the same location stay separate until connected. Gravity cards go on an above-ground player-built tip or port.</li>
        <li>End turn commits the draft. Pass commits an empty turn. The browser checks the structure and saves before handoff.</li>
      </ol>
    </section>
    <section className="panel"><h2>Final score</h2>
      <p>Each player receives their foundation’s verified signed share of all gravity cards, minus historical deductions. A newly caused or materially worsened verified issue costs at most one point per turn. Neutral repairs stay on the board. Their reactions earn neither player points.</p>
      <p>Unavailable reactions remain unawarded. With no applied gravity, each player receives zero share. Scores within 0.01 point tie.</p>
    </section>
    <details className="panel"><summary>Controls and inspection</summary>
      <p>Drag to orbit and pinch or scroll to zoom. Fit frames the structure. Focus centers the selected object. Use Inspect for member properties, joint freedoms, turn history and committed response.</p>
      <p>Tab and Enter reach every card and target. Precise placement accepts grid coordinates or named original ports. Use [ and ] to cycle overlapping scene targets. Escape backs out of the current targeting step.</p>
    </details>
    <details className="panel"><summary>Creative and other modes</summary>
      <p>Open More modes from the menu to build freely or try structural challenges. The editor offers member, joint, support and load tools. Use Results to inspect a simulation and the controls panel for editor shortcuts.</p>
    </details>
  </MenuShell>;
}

type ToggleKey = "sound" | "reducedMotion" | "showHelpOnStart" | "showCompanion" | "glow";

const TOGGLES: { key: ToggleKey; title: string; text: string }[] = [
  {
    key: "sound",
    title: "Sound",
    text: "Play short placement and result sounds.",
  },
  {
    key: "reducedMotion",
    title: "Reduced motion",
    text: "Use still poses and static directional arrows.",
  },
  { key: "showCompanion", title: "Show companion", text: "Show Timburr and public turn reactions." },
  { key: "glow", title: "Selection glow", text: "Highlight a selected card with a warm accent." },
  {
    key: "showHelpOnStart",
    title: "Show help on start",
    text: "Shows the controls panel when the workspace opens.",
  },
];

/** Toggle rows shared by the Settings page and the pause menu. */
export function SettingToggles() {
  const settings = useSettings();
  return (
    <>
      {TOGGLES.map((toggle) => (
        <label className="setting" key={toggle.key}>
          <span>
            <b>{toggle.title}</b>
            <span className="d">{toggle.text}</span>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings[toggle.key]}
              onChange={(event) =>
                updateSettings({ [toggle.key]: event.target.checked })
              }
            />
            <span className="track" />
          </span>
        </label>
      ))}
      {(["masterVolume", "effectsVolume"] as const).map(key => (
        <label className="setting" key={key}>
          <span><b>{key === "masterVolume" ? "Master volume" : "Effects volume"}</b>
            <span className="d">{settings[key]}%</span></span>
          <input type="range" min="0" max="100" value={settings[key]} style={{ accentColor: "var(--amber)" }}
            aria-label={key === "masterVolume" ? "Master volume" : "Effects volume"}
            aria-valuetext={settings[key] + "%"}
            onChange={event => updateSettings({ [key]: Number(event.target.value) })} />
        </label>
      ))}
    </>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const isDefault = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every(
    (key) => settings[key] === DEFAULT_SETTINGS[key],
  );
  return (
    <MenuShell
      title="Settings"
      documentTitle="Settings"
      parent="/"
      parentLabel="Home"
      narrow
    >
      <p className="lede">Saved in this browser.</p>
      <div className="panel">
        <SettingToggles />
      </div>
      <div className="panel">
        <SolverSetting />
      </div>
      <div className="foot">
        <button
          className="btn"
          type="button"
          disabled={isDefault}
          onClick={resetSettings}
        >
          Reset to defaults
        </button>
      </div>
    </MenuShell>
  );
}

export function About() {
  return (
    <MenuShell
      title="About"
      documentTitle="About"
      parent="/"
      parentLabel="Home"
      narrow
    >
      <p className="lede">
        <span className="tag solid">Hackathon project</span> AEC Tech 2026
      </p>
      <div className="panel">
        <p style={{ margin: 0, fontSize: 17 }}>
          Degrees of Freedom is a structural engineering game played on a 3D
          grid. Players place joints, members and loads, and then look at how
          the structure carries load and where it can still move. The aim is to
          make structural behaviour something you can play with and see.
        </p>
      </div>
      <div className="two">
        <div className="panel">
          <h2>Implemented</h2>
          <ul className="ticks yes">
            <li>Five modes and five building environments</li>
            <li>Run simulation and Results, an experimental analysis</li>
            <li>A local two-player Shared table playtest</li>
            <li>Final foundation load-share scoring and turn deductions for verified new or worsened issues</li>
            <li>Progress saved in this browser</li>
          </ul>
        </div>
        <div className="panel">
          <h2>Not implemented yet</h2>
          <ul className="ticks no">
            <li>Matches of three or four players, and player names</li>
            <li>Online play</li>
            <li>Verified results for engineering design</li>
          </ul>
        </div>
      </div>
      <div className="panel callout" style={{ marginTop: 16 }}>
        <b>Simulation is experimental and not for engineering design.</b> Its
        solver is approximate and unvalidated.
      </div>
    </MenuShell>
  );
}
