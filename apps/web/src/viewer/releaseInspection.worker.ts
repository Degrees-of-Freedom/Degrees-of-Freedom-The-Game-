import { analyzeTurn, prepareReleaseSolver } from "../game/turnAnalysis";
import { finalReceipt } from "../game/finalScore";
import type { TurnState } from "../game/turns";

export type InspectionInput = Pick<TurnState, "board" | "catalogue" | "nextId" | "version" | "turn">;
export interface InspectionResponse {
  result: ReturnType<typeof analyzeTurn>;
  receipt: ReturnType<typeof finalReceipt>;
}

/** Inspect the committed configuration. The caller sends no hands, seed or staged plays. */
self.onmessage = async ({ data }: MessageEvent<InspectionInput>) => {
  try {
    await prepareReleaseSolver();
    const state: TurnState = { ...data, seed: 0, playerIndex: 0, finished: false, reports: [], events: [],
      players: [], decks: [[], []], draft: { members: [], connections: [], loads: [] } };
    const result = analyzeTurn(state, "card-gravity");
    self.postMessage({ result, receipt: finalReceipt(state, result) } satisfies InspectionResponse);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Browser analysis unavailable." });
  }
};
