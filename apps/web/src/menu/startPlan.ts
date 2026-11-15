import { environmentExample } from "../game/environmentExamples";
import type { GameMode, PresentationStyle } from "../game/modes";
import type { LevelId } from "../game/model";
import { createGameSave } from "../game/structuralState";
import type { CatalogueId } from "../game/cardCatalogue";

/** Every mode opens in this theme for now; the setup screens have no environment picker. */
export const MENU_STYLE: PresentationStyle = "grow-dusk";

/** What the player picked on a setup screen. */
export type StartChoice =
  | { mode: "creative"; begin: "continue" | "example" | "empty" }
  | { mode: "challenge"; levelId: LevelId; begin: "continue" | "fresh" }
  | { mode: "forensics" | "load-space"; begin: "continue" | "fresh" }
  | { mode: "multiplayer"; begin: "continue" | "new"; catalogue?: CatalogueId };

/** The subset of the game store that Start may call; all are existing actions. */
export interface StartActions {
  setStyle(style: PresentationStyle): void;
  setMode(mode: GameMode, catalogue?: CatalogueId): void;
  setLevel(id: LevelId): void;
  reset(): void;
  newMatch(catalogue?: CatalogueId): string | null;
  importModel(value: unknown): string | null;
}

export type StartStep =
  | { do: "setStyle" }
  | { do: "setMode"; mode: GameMode }
  | { do: "setLevel"; levelId: LevelId }
  | { do: "reset" }
  | { do: "example" }
  | { do: "newMatch" };

/**
 * Ordered store calls for a setup choice.
 *
 * Order matters because of how the store behaves:
 * - `setMode` is a no-op when the mode is already active and otherwise restores
 *   that mode's saved model (or its prepared starting model).
 * - `setLevel` only acts in challenge mode, so it follows `setMode`. Entering
 *   challenge restores the last saved level first; the chosen level is applied after.
 * - `reset` clears the active model (forensics: restores the prepared fixture),
 *   so it follows whatever `setMode`/`setLevel` loaded.
 * - `newMatch` only works on a finished match; the UI offers it only then.
 */
export function planStart(choice: StartChoice): StartStep[] {
  const steps: StartStep[] = [
    { do: "setStyle" },
    { do: "setMode", mode: choice.mode },
  ];
  if (choice.mode === "challenge") {
    steps.push({ do: "setLevel", levelId: choice.levelId });
    if (choice.begin === "fresh") steps.push({ do: "reset" });
  } else if (choice.mode === "creative") {
    if (choice.begin === "example") steps.push({ do: "example" });
    if (choice.begin === "empty") steps.push({ do: "reset" });
  } else if (choice.mode === "multiplayer") {
    if (choice.begin === "new") steps.push({ do: "newMatch" });
  } else if (choice.begin === "fresh") steps.push({ do: "reset" });
  return steps;
}

/** Runs the plan; returns the first error message from the store, or null. */
export function runStart(
  choice: StartChoice,
  actions: StartActions,
): string | null {
  for (const step of planStart(choice)) {
    let error: string | null = null;
    switch (step.do) {
      case "setStyle":
        actions.setStyle(MENU_STYLE);
        break;
      case "setMode":
        if (choice.mode === "multiplayer" && choice.catalogue) actions.setMode(step.mode, choice.catalogue);
        else actions.setMode(step.mode);
        break;
      case "setLevel":
        actions.setLevel(step.levelId);
        break;
      case "reset":
        actions.reset();
        break;
      case "example":
        // Same call the workspace's "Load example" makes in Creative.
        error = actions.importModel(
          createGameSave("environment", environmentExample("tower")),
        );
        break;
      case "newMatch":
        error = choice.mode === "multiplayer" && choice.catalogue ? actions.newMatch(choice.catalogue) : actions.newMatch();
        break;
    }
    if (error) return error;
  }
  return null;
}
