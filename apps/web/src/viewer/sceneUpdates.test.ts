import { describe, expect, it } from "vitest";
import { useGameStore } from "../game/store";
import { sceneUpdateKind } from "./sceneUpdates";

describe("scene invalidation", () => {
  it("keeps meshes and label textures while selecting/cancelling a card, but refreshes targeting", () => {
    const previous = useGameStore.getState();
    const selected = {...previous, selectedCardId: "held-card"};
    expect(sceneUpdateKind(selected, previous)).toBe("guides");
    expect(sceneUpdateKind({...selected, selectedCardId: null}, selected)).toBe("guides");
    expect(sceneUpdateKind({...selected, chainStart: "1,2,3"}, selected)).toBe("guides");
    expect(sceneUpdateKind({...selected, selectedConnectionProfile: "ball"}, selected)).toBe("guides");
  });
  it("invalidates geometry and highlights for physical edits, inspected selection and handoffs", () => {
    const previous = useGameStore.getState();
    expect(sceneUpdateKind({...previous, model: {...previous.model}}, previous)).toBe("structure");
    expect(sceneUpdateKind({...previous, selected: {type:"member", id:3}}, previous)).toBe("structure");
    expect(sceneUpdateKind({...previous, mode: previous.mode === "multiplayer" ? "creative" : "multiplayer"}, previous)).toBe("structure");
    expect(sceneUpdateKind({...previous, workK: previous.workK + 1}, previous)).toBe("structure");
  });
  it("does no geometry work for save and solver-status acknowledgements", () => {
    const previous = useGameStore.getState();
    const writing = {...previous, sessionSave:"writing" as const, turnAnalysing:true};
    expect(sceneUpdateKind(writing, previous)).toBe("none");
  });
});
