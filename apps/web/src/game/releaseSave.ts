import { z } from "zod";
import { RELEASE_CATALOGUE } from "./cardCatalogue";
import { SCORE_POLICY } from "./finalScore";
import { RELEASE_SOLVER } from "../solver/voxelVerification";
import { matchesIssueEvidence } from "./turnIssues";
import { replayTurnState, type TurnState } from "./turns";

export const MAX_PRIVATE_BYTES = 8 * 1024 * 1024;
export type MatchPhase = "planning" | "assessing" | "final";
const id = z.string().uuid();
const header = z.strictObject({
  format: z.literal("grow-dusk-private"),
  version: z.literal(1),
  rules: z.literal(RELEASE_CATALOGUE),
  catalogue: z.literal(RELEASE_CATALOGUE),
  scoring: z.literal(SCORE_POLICY),
  penalty: z.literal("issue-penalty-1"),
  solver: z.literal(RELEASE_SOLVER),
  matchId: id, commitId: id, parentId: id.nullable(),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  phase: z.enum(["planning", "assessing", "final"]),
  turn: z.unknown(),
});
export type MatchRecord = Omit<z.infer<typeof header>, "turn"> & {turn: TurnState};

export function matchRecord(turn: TurnState, parent: MatchRecord | null, phase: MatchPhase, matchId = parent?.matchId ?? crypto.randomUUID()): MatchRecord {
  return {
    format: "grow-dusk-private", version: 1, rules: RELEASE_CATALOGUE, catalogue: RELEASE_CATALOGUE,
    scoring: SCORE_POLICY, penalty: "issue-penalty-1", solver: RELEASE_SOLVER,
    matchId, commitId: crypto.randomUUID(), parentId: parent?.commitId ?? null,
    revision: (parent?.revision ?? 0) + 1, phase, turn,
  };
}

/** Validate the redundant materialized state against its versioned deterministic replay.
 * This catches altered draws, support ownership, draft topology or historical receipts. */
export function decodePrivateMatch(bytes: string): MatchRecord {
  if (bytes.length > MAX_PRIVATE_BYTES || new TextEncoder().encode(bytes).length > MAX_PRIVATE_BYTES)
    throw new Error("Private match files are limited to 8 MiB.");
  const raw = JSON.parse(bytes);
  if (raw?.format !== "grow-dusk-private" || raw.version !== 1)
    throw new Error("Unsupported save format. Keep the original file for its matching game version.");
  const result = header.safeParse(raw);
  if (!result.success || raw.turn?.catalogue !== RELEASE_CATALOGUE || (raw.revision === 1) !== (raw.parentId === null))
    throw new Error("Unsupported rules, solver version or revision history.");
  const replay = replayTurnState(result.data.turn);
  if (!replay.ok) throw new Error(replay.reason);
  if ((raw.phase === "final") !== replay.state.finished || !matchesIssueEvidence(raw.turn, replay.state))
    throw new Error("The saved board, cards or receipts disagree with the recorded actions.");
  return { ...result.data, turn: replay.state };
}
