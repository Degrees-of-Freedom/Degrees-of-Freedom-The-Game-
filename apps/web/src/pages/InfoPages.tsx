import { MenuShell } from "../components/MenuShell";
import { HOW_ART } from "../menu/art";
import { PLAYTEST_SETTINGS, TURN_RULES, TURN_RULES_NOTES } from "../menu/turnRules";
import {
  DEFAULT_SETTINGS,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from "../menu/settings";

const HOW_TOOLS = [
  {
    title: "Connection",
    text: "A joint holds six degrees of freedom: it can move along three axes and turn about three. Decide which of them stay free and which are locked.",
  },
  {
    title: "Member",
    text: "A member joins two connections. You choose which two joints it links, and that sets how long it is.",
  },
  {
    title: "Load",
    text: "A load sits on a joint. You choose where it goes, which way it pushes, and how much force it carries.",
  },
];

export function HowToPlay() {
  return (
    <MenuShell
      title="How to play"
      documentTitle="How to play"
      parent="/"
      parentLabel="Home"
    >
      <p className="lede">
        You build a structure on a 3D grid with three tools, then see how load
        travels through it.
      </p>
      <div className="tools">
        {HOW_TOOLS.map((tool, index) => (
          <div className="tool" key={tool.title}>
            <div
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: HOW_ART[index] }}
            />
            <h3>{tool.title}</h3>
            <p>{tool.text}</p>
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>What the game measures</h2>
        <p style={{ margin: 0 }}>
          Two things: whether every load has a connected path down to a
          foundation, and, once you run the simulation, how the structure
          responds: where it moves and how its members carry force.
        </p>
        <p className="quiet">
          In Results you can show the deformed shape, with an adjustable scale,
          colour members by utilization where design checks apply, and switch on a load-path overlay. The
          team’s planned main view, the deflected shape coloured by deflection
          magnitude, is not in the app yet. Every number shown comes from the
          calculated results.
        </p>
      </div>
      <div className="panel">
        <h2>The loop</h2>
        <div className="loop">
          <div className="step">
            <b>
              <span>1</span>Setup
            </b>
            <small>Pick a mode and set it up.</small>
          </div>
          <span className="sep" aria-hidden="true">
            &rarr;
          </span>
          <div className="step">
            <b>
              <span>2</span>Act
            </b>
            <small>Add members, loads and connections.</small>
          </div>
          <span className="sep" aria-hidden="true">
            &rarr;
          </span>
          <div className="step">
            <b>
              <span>3</span>Simulate
            </b>
            <small>Choose Run simulation to see where load goes.</small>
          </div>
          <span className="sep" aria-hidden="true">
            &rarr;
          </span>
          <div className="step">
            <b>
              <span>4</span>Read
            </b>
            <small>Open Results to read what the analysis found.</small>
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Shared table rules</h2>
        <ul className="rules">
          {TURN_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <h3>Playtest settings</h3>
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
      <div className="panel">
        <h2>Controls</h2>
        <ul className="rules">
          <li>
            Click to place or select. Drag to orbit and use the wheel to zoom.
          </li>
          <li>
            While growing a member, targets can overlap on screen. The nearest
            to the camera is chosen; the mouse wheel or <kbd>[</kbd>{" "}
            <kbd>]</kbd> steps through the stack, and the hover text shows
            “2 of 3 overlapping”.
          </li>
          <li>
            <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> choose member, joint or load.{" "}
            <kbd>X</kbd> erases and <kbd>I</kbd> inspects.
          </li>
          <li>
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes, <kbd>Ctrl</kbd>+<kbd>Y</kbd>{" "}
            redoes. <kbd>H</kbd> shows the controls panel.
          </li>
          <li>
            <kbd>P</kbd> opens the pause menu. <kbd>Esc</kbd> opens it when
            nothing else needs Esc.
          </li>
        </ul>
      </div>
      <div className="panel callout">
        <b>Run simulation is experimental and not for engineering design.</b>{" "}
        It is an approximate analysis of the current model. Scoring is not
        implemented yet.
      </div>
    </MenuShell>
  );
}

const TOGGLES: { key: keyof Settings; title: string; text: string }[] = [
  {
    key: "sound",
    title: "Sound",
    text: "Stored for later. The editor sound is switched on in the workspace with the ♪ button or M.",
  },
  {
    key: "reducedMotion",
    title: "Reduced motion",
    text: "Turns off animations and transitions on the menus.",
  },
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
