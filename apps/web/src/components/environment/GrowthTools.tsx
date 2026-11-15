import { useGameStore } from "../../game/store";
import {
  parseNodeKey,
  type LoadDirection,
  type MemberType,
} from "../../game/model";
import { MEMBER_TYPES } from "../../game/inventory";
import { DOF_AXIS_COLORS } from "../../viewer/dofGizmo";

/** Load directions in the prototype's pad order, with their axis for colouring. */
const DIRECTIONS: { id: LoadDirection; label: string; axis: number }[] = [
  { id: "-Z", label: "down", axis: 2 },
  { id: "+Z", label: "up", axis: 2 },
  { id: "+X", label: "+X", axis: 0 },
  { id: "-X", label: "−X", axis: 0 },
  { id: "+Y", label: "+Y", axis: 1 },
  { id: "-Y", label: "−Y", axis: 1 },
];
const AMOUNTS = [5, 10, 20, 50];
/** Load placed outside Creative, where the store fixes magnitude and direction. */
const FIXED_LOAD = 50;

function MemberIcon() {
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <path
        d="M7 23 22 8"
        stroke="#6a9bd8"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle
        cx="7"
        cy="23"
        r="4"
        fill="#f3ead8"
        stroke="#22313f"
        strokeWidth="1.8"
      />
      <circle
        cx="22"
        cy="8"
        r="2.4"
        fill="#8cc7b5"
        stroke="#22313f"
        strokeWidth="1"
      />
      <circle cx="26" cy="15" r="1.6" fill="#8cc7b5" opacity=".8" />
      <circle cx="14" cy="5" r="1.6" fill="#e9806e" opacity=".9" />
    </svg>
  );
}

function ConnectionIcon() {
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <circle
        cx="15"
        cy="15"
        r="8.5"
        fill="#f3ead8"
        stroke="#22313f"
        strokeWidth="2.6"
      />
      <circle cx="15" cy="15" r="3" fill="#22313f" />
      <path
        d="M15 2v4M15 24v4M2 15h4M24 15h4"
        stroke="#bca987"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LoadIcon() {
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true">
      <path
        d="M15 3v15"
        stroke="#f2b134"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M8 15l7 10 7-10z"
        fill="#f2b134"
        stroke="#22313f"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EraseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14.6 4.2 20 9.6l-8.6 8.6H7.2L3.6 14.6zM9.2 9.6l5.4 5.4M4 21h16" />
    </svg>
  );
}

function InspectIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6" />
      <path d="m14.5 14.5 5 5" />
    </svg>
  );
}

/**
 * Dock of the growth styles, following the Grow Dusk prototype: three tools
 * (Member, Connection, Load) and, above them, the load pad while the Load tool
 * is active.
 *
 * Two compact buttons, Erase and Inspect, are an addition to the prototype.
 * The prototype removes pieces only with right-click, Alt+click or Delete; the
 * controls criteria (docs/kb/controls-camera-criteria.md) ask that no action
 * depend on right-click or hover alone, so the on-screen route is kept.
 */
export function GrowthTools({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const game = useGameStore();
  const isMember = MEMBER_TYPES.includes(game.tool as MemberType);
  const creative = game.mode === "creative";

  // In the Load tool a selected joint that carries a load is edited in the pad.
  const selectedKey =
    game.tool === "load" && game.selected?.type === "node"
      ? game.selected.key
      : null;
  const selectedAttrs = selectedKey ? game.model.attrs[selectedKey] : undefined;
  const editingKey =
    selectedKey && selectedAttrs?.load !== undefined ? selectedKey : null;
  const locked = !!selectedAttrs?.locked;
  const direction: LoadDirection = editingKey
    ? (selectedAttrs?.loadDirection ?? "-Z")
    : creative
      ? game.loadBrush.direction
      : "-Z";
  const amount = editingKey
    ? selectedAttrs?.load
    : creative
      ? game.loadBrush.magnitude
      : FIXED_LOAD;

  function choose(tool: typeof game.tool) {
    game.setSelected(null);
    game.setTool(tool);
  }
  function setDirection(id: LoadDirection) {
    if (editingKey) onMessage(game.setNodeLoadDirection(editingKey, id) ?? "");
    else game.setLoadBrush(game.loadBrush.magnitude, id);
  }
  function setAmount(value: number) {
    if (editingKey) onMessage(game.setNodeLoad(editingKey, value) ?? "");
    else game.setLoadBrush(value, game.loadBrush.direction);
  }
  function removeLoad() {
    if (!editingKey) return;
    onMessage(game.toggleAttr(parseNodeKey(editingKey), "load") ?? "");
    game.setSelected(null);
  }

  const tools = [
    ...(creative && game.style === "grow-dusk" ? [{ id: "foundation", label: "Foundation", shortcut: "0", active: game.tool === "found", icon: <ConnectionIcon />, action: () => choose("found") }] : []),
    {
      id: "member",
      label: "Member",
      shortcut: "1",
      active: isMember,
      icon: <MemberIcon />,
      action: () => choose(isMember ? game.tool : "shs"),
    },
    {
      id: "connection",
      label: "Connection",
      shortcut: "2",
      active: game.tool === "joint",
      icon: <ConnectionIcon />,
      action: () => choose("joint"),
    },
    {
      id: "load",
      label: "Load",
      shortcut: "3",
      active: game.tool === "load",
      icon: <LoadIcon />,
      action: () => choose("load"),
    },
  ];

  return (
    <>
      {game.tool === "load" && (
        <section
          id="pad"
          className={`env-pad chip show${editingKey ? " editing" : ""}`}
          aria-label={editingKey ? "Selected load" : "Load to place"}
        >
          <div className="title">
            <span>{editingKey ? "Load" : "New load"}</span>
            <small>
              {editingKey
                ? `on joint [${editingKey}]`
                : creative
                  ? "direction, amount"
                  : "set by this mode"}
            </small>
          </div>
          <div className="dirs">
            {DIRECTIONS.map(({ id, label, axis }) => (
              <button
                key={id}
                type="button"
                className={`dir${direction === id ? " on" : ""}`}
                title={`Direction ${label}`}
                aria-pressed={direction === id}
                disabled={!creative || locked}
                onClick={() => setDirection(id)}
              >
                {/* The render loop turns each arrow to match the camera. */}
                <svg
                  viewBox="-12 -12 24 24"
                  data-dir={id}
                  style={{ color: DOF_AXIS_COLORS[axis] }}
                  aria-hidden="true"
                >
                  <path
                    d="M-9 0H4"
                    stroke="currentColor"
                    strokeWidth="3.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M3 -5.5 10 0 3 5.5z"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <span className="sep" style={{ height: 34 }} />
          <div className="amts">
            {AMOUNTS.map((value) => (
              <button
                key={value}
                type="button"
                className={`amt${amount === value ? " on" : ""}`}
                title={`${value} kN`}
                aria-pressed={amount === value}
                disabled={locked || (!editingKey && !creative)}
                onClick={() => setAmount(value)}
              >
                {value} <small>kN</small>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn rm"
            title="Remove this load"
            disabled={locked}
            onClick={removeLoad}
          >
            Remove
          </button>
        </section>
      )}
      <nav id="tools" className="env-tools chip" aria-label="Building tools">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool${tool.active ? " on" : ""}`}
            title={`${tool.label} tool (${tool.shortcut})`}
            aria-pressed={tool.active}
            onClick={tool.action}
          >
            {tool.icon}
            {tool.label}
            <kbd>{tool.shortcut}</kbd>
          </button>
        ))}
        <span className="sep" />
        <button
          type="button"
          className={`tool mini${game.tool === "delete" ? " on" : ""}`}
          title="Erase (X). Right-click, Alt+click or Delete also remove."
          aria-label="Erase"
          aria-pressed={game.tool === "delete"}
          onClick={() => choose("delete")}
        >
          <EraseIcon />
        </button>
        <button
          type="button"
          className={`tool mini${game.tool === "inspect" ? " on" : ""}`}
          title="Inspect (I)"
          aria-label="Inspect"
          aria-pressed={game.tool === "inspect"}
          onClick={() => choose("inspect")}
        >
          <InspectIcon />
        </button>
      </nav>
    </>
  );
}
