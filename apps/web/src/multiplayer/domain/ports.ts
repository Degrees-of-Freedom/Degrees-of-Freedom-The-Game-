import type { Port } from "./catalogue";
import type { MatchState } from "./index";
import { position, requireRule } from "./geometry";

const samePort = (a: Port, b: Port) => a.memberId === b.memberId && a.quarter === b.quarter;

/** Inspect the player-authored joint profile and local system constraints.
 * Connection rotations are relative to the attached ports in global XYZ.
 * System safety constraints remain distinct, even if their axis bits coincide.
 */
export function inspectPort(state: MatchState, at: Port) {
  const point = position(state.original, at);
  const member = state.original.spans.find(span => span.id === at.memberId);
  requireRule(member, "Unknown original member");
  const connections = state.original.plays.flatMap(({ play }) =>
    play.kind === "connection" && (samePort(play.from, at) || samePort(play.to, at)) ? [play] : []);
  const corrections = state.corrections.filter(record => samePort(record.at, at));
  return {
    point, memberId: member.id, setup: member.setup, frame: "global" as const,
    // A null profile means this port has no authored attachment.
    originalRotationMask: member.setup ? 7 : connections[0]?.mask ?? null,
    connectedTranslationsCompatible: connections.length > 0,
    connectionCardIds: connections.map(c => c.cardId),
    safetyRotationMask: corrections.reduce((mask, record) => mask | record.rotationMask, 0),
    safetyTranslationMask: corrections.reduce((mask, record) => mask | record.translationMask, 0),
    corrections: structuredClone(corrections),
  };
}
