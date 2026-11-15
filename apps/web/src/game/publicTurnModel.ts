import type { TurnReport, TurnState } from "./turns";
import type { SystemProvenance } from "./turnRepair";

type Board = TurnState["board"];

interface PublicTurnModel {
  version: number;
  turn: number;
  activePlayerId: string | null;
  finished: boolean;
  board: {
    joints: Pick<Board["joints"][number], "id" | "point" | "foundationOwner" | "system">[];
    members: Pick<Board["members"][number], "id" | "a" | "b" | "type" | "assembly" | "owner" | "system">[];
    loads: Pick<Board["loads"][number], "jointId" | "magnitude" | "owner">[];
    connections: Pick<Board["connections"][number], "memberId" | "end" | "jointId" | "profile" | "owner" | "system">[];
  };
  reports: ReturnType<typeof publicTurnReport>[];
}

function systemIdentity(source?: SystemProvenance) {
  if (!source) return {};
  const { objectId, turn, issueId, policy, definitionVersion } = source;
  return { system: { objectId, turn, issueId, policy, definitionVersion } };
}

/** Publish physical reasons, keeping the match seed, model signatures and saved
 * receipt outside the public view. Historical comparisons can predate scoring.
 */
export function publicTurnReport(report: TurnReport) {
  const { turn, playerId, status, penalty } = report;
  const chargedIds = new Set(report.penaltyDecision?.event?.issueIds);
  const penaltyReasons = (report.issues?.changes ?? [])
    .filter(change => chargedIds.has(change.id))
    .map(({ id, memberId, end, category, change, after }) => ({
      id, memberId, end, category, change, reason: after.reason, utilization: after.utilization,
    }));
  return { turn, playerId, status, penalty, penaltyReasons };
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
      joints: joints.map(({ id, point, foundationOwner, system }) => ({ id, ...(point && { point }), foundationOwner, ...systemIdentity(system) })),
      members: members.map(({ id, a, b, type, assembly, owner, system }) => ({ id, a, b, type, owner, ...(assembly && { assembly }), ...systemIdentity(system) })),
      loads: loads.map(({ jointId, magnitude, owner }) => ({ jointId, magnitude, owner })),
      connections: connections.map(({ memberId, end, jointId, profile, owner, system }) => ({
        memberId, end, jointId, profile, owner, ...systemIdentity(system),
      })),
    },
    reports: state.reports.map(publicTurnReport),
  };
}
