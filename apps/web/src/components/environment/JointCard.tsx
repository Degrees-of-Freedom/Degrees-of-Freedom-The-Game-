import type { CSSProperties, ReactNode } from "react";
import { useGameStore } from "../../game/store";
import { parseNodeKey, type Restraint } from "../../game/model";
import { DOF_AXIS_COLORS } from "../../viewer/dofGizmo";

const DOF_NAMES = ["Tx", "Ty", "Tz", "Rx", "Ry", "Rz"];
/** How X, Y and Z are drawn on the card icons (screen x right, y down). */
const ICON_AXIS: [number, number][] = [
  [0.88, 0.47],
  [0.88, -0.47],
  [0, -1],
];

const FREE: Restraint = [false, false, false, false, false, false];
const FIXED: Restraint = [true, true, true, true, true, true];
const SUPPORTS: { name: string; values: Restraint; icon: ReactNode }[] = [
  {
    name: "Free",
    values: FREE,
    icon: (
      <circle
        cx="12"
        cy="10"
        r="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="2.5 2.5"
      />
    ),
  },
  {
    name: "Roller",
    values: [false, false, true, false, false, false],
    icon: (
      <>
        <circle cx="12" cy="6" r="3.2" fill="currentColor" />
        <path
          d="M5 13h14"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="7.5" cy="18" r="2.4" fill="currentColor" />
        <circle cx="16.5" cy="18" r="2.4" fill="currentColor" />
      </>
    ),
  },
  {
    name: "Pinned",
    values: [true, true, true, false, false, false],
    icon: (
      <>
        <circle cx="12" cy="5.5" r="3.2" fill="currentColor" />
        <path d="M12 8 6 18h12z" fill="currentColor" />
        <path
          d="M4 20h16"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    name: "Fixed",
    values: FIXED,
    icon: (
      <>
        <rect x="6" y="9" width="12" height="9" rx="1.5" fill="currentColor" />
        <path
          d="M12 2v8"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <path
          d="M3 20h18"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </>
    ),
  },
];

const sameRestraint = (a: Restraint, b: Restraint) =>
  a.every((value, index) => value === b[index]);

/** Arrow for a translation, curl for a rotation, drawn along the icon axis. */
function DofIcon({ index }: { index: number }) {
  const [x, y] = ICON_AXIS[index % 3];
  if (index < 3) {
    const head = (sign: number) => {
      const tx = x * 12 * sign,
        ty = y * 12 * sign,
        bx = x * 6 * sign,
        by = y * 6 * sign;
      return `M${tx} ${ty} L${bx - y * 4.5} ${by + x * 4.5} L${bx + y * 4.5} ${by - x * 4.5}z`;
    };
    return (
      <svg viewBox="-15 -15 30 30" aria-hidden="true">
        <path
          d={`M${-x * 8} ${-y * 8} L${x * 8} ${y * 8}`}
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d={head(1)} fill="currentColor" />
        <path d={head(-1)} fill="currentColor" />
      </svg>
    );
  }
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  return (
    <svg viewBox="-15 -15 30 30" aria-hidden="true">
      <g transform={`rotate(${angle})`}>
        <path
          d="M-14 0H-7.5M7.5 0H14"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity=".75"
        />
        <path
          d="M2.5 -8.2A5 9.5 0 1 1 -2.5 -8.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <path d="M1 -12 L-0.2 -4.6 L-6.4 -10.2z" fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * The joint card of the Grow Dusk prototype for the app's node model: support
 * presets, the six ground-restraint components and the joint type.
 *
 * The render loop places it beside the selected joint (`Scene.tsx`). Two
 * subjects are kept apart, as the joint DOF criteria require
 * (docs/kb/joint-dof-criteria.md): "Support" and the six tiles are restraints
 * relative to the ground; "Joint between members" is how member ends connect
 * here. Neither says whether the structure is stable. Support edits are a
 * Creative-mode feature of the store; other modes show them read-only.
 */
export function JointCard({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const game = useGameStore();
  const selection = game.selected;
  if (
    !selection ||
    selection.type !== "node" ||
    game.mode === "multiplayer" ||
    game.tool === "load"
  )
    return null;
  const key = selection.key,
    point = parseNodeKey(key),
    attrs = game.model.attrs[key] ?? {};
  const restraint: Restraint = attrs.restraint ?? (attrs.found ? FIXED : FREE);
  const editable = game.mode === "creative" && !attrs.locked;
  const support =
    SUPPORTS.find(({ values }) => sameRestraint(values, restraint))?.name ??
    "Custom";
  const rigid = !!attrs.joint;
  const setRestraint = (values: Restraint) =>
    onMessage(game.setNodeRestraint(key, values) ?? "");
  const setRigid = (next: boolean) => {
    if (next !== rigid) onMessage(game.toggleAttr(point, "joint") ?? "");
  };
  return (
    <section id="card" className="env-card chip show" aria-label="Joint">
      <h3>
        <span>Joint [{point.join(", ")}]</span>
        <button
          type="button"
          className="btn icon"
          title="Close (Esc)"
          aria-label="Close"
          style={{ height: 26, width: 26 }}
          onClick={() => game.setSelected(null)}
        >
          ×
        </button>
      </h3>
      <div className="sub">
        {support === "Free"
          ? "no ground support"
          : `${support.toLowerCase()} support`}{" "}
        · {rigid ? "rigid" : "pinned"} joint
      </div>
      <div className="lbl">
        <span>Support</span>
        {support === "Custom" ? (
          <span className="tag">custom</span>
        ) : (
          <span style={{ fontWeight: 600 }}>relative to the ground</span>
        )}
      </div>
      <div className="seg four">
        {SUPPORTS.map(({ name, values, icon }) => (
          <button
            key={name}
            type="button"
            title={`Support: ${name.toLowerCase()}`}
            className={support === name ? "on" : ""}
            aria-pressed={support === name}
            disabled={!editable}
            onClick={() => setRestraint(values)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {icon}
            </svg>
            {name}
          </button>
        ))}
      </div>
      <div className="lbl">
        <span>Degrees of freedom</span>
        <span style={{ fontWeight: 600 }}>
          {editable ? "tap to lock or free" : "set by this mode"}
        </span>
      </div>
      <div className="dofs">
        {DOF_NAMES.map((name, index) => {
          const isLocked = restraint[index];
          const [dx, dy] = ICON_AXIS[index % 3];
          return (
            <button
              key={name}
              type="button"
              className={`dof ${isLocked ? "locked" : "free"}${index >= 3 ? " rot" : ""}`}
              style={
                {
                  "--c": DOF_AXIS_COLORS[index % 3],
                  "--dx": dx,
                  "--dy": dy,
                } as CSSProperties
              }
              title={`${name}: ${index < 3 ? "move along" : "turn about"} ${"XYZ"[index % 3]}, ${isLocked ? "locked" : "free"}`}
              aria-pressed={isLocked}
              disabled={!editable}
              onClick={() => {
                const next: Restraint = [...restraint];
                next[index] = !next[index];
                setRestraint(next);
              }}
            >
              <DofIcon index={index} />
              <span>{name}</span>
              <small>{isLocked ? "locked" : "free"}</small>
            </button>
          );
        })}
      </div>
      <div className="lbl">
        <span>Joint between members</span>
      </div>
      <div className="seg two">
        <button
          type="button"
          title="Rigid: passes bending between members"
          className={rigid ? "on" : ""}
          aria-pressed={rigid}
          onClick={() => setRigid(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="7" fill="currentColor" />
          </svg>
          Rigid
        </button>
        <button
          type="button"
          title="Pinned: member ends are free to rotate here"
          className={rigid ? "" : "on"}
          aria-pressed={!rigid}
          onClick={() => setRigid(false)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="12"
              cy="12"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
            />
            <circle cx="12" cy="12" r="2.6" fill="currentColor" />
          </svg>
          Pinned
        </button>
      </div>
      <div className="foot">
        Locks describe this joint, not whether the structure stands. Run the
        simulation to check. Right-click the joint to remove what it carries.
      </div>
    </section>
  );
}
