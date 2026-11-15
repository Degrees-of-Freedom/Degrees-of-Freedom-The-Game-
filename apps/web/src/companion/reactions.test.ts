import { describe, expect, it } from "vitest";
import { checkpointNotice, mistakeCount, takeForemanCue } from "./reactions";

describe("public companion events", () => {
  it("counts each charged turn once for its own player, including restored history", () => {
    const charge = (turn: number, playerId: string) => ({
      turn, playerId, charge: { id: [turn, playerId].join("/"), unstableMemberId: 3 },
    });
    const [a,b,c,d,e] = [charge(1, "player-1"), charge(2, "player-2"), charge(3, "player-1"),
      charge(4, "player-2"), charge(5, "player-1")];
    const reports = [a, a, b, c, d, e];
    expect(mistakeCount(reports, c)).toBe(2);
    expect(mistakeCount(reports, d)).toBe(2);
    expect(mistakeCount(JSON.parse(JSON.stringify(reports)), e)).toBe(3);
    expect(mistakeCount(reports, { ...e, charge: undefined })).toBe(0);
  });
  it("reserves the introduction for the third and sixth charge outside the cooldown", () => {
    const now = Date.now();
    expect(takeForemanCue(0, now)).toBe(false);
    expect(takeForemanCue(1, now)).toBe(false);
    expect(takeForemanCue(2, now)).toBe(false);
    expect(takeForemanCue(3, now)).toBe(true);
    expect(takeForemanCue(3, now + 1000)).toBe(false);
    expect(takeForemanCue(6, now + 44_999)).toBe(false);
    expect(takeForemanCue(6, now + 45_000)).toBe(true);
  });
  it("retains the original player and turn when a later checkpoint settles both seats", () => {
    const reports = Array.from({length:6}, (_, i) => {
      const turn = i + 1, playerId = turn % 2 ? "player-1" : "player-2";
      // Player 2 passed on turn 2. Its ordinary turn-6 complaint follows
      // Player 1's third qualifying mistake in the same assessment batch.
      return {turn, playerId, charge:turn === 2 ? undefined : {id:`${turn}/${playerId}`, unstableMemberId:i+3}};
    });
    expect(checkpointNotice(reports, 4)).toBe(reports[4]);
    expect(checkpointNotice(reports, 6)).toBe(reports[5]);
    expect(checkpointNotice(reports, 7)).toBeUndefined();
  });
});
