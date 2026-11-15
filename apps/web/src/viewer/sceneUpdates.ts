import type { useGameStore } from "../game/store";

type State = ReturnType<typeof useGameStore.getState>;
type Inputs = Pick<State, "model" | "turn" | "mode" | "style" | "levelId" | "workK" | "selected" |
  "selectedCardId" | "selectedConnectionProfile" | "tool" | "chainStart" | "loadBrush">;

/** Geometry owns only physical/presentation inputs. Targeting changes rebuild
 * the legal target guides; persistence/worker status is read live by picking
 * and React and must not retire every mesh, shader and label texture. */
export function sceneUpdateKind(next: Inputs, previous: Inputs): "structure" | "guides" | "none" {
  if (next.model !== previous.model || next.turn !== previous.turn || next.mode !== previous.mode ||
    next.style !== previous.style || next.levelId !== previous.levelId || next.workK !== previous.workK ||
    next.selected !== previous.selected) return "structure";
  if (next.selectedCardId !== previous.selectedCardId || next.selectedConnectionProfile !== previous.selectedConnectionProfile ||
    next.tool !== previous.tool || next.chainStart !== previous.chainStart || next.loadBrush !== previous.loadBrush) return "guides";
  return "none";
}
