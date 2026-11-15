import { commandFor, createMultiplayerDomain, restoreMultiplayerDomain, type MultiplayerDomain } from "./index";

/** Run from an explicit Restart action. The caller publishes the returned
 * authority only after its new save is durable and detaches the old workers.
 * Use the same single-writer save slot as normal gameplay.
 */
export function restartMultiplayerMatch(
  current: MultiplayerDomain,
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  confirmReplacement: (question: string) => boolean,
): MultiplayerDomain | null {
  const before = current.getSnapshot();
  const saved = storage.getItem(key);
  if (!confirmReplacement("Replace the current save and start a new match? Your progress in this match will be lost.")) {
    return null;
  }

  // A delayed UI callback must never overwrite another match or newer gameplay.
  if (current.getSnapshot().sequence !== before.sequence || storage.getItem(key) !== saved) {
    throw new Error("The match changed. Open Restart again.");
  }
  if (saved !== null) {
    const stored = restoreMultiplayerDomain(saved).getSnapshot();
    if (stored.matchId !== before.matchId || stored.sequence > before.sequence) {
      throw new Error("The save belongs to another match or a newer turn.");
    }
  }

  const config = current.getConfiguration();
  config.matchId = crypto.randomUUID();
  // The deck lists are already versioned card instances. Shuffling the copy
  // produces a fresh deal while retaining the authored composition in each deck.
  for (let i = config.cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [config.cards[i], config.cards[j]] = [config.cards[j], config.cards[i]];
  }
  const next = createMultiplayerDomain(config);
  if (before.interval !== next.getSnapshot().interval) {
    next.dispatch(commandFor(next.getSnapshot(), {type: "interval", interval: before.interval}));
  }
  storage.setItem(key, next.serialize());
  return next;
}
