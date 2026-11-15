import { prepareReleaseSolver } from "./turnAnalysis";
import { endTurn, type TurnState } from "./turns";
import { decodePrivateMatch } from "./releaseSave";

export type MatchJob = { kind: "restore"; bytes: string } | { kind: "end"; turn: TurnState };
self.onmessage = async ({ data }: MessageEvent<MatchJob>) => {
  try {
    await prepareReleaseSolver();
    if (data.kind === "restore") {
      self.postMessage({ ok: true, value: decodePrivateMatch(data.bytes) });
    } else {
      const result = endTurn(data.turn, data.turn.turn);
      if (!result.ok) throw new Error(result.reason);
      self.postMessage({ ok: true, value: result.state });
    }
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : "Assessment unavailable." });
  }
};

