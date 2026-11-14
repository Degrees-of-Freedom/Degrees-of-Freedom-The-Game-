import { nodeKey, type GridPoint } from '../game/model';
import { activeTurnHand, stageConnection, stageElement, stageLoad } from '../game/turns';
import type { useGameStore } from '../game/store';

type GameState = ReturnType<typeof useGameStore.getState>;
export type ConnectionTarget = { memberId: number; end: 'a' | 'b'; key: string };

export function selectedTurnCard(state: GameState) {
  if (state.mode !== 'multiplayer' || !state.turn) return undefined;
  return activeTurnHand(state.turn).find(({ id }) => id === state.selectedCardId);
}

export function turnPointIssue(state: GameState, position: GridPoint) {
  const card = selectedTurnCard(state);
  if (!state.turn || !card || card.kind === 'connection') return 'Choose a card from the active hand.';
  const key = nodeKey(...position);
  const transition = card.kind === 'load'
    ? stageLoad(state.turn, card.id, key)
    : state.chainStart
      ? stageElement(state.turn, card.id, state.chainStart, key)
      : null;
  return transition && !transition.ok ? transition.reason : null;
}

export function turnConnectionTargets(state: GameState): ConnectionTarget[] {
  const card = selectedTurnCard(state);
  if (!state.turn || card?.kind !== 'connection') return [];
  const turn = state.turn;
  return state.model.members.flatMap((member) =>
    (['a', 'b'] as const).flatMap((end) => {
      const transition = stageConnection(turn, card.id, member.id, end, member[end]);
      return transition.ok ? [{ memberId: member.id, end, key: member[end] }] : [];
    }),
  );
}
