import { expect, it } from "vitest";
import { useGameStore } from "./store";
import { toStructuralModel } from "./structuralModel";

const game = useGameStore.getState;

it("places one six-DOF ground foundation and reselects it without another edit", () => {
  game().setMode("creative");
  game().reset();
  expect(game().placeFoundation([2, 2, 0])).toBeNull();
  const support = toStructuralModel(game().model).model.supports.find(s => s.nodeId === "2,2,0");
  expect(support?.restrained).toEqual([true, true, true, true, true, true]);
  const history = game().history;
  expect(game().placeFoundation([2, 2, 0])).toBeNull();
  expect(game().history).toBe(history);
  expect(game().selected).toEqual({ type: "node", key: "2,2,0" });
  game().undo();
  expect(game().model.attrs["2,2,0"]?.found).toBeFalsy();
  game().redo();
  expect(game().model.attrs["2,2,0"].found).toBe(true);
});

it("rejects air, off-board coordinates, and placement through the Shared table", () => {
  game().setMode("creative");
  const before = game().model;
  expect(game().placeFoundation([2, 2, 3])).toContain("solid ground");
  expect(game().placeFoundation([-1, 2, 0])).toContain("Invalid position");
  expect(game().model).toBe(before);
  game().setMode("multiplayer");
  const turn = game().turn!;
  expect(game().placeFoundation([2, 2, 0])).toContain("Creative");
  expect(game().turn).toBe(turn);
  expect(turn.board.joints.filter(j => j.foundationOwner)).toHaveLength(2);
});

it("places a foundation on solid Bridge II terrain within the challenge supply", () => {
  useGameStore.setState({ mode: "challenge" });
  game().setLevel("bridge2");
  game().reset();
  expect(game().placeFoundation([2, 2, 4])).toBeNull();
  expect(game().model.attrs["2,2,4"]?.found).toBe(true);
  expect(toStructuralModel(game().model).model.supports.find(s => s.nodeId === "2,2,4")?.restrained).toEqual([true, true, true, true, true, true]);
  expect(game().placeFoundation([10, 5, 0])).toContain("solid ground");
  game().undo();
  expect(game().model.attrs["2,2,4"]?.found).toBeFalsy();
});

