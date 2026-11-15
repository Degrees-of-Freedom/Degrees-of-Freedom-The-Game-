import { useGameStore } from "../../game/store";
import { TRICHORD } from "../../game/assembly";
import {
  parseNodeKey,
  type MemberType,
  type Restraint,
  type LoadDirection,
} from "../../game/model";
import type { PresentationStyle } from "../../game/modes";
import { ITEMS, MEMBER_TYPES } from "../../game/inventory";
import { activeTurnHand } from "../../game/turns";
import { DofGlyph } from "./DofGlyph";
import { GrowthTools } from "./GrowthTools";
import { JointCard } from "./JointCard";

type Props = { style: PresentationStyle; onMessage: (message: string) => void };
type IconKind =
  | "member"
  | "connection"
  | "foundation"
  | "load"
  | "erase"
  | "inspect"
  | "block"
  | "brace";

/** The tool glyphs follow the Levels and Blocks prototype artwork. */
function Icon({ kind, style }: { kind: IconKind; style: PresentationStyle }) {
  if (kind === "foundation") return (
    <svg viewBox="0 0 30 30" aria-hidden="true" stroke="#3f4654" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 5h6v12h-6z" fill="#fbf7ef" />
      <path d="M7 17h16l3 7H4z" fill="#b9b4aa" />
      <path d="M3 25h24" stroke="#836747" />
    </svg>
  );
  if (style === "kit") {
    if (kind === "member")
      return (
        <svg width="54" height="14" viewBox="0 0 54 14" aria-hidden="true">
          <rect
            className="stickfill"
            x="0"
            y="1"
            width="54"
            height="12"
            rx="6"
          />
          <rect
            x="5"
            y="3.2"
            width="44"
            height="2.6"
            rx="1.3"
            fill="rgba(255,255,255,.35)"
          />
        </svg>
      );
    if (kind === "connection")
      return (
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <rect x="4" y="4" width="20" height="20" rx="5" fill="#f3ead8" />
          <rect
            x="7"
            y="6.5"
            width="14"
            height="3"
            rx="1.5"
            fill="rgba(255,255,255,.7)"
          />
        </svg>
      );
    if (kind === "load")
      return (
        <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden="true">
          <rect x="16" y="3" width="8" height="7" rx="2.5" fill="#d99a22" />
          <path d="M10 8h20l5 23q0 3-3 3H8q-3 0-3-3z" fill="#f2b134" />
        </svg>
      );
    if (kind === "erase")
      return (
        <svg
          width="30"
          height="28"
          viewBox="0 0 30 28"
          fill="none"
          stroke="#f3ead8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 7 5 13l6 6M5 13h13a6 6 0 0 1 0 12h-4" />
        </svg>
      );
  }
  if (style === "grow" || style === "grow-dusk") {
    if (kind === "member")
      return (
        <svg viewBox="0 0 30 30" aria-hidden="true">
          <path
            d="M7 23 22 8"
            stroke="#e3b04b"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <circle
            cx="7"
            cy="23"
            r="4"
            fill="#fbf7ef"
            stroke="#3f4654"
            strokeWidth="1.8"
          />
          <circle cx="22" cy="8" r="2.4" fill="#4f9da6" />
          <circle cx="26" cy="15" r="1.6" fill="#4f9da6" opacity=".6" />
          <circle cx="14" cy="5" r="1.6" fill="#d86f5c" opacity=".7" />
        </svg>
      );
    if (kind === "connection")
      return (
        <svg viewBox="0 0 30 30" aria-hidden="true">
          <circle
            cx="15"
            cy="15"
            r="8.5"
            fill="#fbf7ef"
            stroke="#3f4654"
            strokeWidth="2.6"
          />
          <circle cx="15" cy="15" r="3" fill="#3f4654" />
          <path
            d="M15 2v4M15 24v4M2 15h4M24 15h4"
            stroke="#6d7a8c"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );
    if (kind === "load")
      return (
        <svg viewBox="0 0 30 30" aria-hidden="true">
          <path
            d="M15 3v15"
            stroke="#d94f3d"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M8 15l7 10 7-10z"
            fill="#d94f3d"
            stroke="#d94f3d"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
  if (kind === "block")
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
        <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3z" />
        <path d="M4 7.5 12 12l8-4.5M12 12v9" />
      </svg>
    );
  if (kind === "brace")
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
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M5 19 19 5" />
      </svg>
    );
  if (kind === "member")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.5 17.5 17.5 6.5"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect
          x="2.5"
          y="14.5"
          width="7"
          height="7"
          rx="1.8"
          fill="currentColor"
        />
        <rect
          x="14.5"
          y="2.5"
          width="7"
          height="7"
          rx="1.8"
          fill="currentColor"
        />
      </svg>
    );
  if (kind === "connection")
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect
          x="9"
          y="9"
          width="6"
          height="6"
          rx="1.4"
          fill="currentColor"
          stroke="none"
        />
        <path d="M4.6 12a7.4 7.4 0 0 1 12.6-5.2M17.6 3.4v3.8h-3.8M19.4 12a7.4 7.4 0 0 1-12.6 5.2M6.4 20.6v-3.8h3.8" />
      </svg>
    );
  if (kind === "load")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9.6 3h4.8v9.2h4.4L12 21.5 5.2 12.2h4.4z"
          fill="currentColor"
        />
      </svg>
    );
  if (kind === "erase")
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
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6" />
      <path d="m14.5 14.5 5 5" />
    </svg>
  );
}

/** Shared scene tools; the active model and placement rules remain in the store. */
export function EnvironmentTools({ style, onMessage }: Props) {
  const game = useGameStore();
  // The growth styles use the Grow Dusk prototype's dock and load pad.
  if (style === "grow" || style === "grow-dusk")
    return <GrowthTools onMessage={onMessage} />;
  const isMember = MEMBER_TYPES.includes(game.tool as MemberType);
  const tools: {
    kind: IconKind;
    label: string;
    key: string;
    active: boolean;
    action: () => void;
  }[] = [
    {
      kind: style === "blocks" ? "block" : "member",
      label: style === "blocks" ? "Block" : "Member",
      key: "1",
      active: isMember,
      action: () => game.setTool(isMember ? game.tool : "shs"),
    },
    ...(style === "blocks"
      ? [
          {
            kind: "brace" as const,
            label: "Brace",
            key: "2",
            active: game.tool === "brace",
            action: () => game.setTool("brace"),
          },
        ]
      : []),
    {
      kind: "connection",
      label: "Connection",
      key: style === "blocks" ? "3" : "2",
      active: game.tool === "joint",
      action: () => game.setTool("joint"),
    },
    ...(game.mode !== "multiplayer" ? [{
      kind: "foundation" as const,
      label: "Foundation",
      key: "B",
      active: game.tool === "found",
      action: () => game.setTool("found"),
    }] : []),
    {
      kind: "load",
      label: "Load",
      key: style === "blocks" ? "4" : "3",
      active: game.tool === "load",
      action: () => game.setTool("load"),
    },
    {
      kind: "erase",
      label: "Erase",
      key: "X",
      active: game.tool === "delete",
      action: () => game.setTool("delete"),
    },
    {
      kind: "inspect",
      label: "Inspect",
      key: "I",
      active: game.tool === "inspect",
      action: () => game.setTool("inspect"),
    },
  ];
  return (
    <>
      <nav className="env-tools chip" aria-label="Building tools">
        {tools.map((tool) => (
          <button
            key={tool.kind}
            className={`tool${tool.active ? " active" : ""}`}
            title={`${tool.label} (${tool.key})`}
            aria-pressed={tool.active}
            onClick={tool.action}
          >
            <Icon kind={tool.kind} style={style} />
            <span>{tool.label}</span>
            <kbd>{tool.key}</kbd>
          </button>
        ))}
      </nav>
      {game.mode === "creative" && game.tool === "load" && (
        <section className="env-pad chip" aria-label="Load to place">
          <div className="title">
            <span>New load</span>
            <small>direction, amount</small>
          </div>
          <div className="pad">
            {(["-Z", "+X", "-X", "+Y", "-Y", "+Z"] as LoadDirection[]).map(
              (axis) => (
                <button
                  className={game.loadBrush.direction === axis ? "on" : ""}
                  aria-pressed={game.loadBrush.direction === axis}
                  key={axis}
                  onClick={() =>
                    game.setLoadBrush(game.loadBrush.magnitude, axis)
                  }
                >
                  {axis.replace("-", "−")}
                </button>
              ),
            )}
          </div>
          <div className="chips">
            {[5, 10, 20, 50].map((amount) => (
              <button
                className={game.loadBrush.magnitude === amount ? "on" : ""}
                aria-pressed={game.loadBrush.magnitude === amount}
                key={amount}
                onClick={() =>
                  game.setLoadBrush(amount, game.loadBrush.direction)
                }
              >
                {amount}
              </button>
            ))}
          </div>
          <small>kN</small>
        </section>
      )}
    </>
  );
}

/** Physical piece palette, or the active player's actual card hand in Kit. */
export function EnvironmentTray({ style }: Props) {
  const game = useGameStore();
  if (style !== "kit" && style !== "blocks") return null;
  if (game.mode === "multiplayer" && game.turn) {
    if (game.turn.finished)
      return (
        <div className="env-tray panel">
          <div className="well">
            <h4>Match complete</h4>
            <button className="token" onClick={() => game.newMatch()}>
              <small>New match</small>
            </button>
          </div>
        </div>
      );
    const cards = activeTurnHand(game.turn);
    return (
      <div className="env-tray panel" aria-label="Card tray">
        {(["element", "connection", "load"] as const).map((kind, index) => (
          <div className="well" key={kind}>
            <h4>
              <kbd>{index + 1}</kbd>
              {kind === "element"
                ? "Sticks"
                : kind === "connection"
                  ? "Joints"
                  : "Weights"}
            </h4>
            {!cards.some((card) => card.kind === kind) && (
              <p className="tray-empty" role="status">
                {kind === "element"
                  ? game.turn!.draft.members.length
                    ? "Stick placed this turn."
                    : "No stick cards in hand."
                  : kind === "connection"
                    ? game.turn!.draft.connections.length
                      ? "Joint cards placed."
                      : "No joint cards in hand."
                    : game.turn!.draft.loads.length
                      ? "Weight placed this turn."
                      : "No weight cards in hand."}
                {kind === "element" && game.turn!.draft.members.length > 0 && (
                  <small>To take it back, open Turn details → Cancel draft.</small>
                )}
              </p>
            )}
            {cards
              .filter((card) => card.kind === kind)
              .map((card) => (
                <button
                  className={`token${game.selectedCardId === card.id ? " selected" : ""}`}
                  aria-pressed={game.selectedCardId === card.id}
                  key={card.id}
                  onClick={() => game.selectCard(card.id)}
                >
                  <Icon
                    kind={
                      kind === "element"
                        ? "member"
                        : kind === "connection"
                          ? "connection"
                          : "load"
                    }
                    style={style}
                  />
                  <small>{card.label}</small>
                </button>
              ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="env-tray panel" aria-label="Piece tray">
      <div className="well">
        <h4>
          <kbd>1</kbd>Sticks
        </h4>
        {MEMBER_TYPES.map((type) => (
          <button
            className={`token${game.tool === type ? " selected" : ""}`}
            aria-pressed={game.tool === type}
            key={type}
            onClick={() => game.setTool(type)}
          >
            <Icon kind="member" style={style} />
            <small>{ITEMS[type].label}</small>
          </button>
        ))}
      </div>
      <div className="well">
        <h4>
          <kbd>2</kbd>Joints
        </h4>
        <button
          className={`token${game.tool === "joint" ? " selected" : ""}`}
          onClick={() => game.setTool("joint")}
        >
          <Icon kind="connection" style={style} />
          <small>Connection</small>
        </button>
        <button
          className={`token${game.tool === "found" ? " selected" : ""}`}
          onClick={() => game.setTool("found")}
        >
          <Icon kind="foundation" style={style} />
          <small>Foundation</small>
        </button>
      </div>
      <div className="well">
        <h4>
          <kbd>3</kbd>Weights
        </h4>
        <button
          className={`token${game.tool === "load" ? " selected" : ""}`}
          onClick={() => game.setTool("load")}
        >
          <Icon kind="load" style={style} />
          <small>Gravity</small>
        </button>
      </div>
      <div className="well">
        <h4>Board</h4>
        <button className="token always" onClick={() => game.setTool("delete")}>
          <Icon kind="erase" style={style} />
          <small>Take back</small>
          <kbd className="key">X</kbd>
        </button>
      </div>
    </div>
  );
}

/** Context card describes the supported node-level model without inventing DOF edits. */
export function EnvironmentInspector({ onMessage }: Pick<Props, "onMessage">) {
  const game = useGameStore();
  const selection = game.selected;
  if (!selection || game.mode === "multiplayer") return null;
  if (selection.type === "member") {
    const member = game.model.members.find((m) => m.id === selection.id);
    if (!member) return null;
    return (
      <section className="env-card card pop show docked">
        <div className="dc-head">
          <div>
            <div className="dc-title">
              Member <span>{member.id}</span>
            </div>
            <div className="dc-sub">
              {member.assembly === TRICHORD.id ? "Four-panel trichord truss" : member.assembly ? "Four-panel planar truss" : ITEMS[member.type].label} · [{member.a}] → [{member.b}]
            </div>
          </div>
          <button
            className="dc-close"
            aria-label="Close"
            onClick={() => game.setSelected(null)}
          >
            ×
          </button>
        </div>
        <div className="dc-foot">
          <button
            className="btn small"
            onClick={() => {
              game.removeMember(member.id);
              game.setSelected(null);
            }}
          >
            Remove
          </button>
        </div>
      </section>
    );
  }
  // The growth styles show the prototype's joint card beside the joint.
  if (game.style === "grow" || game.style === "grow-dusk")
    return <JointCard onMessage={onMessage} />;
  const key = selection.key,
    point = parseNodeKey(key),
    attrs = game.model.attrs[key] ?? {};
  const update = (type: "found" | "joint") =>
    onMessage(game.toggleAttr(point, type) ?? "");
  const restraint: Restraint =
    attrs.restraint ??
    (attrs.found
      ? [true, true, true, true, true, true]
      : [false, false, false, false, false, false]);
  const creative = game.mode === "creative";
  const preset = (values: Restraint) =>
    onMessage(game.setNodeRestraint(key, values) ?? "");
  const supportPresets: { name: string; values: Restraint }[] = [
    { name: "Free", values: [false, false, false, false, false, false] },
    { name: "Roller", values: [false, false, true, false, false, false] },
    { name: "Pinned", values: [true, true, true, false, false, false] },
    { name: "Fixed", values: [true, true, true, true, true, true] },
  ];
  return (
    <section className="env-card card pop" aria-label="Connection and load"
      data-foundation={creative && attrs.found ? "true" : undefined}>
      <div className="dc-head">
        <div>
          <div className="dc-title">
            Connection <span>[{key}]</span>
          </div>
          <div className="dc-sub">
            {attrs.found ? "Foundation" : "Shared node"}
          </div>
        </div>
        <button
          className="dc-close"
          aria-label="Close"
          onClick={() => game.setSelected(null)}
        >
          ×
        </button>
      </div>
      <div className="dc-label">
        <span>Degrees of freedom</span>
        <span>{restraint.filter(Boolean).length} of 6 locked</span>
      </div>
      <div className="dc-dofs">
        {["Tx", "Ty", "Tz", "Rx", "Ry", "Rz"].map((axis, i) => (
          <button
            type="button"
            disabled={!creative || attrs.locked}
            key={axis}
            className={`dof${restraint[i] ? " locked" : " free"}`}
            aria-pressed={restraint[i]}
            onClick={() => {
              const next: Restraint = [...restraint];
              next[i] = !next[i];
              preset(next);
            }}
          >
            <DofGlyph axis={i} locked={restraint[i]} />
            <b>{axis}</b>
            <small>{restraint[i] ? "locked" : "free"}</small>
          </button>
        ))}
      </div>
      <div className="dc-row">
        <span className="lab">Support</span>
        <div className="seg">
          {supportPresets.map(({ name, values }) => (
            <button
              key={name}
              disabled={!creative || attrs.locked}
              className={
                values.every((value, i) => value === restraint[i]) ? "on" : ""
              }
              onClick={() => preset(values)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="dc-row">
        <span className="lab">Joint</span>
        <div className="seg">
          <button
            className={!attrs.joint ? "on" : ""}
            onClick={() => attrs.joint && update("joint")}
          >
            Pinned
          </button>
          <button
            className={attrs.joint ? "on" : ""}
            onClick={() => !attrs.joint && update("joint")}
          >
            Rigid
          </button>
        </div>
      </div>
      <div className="dc-note">
        Edit six support restraints and signed axis loads in creative mode.
        Run simulation to calculate their response with member self-weight.
      </div>
      {attrs.load !== undefined && (
        <>
          <div className="dc-label">
            <span>Direction</span>
          </div>
          <div className="pad">
            {(["-Z", "+X", "-X", "+Y", "-Y", "+Z"] as LoadDirection[]).map(
              (axis) => (
                <button
                  key={axis}
                  className={(attrs.loadDirection ?? "-Z") === axis ? "on" : ""}
                  disabled={!creative || attrs.locked}
                  onClick={() =>
                    onMessage(game.setNodeLoadDirection(key, axis) ?? "")
                  }
                >
                  {axis.replace("-", "−")}
                </button>
              ),
            )}
          </div>
          <div className="dc-label">
            <span>Amount</span>
            <span>kN</span>
          </div>
          <div className="chips">
            {[5, 10, 20, 50].map((amount) => (
              <button
                key={amount}
                className={attrs.load === amount ? "on" : ""}
                disabled={attrs.locked}
                onClick={() => onMessage(game.setNodeLoad(key, amount) ?? "")}
              >
                {amount}
              </button>
            ))}
          </div>
          <div className="dc-foot">
            <button
              className="btn small"
              disabled={attrs.locked}
              onClick={() => onMessage(game.toggleAttr(point, "load") ?? "")}
            >
              Remove load
            </button>
          </div>
        </>
      )}
    </section>
  );
}
