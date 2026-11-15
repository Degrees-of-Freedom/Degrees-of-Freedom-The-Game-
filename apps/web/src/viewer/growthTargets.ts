import { ITEMS, MEMBER_TYPES } from "../game/inventory";
import {
  nodeKey,
  parseNodeKey,
  type GridPoint,
  type MemberType,
} from "../game/model";
import { LEVELS } from "../game/levels";
import { memberIssue } from "../game/placementRules";
import { useGameStore } from "../game/store";
import { isGrowthStyle } from "./sceneStyle";

type ReadyTarget = {
  key: string;
  point: GridPoint;
  role: "column" | "beam" | "brace";
};

export const GROWTH_ROLE_INDEX = { column: 0, beam: 1, brace: 2 } as const;

type GameState = ReturnType<typeof useGameStore.getState>;
let cache: {
  chainStart: string;
  tool: string;
  model: GameState["model"];
  levelId: string;
  style: string;
  targets: ReadyTarget[];
} | null = null;

/**
 * Every lattice point the member rules allow from the chain start: any point
 * whose offset on each axis is within the section's `maxCells` (the same limit
 * `memberIssue` enforces), still filtered through `memberIssue` for bounds,
 * terrain, duplicates and supply. That includes corner points such as
 * (+3, +3, +3) for a beam, not only a sphere around the start.
 *
 * The picker calls this on every pointer move, so the list is cached per
 * (chain start, tool, model identity, level, style).
 */
export function growthTargets(state: GameState): ReadyTarget[] {
  const type = state.tool as MemberType;
  if (
    state.mode === "multiplayer" ||
    !isGrowthStyle(state.style) ||
    !state.chainStart ||
    !MEMBER_TYPES.includes(type)
  )
    return [];
  if (
    cache &&
    cache.chainStart === state.chainStart &&
    cache.tool === state.tool &&
    cache.model === state.model &&
    cache.levelId === state.levelId &&
    cache.style === state.style
  )
    return cache.targets;
  const origin = parseNodeKey(state.chainStart);
  const level = LEVELS[state.levelId];
  const radius = ITEMS[type].maxCells;
  const targets: ReadyTarget[] = [];
  for (let x = -radius; x <= radius; x++)
    for (let y = -radius; y <= radius; y++)
      for (let z = -radius; z <= radius; z++) {
        const point: GridPoint = [origin[0] + x, origin[1] + y, origin[2] + z];
        if (memberIssue(level, state.model, origin, point, type)) continue;
        targets.push({
          key: nodeKey(...point),
          point,
          role: z === 0 ? "beam" : x === 0 && y === 0 ? "column" : "brace",
        });
      }
  cache = {
    chainStart: state.chainStart,
    tool: state.tool,
    model: state.model,
    levelId: state.levelId,
    style: state.style,
    targets,
  };
  return targets;
}
