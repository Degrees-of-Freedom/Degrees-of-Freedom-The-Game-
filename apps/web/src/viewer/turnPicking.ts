import { nodeKey, type GridPoint } from "../game/model";
import { connectionLocations, originalPorts, systemTarget } from "../game/turnPorts";
import {
  activeTurnHand,
  stageConnection,
  stageElement,
  stageLoad,
} from "../game/turns";
import type { useGameStore } from "../game/store";

type GameState = ReturnType<typeof useGameStore.getState>;
export type ConnectionTarget = {
  memberId: number;
  end: "a" | "b";
  key: string;
};

export function selectedTurnCard(state: GameState) {
  if (state.mode !== "multiplayer" || !state.turn) return undefined;
  return activeTurnHand(state.turn).find(
    ({ id }) => id === state.selectedCardId,
  );
}

export function turnPointIssue(state: GameState, position: GridPoint, target?: string) {
  const card = selectedTurnCard(state);
  if (!state.turn || !card || card.kind === "connection")
    return "Choose a card from the active hand.";
  const key = target ?? nodeKey(...position);
  const transition =
    card.kind === "load"
      ? stageLoad(state.turn, card.id, key)
      : state.chainStart
        ? stageElement(state.turn, card.id, state.chainStart, key)
        : null;
  return transition && !transition.ok ? transition.reason : null;
}

export function turnConnectionTargets(state: GameState): ConnectionTarget[] {
  const card = selectedTurnCard(state);
  if (!state.turn || card?.kind !== "connection") return [];
  const turn = state.turn;
  const members = [...turn.board.members, ...turn.draft.members];
  return members.flatMap((member) =>
    (["a", "b"] as const).flatMap((end) => {
      return connectionLocations(members, member, end).flatMap(key => {
        const transition = stageConnection(turn, card.id, member.id, end, key);
        return transition.ok ? [{ memberId: member.id, end, key }] : [];
      });
    }),
  );
}

export function turnPointPorts(state: GameState) {
  const card = selectedTurnCard(state);
  if (!state.turn || !card || card.kind === "connection") return [];
  const turn = state.turn;
  const members = card.kind === "element" ? turn.board.members : [...turn.board.members, ...turn.draft.members];
  const ports = members.filter(m => !m.system).flatMap(originalPorts).filter(p => !systemTarget(turn, p.id));
  if (card.kind === "element") return ports;
  const active = new Set([...turn.board.connections, ...turn.draft.connections].map(c => c.jointId));
  return ports.filter(port => active.has(port.id));
}
