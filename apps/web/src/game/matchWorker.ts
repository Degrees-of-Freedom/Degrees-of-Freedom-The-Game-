import { prepareReleaseSolver } from "./turnAnalysis";
import { checkpointDueForTurn, endTurn, type TurnState } from "./turns";
import { decodePrivateMatch } from "./releaseSave";

export type MatchJob = { kind: "restore"; bytes: string } | { kind: "end"; turn: TurnState };
self.onmessage = async ({ data }: MessageEvent<MatchJob>) => {
  try {
    // Intermediate turns validate and persist the pending window without
    // loading a numerical module. Restore still prepares for full replay.
    if (data.kind === "restore" || !data.turn.rulesRevision || checkpointDueForTurn(data.turn))
      await prepareReleaseSolver();
  } catch {
    self.postMessage({ok:false, kind:"unavailable", message:"The browser solver could not load. Retry to reopen the saved match."});
    return;
  }
  try {
    if (data.kind === "restore") {
      self.postMessage({ ok: true, value: decodePrivateMatch(data.bytes) });
    } else {
      const result = endTurn(data.turn, data.turn.turn);
      if (!result.ok) throw new Error(result.reason);
      self.postMessage({ ok: true, value: result.state });
    }
  } catch (error) {
    self.postMessage({ ok: false, kind: data.kind === "restore" ? "invalid" : "unavailable",
      message: error instanceof Error ? error.message : "Assessment unavailable." });
  }
};
