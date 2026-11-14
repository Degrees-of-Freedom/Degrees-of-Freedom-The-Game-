import { createStateService, loadMode } from "../game/persistence";
import { modeSetup, type GameMode } from "../game/modes";
import type { LevelId } from "../game/model";
import { useGameStore } from "../game/store";

/**
 * Read-only check for progress that Start would resume or overwrite.
 * Reads the same browser saves the store reads; it never writes.
 * Multiplayer progress is the persisted turn state held by the store.
 */
export function hasSavedProgress(mode: GameMode, levelId?: LevelId): boolean {
  if (mode === "multiplayer") return useGameStore.getState().turn !== null;
  try {
    const result =
      mode === "challenge"
        ? createStateService(localStorage).load(levelId ?? "tower1")
        : loadMode(modeSetup(mode).levelId, mode);
    return result.status === "found" && result.model.members.length > 0;
  } catch {
    return false;
  }
}
