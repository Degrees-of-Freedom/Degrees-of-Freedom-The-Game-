import { KIT_PLAYTEST } from "../game/turns";

/**
 * Shared table copy for the setup and How to play screens. The knowledge base
 * wins over any prototype wording: docs/kb/turn-criteria.md section 1 lists the
 * confirmed turn rules, and docs/kb/game-completion-criteria.md section 2 is
 * the owner's decision register (G01 to G17) for scoring, match format,
 * placement and repair. Setup values the owner has not confirmed are playtest
 * settings (docs/kb/unified-runtime.md, "Shared table playtest").
 */

/** Confirmed turn rules. */
export const TURN_RULES = [
  "Draw two cards from the element-and-load deck and two from the connection deck.",
  "Play up to one member, one load and two connections, or pass. These limits are independent.",
  "One connection card attaches one member end to a shared joint. A placed connection cannot be changed.",
  "You may load and attach to other players’ structures.",
  "Loads are persistent downward gravity loads.",
  "Each player has only their starting foundation. Foundations are fully fixed and are not cards.",
  "All member ends attached to one shared joint use the same connection freedoms.",
  // Completion decisions, docs/kb/game-completion-criteria.md section 2.
  "A match lasts a fixed number of complete rounds. There is no target score.", // G02
  "Scoring happens once, at the end: your foundation’s share of the total load, as a percentage, minus your penalty points. The highest result wins.", // G01, G03
  "A turn that introduces a new or worsened issue costs one point. The move stays, and the point stays lost after a repair.", // turn criteria, G12
  "Instability and overload are repaired automatically with neutral scaffolding or ground anchors. They stay for the match and score for no one.", // G10, G16
  "Members may be left unconnected, but they may not physically clash.", // G08
  "Members attach at their ends or at the quarter points of another member.", // G06
  "Play is local and hot-seat: pass the device, with a private handoff between players.", // G04
];

/** Values chosen for this local playtest; not confirmed rules. */
export const PLAYTEST_SETTINGS = [
  `${KIT_PLAYTEST.players} players, ${KIT_PLAYTEST.rounds} rounds.`,
  "Each player starts with one foundation and a connected column.",
  "Unplayed cards stay in hand.",
  "Connection cards are fixed or ball.",
];

/** What the current playtest does not enforce yet, stated next to the rules. */
export const TURN_RULES_NOTES = [
  "The matching-freedoms rule is confirmed but not yet enforced in this playtest: each member end still takes its own fixed or ball card.",
  "At turn end the structure is simulated. The one-point penalty, the final score, automatic repair, clash checks and quarter-point attachments are confirmed rules that this playtest does not apply yet.",
  "The hand stays hidden until you choose Reveal hand. A full private handoff screen is not built yet.",
];
