/** Gameplay contexts share the same structural model. */
export type GameMode =
  | "challenge"
  | "creative"
  | "multiplayer"
  | "forensics"
  | "load-space";
/** Presentation selection does not change the structural model. */
export type PresentationStyle =
  | "engineering"
  | "grow"
  | "grow-dusk"
  | "levels"
  | "blocks"
  | "kit";

import { initialModel } from "./layout";
import { environmentExample } from "./environmentExamples";
import { LEVELS } from "./levels";
import type { GameModel, LevelId } from "./model";
import type { StructureEvaluation } from "../evaluator/results";

/** Starting layouts are experiments, not verified engineering exercises. */
export function modeSetup(mode: GameMode): {
  levelId: LevelId;
  model: GameModel;
} {
  const levelId: LevelId =
    mode === "load-space"
      ? "pickup1"
      : mode === "challenge"
        ? "tower1"
        : "environment";
  if (mode === "forensics") {
    // The isolated member is a visible connectivity fault. A rigid joint at
    // each end lets a new member connect it to the supported column.
    const model: GameModel = {
      members: [
        { id: 1, a: "4,4,0", b: "4,4,3", type: "shs" },
        { id: 2, a: "2,4,3", b: "2,4,4", type: "shs" },
      ],
      attrs: {
        "4,4,0": { found: true, joint: true },
        "4,4,3": { joint: true },
        "2,4,3": { joint: true },
        "2,4,4": { joint: true },
      },
      nextId: 3,
    };
    return { levelId, model };
  }
  return {
    levelId,
    model:
      mode === "creative"
        ? environmentExample("tower")
        : initialModel(LEVELS[levelId]),
  };
}

/** Interpret only available prototype results; never treat an error as success. */
export function modeProgress(
  mode: GameMode,
  analysis: StructureEvaluation,
): "complete" | "incomplete" | "unavailable" {
  if (mode !== "forensics" && mode !== "load-space" && mode !== "challenge")
    return "unavailable";
  if (analysis.error || analysis.unresolved) return "unavailable";
  if (mode === "forensics")
    return !analysis.mechanism && analysis.floating.length === 0
      ? "complete"
      : "incomplete";
  return analysis.success ? "complete" : "incomplete";
}

/** A saved repair exercise must retain the starting pieces and their restraints. */
export function hasForensicsFixture(model: GameModel): boolean {
  const fixture = modeSetup("forensics").model;
  return (
    fixture.members.every((member) =>
      model.members.some(
        (m) =>
          m.id === member.id &&
          m.a === member.a &&
          m.b === member.b &&
          m.type === member.type,
      ),
    ) &&
    Object.entries(fixture.attrs).every(([key, attrs]) => {
      const actual = model.attrs[key];
      return (
        !!actual && actual.found === attrs.found && actual.joint === attrs.joint
      );
    })
  );
}
