import { nodeKey, type GameModel, type GridPoint, type Level, type MemberType } from './model';
import { memberIssue } from './placementRules';

/** Twelve edges of an axis-aligned rectangular bay. */
export function bayEdges(origin: GridPoint, size: GridPoint): [GridPoint, GridPoint][] {
  const edges: [GridPoint, GridPoint][] = [];
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter((i) => i !== axis);
    for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) {
      const a: GridPoint = [...origin];
      a[other[0]] += size[other[0]] * u;
      a[other[1]] += size[other[1]] * v;
      const b: GridPoint = [...a];
      b[axis] += size[axis];
      edges.push([a, b]);
    }
  }
  return edges;
}

/** Validate the whole bay against a temporary model, including inventory. */
export function bayIssue(level: Level, model: GameModel, origin: GridPoint, size: GridPoint, type: MemberType): string | null {
  if (size.some((v) => !Number.isInteger(v) || v <= 0)) return 'Bay dimensions must be positive integers';
  const draft: GameModel = { ...model, members: [...model.members] };
  for (const [a, b] of bayEdges(origin, size)) {
    const issue = memberIssue(level, draft, a, b, type);
    if (issue) return issue;
    draft.members.push({ id: draft.nextId++, a: nodeKey(...a), b: nodeKey(...b), type });
  }
  return null;
}
