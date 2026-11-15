import type { TurnReport, TurnState } from "../game/turns";
import type { CompanionCue } from "./motion";

/** What the board last showed for a match, by public identity only. */
export interface TurnSighting {
  readonly match: string;
  readonly turn: number;
  readonly reports: number;
}

export function sightTurn(turn: Pick<TurnState, "catalogue" | "seed" | "turn" | "reports">): TurnSighting {
  return { match: `${turn.catalogue}/${turn.seed}`, turn: turn.turn, reports: turn.reports.length };
}

/**
 * Reaction to a newly committed public report, following the avatar criteria:
 * a deduction earns concern, a verified stable turn a small cheer, and
 * anything else (partial, unresolved, or a persistent issue without a new
 * deduction) only the next seat's perk: unknown is never celebrated as stable.
 */
export function reportCue(report: Pick<TurnReport, "status" | "penalty">): CompanionCue {
  if (report.penalty) return { kind: "issue" };
  return report.status === "stable" ? { kind: "clean-turn" } : { kind: "turn-start" };
}

/**
 * Cue for a board (re)mount or turn change. `before` is the previous sighting
 * from this page session, or null after a reload or for a new match: then only
 * the routine perk plays, so an old committed result is never reenacted.
 * Finished matches are left to the victory reaction.
 */
export function turnTransitionCue(before: TurnSighting | null,
  turn: Pick<TurnState, "catalogue" | "seed" | "turn" | "reports" | "finished">): CompanionCue | null {
  if (turn.finished) return null;
  const now = sightTurn(turn);
  const known = before?.match === now.match ? before : null;
  const latest = turn.reports.at(-1);
  if (known && now.reports > known.reports && latest) return reportCue(latest);
  if (!known || now.turn !== known.turn) return { kind: "turn-start" };
  return null;
}
