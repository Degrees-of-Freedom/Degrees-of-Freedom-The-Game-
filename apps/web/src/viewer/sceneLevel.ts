import { LEVELS } from "../game/levels";
import { KIT_PLAYTEST, boardLimits } from "../game/turns";
import type { useGameStore } from "../game/store";

export function sceneLevel(state: ReturnType<typeof useGameStore.getState>) {
  const level = LEVELS[state.levelId];
  if (state.mode !== "multiplayer") return level;
  const [nx, ny, nz] = state.turn ? boardLimits(state.turn) : KIT_PLAYTEST.boardMax;
  return { ...LEVELS.sandbox, nx, ny, nz, lakes: [], target: undefined };
}
