import type { useGameStore } from "../../game/store";
import { MEMBER_TYPES } from "../../game/inventory";
import type { MemberType } from "../../game/model";

type Game = ReturnType<typeof useGameStore.getState>;

/**
 * One line of guidance above the dock, worded after the Grow Dusk prototype's
 * hints and limited to what the app's tools actually do. Mode goals come
 * first, because they tell the player what the build is for.
 */
export function growthHint(game: Game, objectiveMet: boolean): string {
  if (game.mode === "multiplayer")
    return game.turn?.finished
      ? "Match complete. Start a new match from the tray or the menu."
      : "Reveal your hand, choose a card, then place it on the table. End turn passes the table.";
  if (game.mode === "forensics" && objectiveMet)
    return "Structure repaired. The experimental checks passed.";
  const isMember = MEMBER_TYPES.includes(game.tool as MemberType);
  const selectedNode =
    game.selected?.type === "node"
      ? game.model.attrs[game.selected.key]
      : undefined;
  if (isMember) {
    if (game.chainStart)
      return "Click a blooming point to place a member. Drag empty space to look around. Esc or right-click lets go.";
    if (game.mode === "forensics")
      return "Find the floating member and connect it to the supported frame.";
    if (game.mode === "load-space")
      return "Carry the suspended load to a foundation. Click a joint or a quay dot to start a member.";
    return game.model.members.length
      ? "Click a joint or a quay dot to start a member, or drag straight to a point."
      : "Click a dot on the quay to start building.";
  }
  if (game.tool === "joint")
    return game.selected?.type === "node"
      ? "Lock or free each degree of freedom on the card. Esc closes it."
      : "Click a joint to see and change its degrees of freedom.";
  if (game.tool === "load")
    return selectedNode?.load !== undefined
      ? "Change the direction or amount of the selected load below."
      : "Click a joint to place a load. Click a loaded joint to edit it.";
  if (game.tool === "delete")
    return "Click a member, load, joint type or support to remove it.";
  if (game.tool === "inspect")
    return "Click a member or a joint to inspect it.";
  return "Click a joint or a ground point to begin.";
}

/**
 * Controls panel of the growth styles, in the prototype's bottom-right place
 * and row order. Each row describes behaviour the app has; prototype-only
 * gestures (joints at points along a member, wheel on a load) are left out.
 */
export function GrowthHelp({ onClose }: { onClose: () => void }) {
  return (
    <section id="help" className="chip show" aria-label="Controls">
      <h3>
        Controls{" "}
        <button
          className="btn icon"
          title="Hide (H)"
          aria-label="Close controls"
          style={{ height: 26, width: 26 }}
          onClick={onClose}
        >
          ×
        </button>
      </h3>
      <table>
        <tbody>
          <tr>
            <td>1 · Member</td>
            <td>
              Click a joint or a quay dot. Points bloom; click one to place.
              Keep clicking to carry on, or drag from a point and let go. Reach
              depends on the section. Where points overlap on screen, the wheel
              or <b>[</b> and <b>]</b> picks the one in front or behind.
            </td>
          </tr>
          <tr>
            <td>2 · Connection</td>
            <td>
              Click a joint to open its six degrees of freedom and its joint
              type.
            </td>
          </tr>
          <tr>
            <td>3 · Load</td>
            <td>
              Pick direction and amount, then click a joint. Click a loaded
              joint to edit or remove its load.
            </td>
          </tr>
          <tr>
            <td>Remove</td>
            <td>
              Right-click, Alt+click, or point and press Delete. The eraser
              button (X) does the same with a plain click.
            </td>
          </tr>
          <tr>
            <td>Camera</td>
            <td>
              Drag empty space to orbit, wheel to zoom, right-drag or
              Shift+drag to pan, F to re-frame, Q and E to turn.
            </td>
          </tr>
          <tr>
            <td>Keys</td>
            <td>
              Esc cancels · R runs the simulation · L load path · I inspect ·
              Ctrl+Z undo · Ctrl+Y redo · H help · P menu
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The analysis is experimental. Its results are not engineering design
        evidence.
      </p>
    </section>
  );
}
