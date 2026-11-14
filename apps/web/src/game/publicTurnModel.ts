import type { TurnReport, TurnState } from "./turns";

type Board = TurnState["board"];

interface PublicTurnModel {
  version: number;
  turn: number;
  activePlayerId: string | null;
  finished: boolean;
  board: {
    joints: Pick<Board["joints"][number], "id" | "foundationOwner">[];
    members: Pick<Board["members"][number], "id" | "a" | "b" | "type" | "owner">[];
    loads: Pick<Board["loads"][number], "jointId" | "magnitude" | "owner">[];
    connections: Pick<Board["connections"][number], "memberId" | "end" | "jointId" | "profile" | "owner">[];
  };
  reports: Pick<TurnReport, "turn" | "playerId" | "status" | "penalty">[];
}

/** Project committed, public fields individually so new save fields stay private by default. */
export function publicTurnModel(state: TurnState): PublicTurnModel {
  const { joints, members, loads, connections } = state.board;
  return {
    version: state.version,
    turn: state.turn,
    activePlayerId: state.finished ? null : state.players[state.playerIndex].id,
    finished: state.finished,
    board: {
      joints: joints.map(({ id, foundationOwner }) => ({ id, foundationOwner })),
      members: members.map(({ id, a, b, type, owner }) => ({ id, a, b, type, owner })),
      loads: loads.map(({ jointId, magnitude, owner }) => ({ jointId, magnitude, owner })),
      connections: connections.map(({ memberId, end, jointId, profile, owner }) => ({
        memberId, end, jointId, profile, owner,
      })),
    },
    reports: state.reports.map(({ turn, playerId, status, penalty }) => ({
      turn, playerId, status, penalty,
    })),
  };
}
