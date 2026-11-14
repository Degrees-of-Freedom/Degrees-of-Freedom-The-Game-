import { ITEMS, MEMBER_TYPES } from '../game/inventory';
import { nodeKey, parseNodeKey, type GridPoint, type MemberType } from '../game/model';
import { LEVELS } from '../game/levels';
import { memberIssue } from '../game/placementRules';
import { useGameStore } from '../game/store';
import { isGrowthStyle } from './sceneStyle';

type ReadyTarget = { key: string; point: GridPoint; role: 'column' | 'beam' | 'brace' };

export const GROWTH_ROLE_INDEX = { column: 0, beam: 1, brace: 2 } as const;

// The prototype offered the closest four lattice steps. The section and terrain
// can reduce that set through the same validation used to commit a member.
export function growthTargets(state: ReturnType<typeof useGameStore.getState>): ReadyTarget[] {
  const type = state.tool as MemberType;
  if (!isGrowthStyle(state.style) || !state.chainStart || !MEMBER_TYPES.includes(type))
    return [];
  const origin = parseNodeKey(state.chainStart);
  const level = LEVELS[state.levelId];
  const radius = Math.min(4, ITEMS[type].maxCells);
  const targets: ReadyTarget[] = [];
  for (let x = -radius; x <= radius; x++)
    for (let y = -radius; y <= radius; y++)
      for (let z = -radius; z <= radius; z++) {
        if (x * x + y * y + z * z > radius * radius) continue;
        const point: GridPoint = [origin[0] + x, origin[1] + y, origin[2] + z];
        if (memberIssue(level, state.model, origin, point, type)) continue;
        targets.push({
          key: nodeKey(...point),
          point,
          role: z === 0 ? 'beam' : x === 0 && y === 0 ? 'column' : 'brace',
        });
      }
  return targets;
}
