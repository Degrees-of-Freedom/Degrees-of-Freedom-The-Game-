import { KIT_PLAYTEST } from "../game/turns";

/**
 * Shared table copy for the setup and How to play screens. The knowledge base
 * wins over any prototype wording: docs/kb/turn-criteria.md section 1 lists the
 * confirmed rules; setup values the owner has not confirmed are playtest
 * settings (docs/kb/unified-runtime.md, "Shared table playtest").
 */

/** Confirmed rules. */
export const TURN_RULES = [
  "Draw two cards from the element-and-load deck and two from the connection deck.",
  "Play up to one member, one load and two connections, or pass. These limits are independent.",
  "One connection card attaches one member end to a shared joint. A placed connection cannot be changed.",
  "You may load and attach to other players’ structures.",
  "Loads are persistent downward gravity loads.",
  "Each player has only their starting foundation. Foundations are fully fixed and are not cards.",
  "The first connection establishes a joint’s freedoms. Every later end attached there must match. An incompatible card stays in your hand.",
];

/** Values chosen for this local playtest; not confirmed rules. */
export const PLAYTEST_SETTINGS = [
  `${KIT_PLAYTEST.players} players, ${KIT_PLAYTEST.rounds} rounds.`,
  "Each player starts with one foundation and a connected column.",
  "Unplayed cards stay in hand.",
  "Connection cards are fixed or ball.",
  "New matches deal SHS, glulam, IPE and HEB members. Cables remain available in older playtests. Springs, round HSS and truss assemblies are candidate definitions awaiting validation.",
];

/** What the current playtest does not enforce yet, stated next to the rules. */
export const TURN_RULES_NOTES = [
  "At turn end the structure is simulated. The one-point penalty for a new or worsened issue is confirmed but not applied yet.",
];
