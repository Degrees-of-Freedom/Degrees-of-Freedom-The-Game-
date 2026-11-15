import type { useGameStore } from "../game/store";
import type { TurnCard } from "../game/turns";
import { ReleaseTargets } from "./ReleaseTargets";

type Game = ReturnType<typeof useGameStore.getState>;

/** Secondary Shared table presets share the release board's exact targeting rules. */
export function TurnQuarterTargets({ game, card, onMessage }: {
  game: Game; card: TurnCard; onMessage: (message: string) => void;
}) {
  if (!game.turn || card.kind === "connection") return null;
  return <ReleaseTargets game={game} card={card} notify={onMessage} />;
}
