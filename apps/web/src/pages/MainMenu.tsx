import { Link, useNavigate } from "react-router-dom";
import { useGameStore } from "../game/store";
import type { PresentationStyle } from "../game/modes";
import { MODE_CATALOG } from "../components/runtimeCatalog";
import "./launcher.css";

const environments = [
  {
    style: "grow",
    name: "Grow",
    tagline: "Pull members out of joints",
    text: "Click a joint and the points it can reach bloom around it. Click one and a member pops in. Free 3D camera.",
    gives: "Build between reachable lattice points in three dimensions.",
    costs: "Depth is judged by eye, with many targets on screen at once.",
    alt: "A braced frame on a cream quay over pale water",
  },
  {
    style: "levels",
    name: "Levels",
    tagline: "Draw one level at a time",
    text: "An isometric board with one highlighted working level. Step through levels like floors and draw on the active one.",
    gives:
      "Exact picking, quarter-turn views, and a board that reads like a plan.",
    costs: "Vertical building takes extra level changes.",
    alt: "An isometric paper model with a highlighted working level",
  },
  {
    style: "blocks",
    name: "Blocks",
    tagline: "Stack bays, the frame appears",
    text: "Click to stack bays. Columns and beams appear along their edges. Then brace panels, pin joints and drop loads.",
    gives: "A frame in seconds, built a bay at a time.",
    costs: "Bay dimensions set the lengths of the generated members.",
    alt: "Stacked frame bays in evening light over teal water",
  },
  {
    style: "kit",
    name: "Kit",
    tagline: "Take turns playing pieces from a tray",
    text: "A board game. Each turn a player takes members, connections and loads from cards and plays them onto a shared structure.",
    gives:
      "A local two-player game with individual end connections and persistent gravity loads.",
    costs:
      "Simulate shared loads and individual fixed or ball end connections.",
    alt: "A two-colour structure on a turntable at dusk",
  },
  {
    style: "grow-dusk",
    name: "Grow Dusk",
    tagline: "Build in evening light",
    text: "The Grow environment rebuilt in midnight blue and warm amber, with the same joint-to-joint construction.",
    gives: "The same free 3D camera and lattice reach as Grow.",
    costs: "Depth still depends on the viewing angle.",
    alt: "A blue frame on a dusk quay over dark water",
  },
] satisfies {
  style: PresentationStyle;
  name: string;
  tagline: string;
  text: string;
  gives: string;
  costs: string;
  alt: string;
}[];

export function MainMenu() {
  const navigate = useNavigate();
  const select = (style: PresentationStyle) => {
    const game = useGameStore.getState();
    game.setMode(style === "kit" ? "multiplayer" : "creative");
    game.setStyle(style);
    navigate("/play");
  };

  return (
    <div className="launcher">
      <main>
        <header className="launcher-intro">
          <p className="launcher-eyebrow">Degrees of Freedom: The Game</p>
          <h1>Five ways to build a structure</h1>
          <p>
            Explore members, connections and loads in five building
            environments. Each uses the same structural workspace.
          </p>
          <button
            className="launcher-open launcher-primary"
            onClick={() => select("grow-dusk")}
          >
            Start in Grow Dusk
          </button>{" "}
          <Link to="/play">Continue in the workspace</Link>
        </header>
        <div className="launcher-grid">
          {[...environments]
            .sort(
              (a, b) =>
                Number(b.style === "grow-dusk") -
                Number(a.style === "grow-dusk"),
            )
            .map((item) => (
              <article
                key={item.style}
                className={`launcher-card launcher-${item.style}`}
              >
                <Link
                  to="/play"
                  className="launcher-shot"
                  onClick={(event) => {
                    event.preventDefault();
                    select(item.style);
                  }}
                >
                  <img
                    src={`${import.meta.env.BASE_URL}environments/${item.style}.png`}
                    alt={item.alt}
                    loading={item.style === "grow-dusk" ? "eager" : "lazy"}
                  />
                </Link>
                <div className="launcher-body">
                  <div className="launcher-name">
                    <span className="launcher-dot" aria-hidden="true" />
                    <h2>{item.name}</h2>
                    <span>{item.tagline}</span>
                  </div>
                  <p>{item.text}</p>
                  <dl>
                    <dt>Gives</dt>
                    <dd>{item.gives}</dd>
                    <dt>Costs</dt>
                    <dd>{item.costs}</dd>
                  </dl>
                  <button
                    className="launcher-open"
                    onClick={() => select(item.style)}
                  >
                    Open {item.name}
                  </button>
                </div>
              </article>
            ))}
        </div>
        <section className="launcher-shared">
          <h2>Play a game mode</h2>
          <p>
            Choose a goal and use its default building environment. You can
            change environments in the workspace.
          </p>
          <ul>
            {MODE_CATALOG.map((mode) => (
              <li key={mode.id}>
                <button
                  className="launcher-mode"
                  onClick={() => {
                    const game = useGameStore.getState();
                    game.setMode(mode.id);
                    game.setStyle(
                      mode.style === "engineering" ? "levels" : mode.style,
                    );
                    navigate("/play");
                  }}
                >
                  {mode.title}
                </button>{" "}
                · {mode.description}
              </li>
            ))}
          </ul>
          <h2>What the environments share</h2>
          <ul>
            <li>A single structural editor and a versioned model export.</li>
            <li>
              Support reachability based on the model’s connections. Stability
              requires separate analysis.
            </li>
            <li>Experimental analysis where the current model supports it.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
