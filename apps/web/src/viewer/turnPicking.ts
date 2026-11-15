import { nodeKey, type GridPoint } from "../game/model";
import { connectionLocations, originalPorts, systemTarget } from "../game/turnPorts";
import {
  activeTurnHand,
  stageConnection,
  stageLoad,
} from "../game/turns";
import type { useGameStore } from "../game/store";
import { connectionChoices, isReleaseCatalogue, PLAY_REVISION } from "../game/cardCatalogue";
import { placementFromTip } from "../game/cantileverPlacement";
import type { AttachmentSite } from "../game/attachmentSites";

type GameState = ReturnType<typeof useGameStore.getState>;
export type ConnectionTarget = {
  memberId: number;
  end: AttachmentSite;
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
  if (card.kind === "element" && state.chainStart) {
    const placement = placementFromTip(state, position, target);
    return "issue" in placement ? placement.issue : null;
  }
  const transition = card.kind === "load" ? stageLoad(state.turn, card.id, key) : null;
  return transition && !transition.ok ? transition.reason : null;
}

export function turnConnectionTargets(state: GameState): ConnectionTarget[] {
  const card = selectedTurnCard(state);
  if (!state.turn || card?.kind !== "connection") return [];
  const turn = state.turn;
  const profiles = connectionChoices(card);
  const profile = profiles.length === 1 ? profiles[0] : state.selectedConnectionProfile;
  if (isReleaseCatalogue(turn.catalogue) && !profile && turn.rulesRevision !== PLAY_REVISION) return [];
  const members = [...turn.board.members, ...turn.draft.members];
  return members.flatMap((member) =>
    (["a", "b", "q1", "q2", "q3"] as const).flatMap((end) => {
      return connectionLocations(members, member, end).flatMap(key => {
        const available = profile ? [profile] : turn.rulesRevision === PLAY_REVISION ? profiles : [undefined];
        return available.some(choice => stageConnection(turn, card.id, member.id, end, key, choice).ok)
          ? [{ memberId: member.id, end, key }] : [];
      });
    }),
  );
}

export function turnPointPorts(state: GameState) {
  const card = selectedTurnCard(state);
  if (!state.turn || !card || card.kind === "connection") return [];
  const turn = state.turn;
  const members = card.kind === "element" && turn.rulesRevision !== PLAY_REVISION ? turn.board.members : [...turn.board.members, ...turn.draft.members];
  const ports = members.filter(m => !m.system).flatMap(originalPorts).filter(p => !systemTarget(turn, p.id));
  if (card.kind === "element") return ports;
  const active = new Set([...turn.board.connections, ...turn.draft.connections].map(c => c.jointId));
  return ports.filter(port => active.has(port.id));
}
