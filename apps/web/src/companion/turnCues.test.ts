import { describe, expect, it } from "vitest";
import { reportCue, sightTurn, turnTransitionCue } from "./turnCues";
import type { TurnReport } from "../game/turns";

const report = (status: TurnReport["status"], penalty: 0 | -1 = 0) =>
  ({ turn: 1, playerId: "player-1", status, reason: "", penalty }) as TurnReport;
const state = (turn: number, reports: TurnReport[], extra: { seed?: number; finished?: boolean } = {}) =>
  ({ catalogue: "grow-dusk-release-1", seed: extra.seed ?? 7, turn, reports, finished: extra.finished ?? false }) as never;

describe("committed report reactions", () => {
  it("shows concern only for a recorded deduction", () => {
    expect(reportCue(report("unstable", -1))).toEqual({ kind: "issue" });
    expect(reportCue(report("stable", -1))).toEqual({ kind: "issue" });
  });
  it("cheers only a verified stable turn", () => {
    expect(reportCue(report("stable"))).toEqual({ kind: "clean-turn" });
  });
  it("never celebrates unknown or persistent issues", () => {
    for (const status of ["partial", "unresolved", "unstable"] as const)
      expect(reportCue(report(status))).toEqual({ kind: "turn-start" });
  });
});

describe("turn transitions", () => {
  it("perks once on first sight without reenacting an old result", () => {
    expect(turnTransitionCue(null, state(3, [report("stable", -1)]))).toEqual({ kind: "turn-start" });
  });
  it("reacts to a report committed during this session", () => {
    const before = sightTurn(state(1, []));
    expect(turnTransitionCue(before, state(2, [report("stable", -1)]))).toEqual({ kind: "issue" });
    expect(turnTransitionCue(before, state(2, [report("stable")]))).toEqual({ kind: "clean-turn" });
  });
  it("stays quiet on a remount of the same turn", () => {
    const now = state(2, [report("stable")]);
    expect(turnTransitionCue(sightTurn(now), now)).toBeNull();
  });
  it("treats a different match as a first sighting", () => {
    const before = sightTurn(state(1, [], { seed: 1 }));
    expect(turnTransitionCue(before, state(2, [report("stable", -1)], { seed: 2 }))).toEqual({ kind: "turn-start" });
  });
  it("leaves a finished match to the victory reaction", () => {
    expect(turnTransitionCue(null, state(16, [report("stable")], { finished: true }))).toBeNull();
  });
});
