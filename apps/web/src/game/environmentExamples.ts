import { nodeKey, type GameModel, type GridPoint } from "./model";

/** Geometry from ftroshani's shared tower/portal examples, in the game's grid.
 * Continuous prototype columns are explicitly segmented at the shared floor
 * joints so the existing solver sees the same topology as the renderer.
 */
export function environmentExample(kind: "tower" | "portal"): GameModel {
  const model: GameModel = { members: [], attrs: {}, nextId: 1 };
  function member(a: GridPoint, b: GridPoint) {
    const ak = nodeKey(...a),
      bk = nodeKey(...b);
    model.members.push({ id: model.nextId++, a: ak, b: bk, type: "shs" });
    for (const point of [a, b]) {
      const key = nodeKey(...point);
      model.attrs[key] = {
        ...model.attrs[key],
        joint: true,
        ...(point[2] === 0
          ? {
              found: true,
              restraint: [true, true, true, false, false, false] as [
                boolean,
                boolean,
                boolean,
                boolean,
                boolean,
                boolean,
              ],
            }
          : {}),
      };
    }
  }
  if (kind === "portal") {
    member([3, 4, 0], [3, 4, 3]);
    member([6, 4, 0], [6, 4, 3]);
    member([3, 4, 3], [4, 4, 3]);
    member([4, 4, 3], [6, 4, 3]);
    model.attrs["4,4,3"].load = 10;
    model.attrs["3,4,3"].load = 5;
    model.attrs["3,4,3"].loadDirection = "+X";
    return model;
  }
  const corners = [
    [3, 3],
    [5, 3],
    [5, 5],
    [3, 5],
  ];
  for (const [i, j] of corners) {
    member([i, j, 0], [i, j, 2]);
    member([i, j, 2], [i, j, 4]);
  }
  for (const k of [2, 4])
    corners.forEach(([i, j], index) => {
      const [x, y] = corners[(index + 1) % corners.length];
      member([i, j, k], [x, y, k]);
    });
  member([3, 3, 0], [5, 3, 2]);
  member([5, 3, 0], [5, 5, 2]);
  member([5, 5, 2], [3, 5, 4]);
  member([3, 5, 2], [3, 3, 4]);
  member([5, 3, 4], [7, 3, 4]);
  member([5, 3, 2], [7, 3, 4]);
  model.attrs["7,3,4"] = { load: 20 };
  model.attrs["3,5,4"].load = 10;
  model.attrs["3,5,4"].loadDirection = "+X";
  model.attrs["3,3,0"].restraint = [true, true, true, true, true, true];
  return model;
}
