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
import { selectedTurnCard } from "./turnPicking";
import { targetCoordinate } from "../game/turnPorts";
import { stageElement } from "../game/turns";

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
  turn: GameState["turn"];
  cardId: string | null;
  targets: ReadyTarget[];
} | null = null;

/**
 * Editor targets follow member rules; turn targets are checked by stageElement.
 * In the editor, every lattice point the member rules allow is a point
 * whose offset on each axis is within the section's `maxCells` (the same limit
 * `memberIssue` enforces), still filtered through `memberIssue` for bounds,
 * terrain, duplicates and supply. That includes corner points such as
 * (+3, +3, +3) for a beam, not only a sphere around the start.
 *
 * The picker calls this on every pointer move, so the list is cached per
 * (chain start, tool, model identity, level, style, turn and selected card).
 */
export function growthTargets(state: GameState): ReadyTarget[] {
  const card = selectedTurnCard(state);
  const type = state.tool as MemberType;
  if (
    !isGrowthStyle(state.style) ||
    !state.chainStart ||
    (state.mode === "multiplayer" ? card?.kind !== "element" : !MEMBER_TYPES.includes(type))
  )
    return [];
  if (
    cache &&
    cache.chainStart === state.chainStart &&
    cache.tool === state.tool &&
    cache.model === state.model &&
    cache.levelId === state.levelId &&
    cache.style === state.style &&
    cache.turn === state.turn && cache.cardId === state.selectedCardId
  )
    return cache.targets;
  const origin = parseNodeKey(targetCoordinate(state.model.members, state.chainStart));
  const level = LEVELS[state.levelId];
  const radius = card?.kind === "element" ? card.maxSteps : ITEMS[type].maxCells;
  const targets: ReadyTarget[] = [];
  for (let x = -radius; x <= radius; x++)
    for (let y = -radius; y <= radius; y++)
      for (let z = -radius; z <= radius; z++) {
        const point: GridPoint = [origin[0] + x, origin[1] + y, origin[2] + z];
        if (card?.kind === "element" && state.turn) {
          if (!stageElement(state.turn, card.id, state.chainStart, nodeKey(...point)).ok) continue;
        } else if (memberIssue(level, state.model, origin, point, type)) continue;
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
    turn: state.turn,
    cardId: state.selectedCardId,
    targets,
  };
  return targets;
}
