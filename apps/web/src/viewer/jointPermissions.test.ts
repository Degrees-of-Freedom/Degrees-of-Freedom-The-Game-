import { describe, expect, it } from "vitest";
import { createTurnGame, endTurn, parseTurnState, stageConnection, stageElement } from "../game/turns";
import { editorJointPermissions, jointAtSceneSelection, sharedJointPermissions } from "./jointPermissions";
import type { ConnectionProfile } from "../game/jointFreedom";
import type { TurnState } from "../game/turns";

function withProfiles(...profiles: ConnectionProfile[]) {
  const board = createTurnGame(1).board;
  const ground = board.connections[0];
  board.connections = profiles.map((profile, index) => ({ ...ground, memberId: index + 1, profile }));
  return sharedJointPermissions(board)[0];
}

describe("intentional joint permissions", () => {
  it("separates ground and end permissions, including inactive cable rotations", () => {
    const ball = withProfiles("ball", "ball");
    expect(ball.ground).toEqual(["locked","locked","locked","locked","locked","locked"]);
    expect(ball.components).toEqual(["locked","locked","locked","free","free","free"]);
    expect(ball.attachments).toHaveLength(2);
    const [base] = editorJointPermissions({ nextId: 2, members: [{ id: 1, a: "0,0,0", b: "1,0,1", type: "cable" }],
      attrs: { "0,0,0": { found: true, restraint: [false,true,true,false,false,false] } } });
    expect(base.ground).toEqual(["free","locked","locked","free","free","free"]);
    expect(base.components.slice(3)).toEqual(["inactive","inactive","inactive"]);
  });

  it("preserves physical directions, stiffness differences and legacy disagreement", () => {
    const hinge = withProfiles("hinge-diagonal");
    expect(hinge.global?.slice(3)).toEqual(["coupled","coupled","locked"]);
    expect(hinge.components.slice(3)).toEqual(["free","locked","locked"]);
    expect(hinge.frame![0]).toEqual([Math.SQRT1_2,Math.SQRT1_2,0]);
    expect(withProfiles("guided-x").global?.slice(0,3)).toEqual(["free","locked","locked"]);
    const seats = withProfiles("seat-20","seat-80");
    expect(seats.profile).toContain("stiffness varies");
    expect(seats.global![2]).toBe("elastic");
    expect(seats.attachments.join(" ")).toMatch(/20 MN\/m.*80 MN\/m/);
    expect(withProfiles("fixed","ball").components).toEqual(Array(6).fill("conflict"));
  });

  it("excludes loose ends and inactive ports, then shows the original port after commit and replay", () => {
    let state = createTurnGame(5);
    function accept(move: ReturnType<typeof stageElement>) { if (!move.ok) throw Error(move.reason); state = move.state; }
    accept(stageElement(state,"element-7","port:1:1","port:2:1"));
    expect(sharedJointPermissions(state.board)).toHaveLength(4);
    accept(stageConnection(state,"connection-6",3,"a"));
    accept(endTurn(state));
    const replay = parseTurnState(state) as TurnState;
    const joints = sharedJointPermissions(replay.board);
    expect(joints).toEqual(sharedJointPermissions(state.board));
    expect(joints.find(j => j.id === "port:1:1")).toMatchObject({ point: "1,3,0.25", parent: expect.stringContaining("25%") });
    expect(joints.some(j => j.id === "port:2:1")).toBe(false);
    expect(jointAtSceneSelection(joints, "1,3,0.25", state)?.id).toBe("port:1:1");
    state.board.joints.push({ id: "different-fitting", point: "1,3,0.25" });
    expect(jointAtSceneSelection(sharedJointPermissions(state.board), "1,3,0.25", state)).toBeUndefined();
    expect(sharedJointPermissions(state.board).find(j => j.id === "different-fitting")?.components)
      .toEqual(Array(6).fill("unavailable"));
    state.board.members.push({ ...state.board.members[2], id: 17, a: "1,3,0" });
    expect(jointAtSceneSelection(joints, "1,3,0", state)).toBeUndefined();
  });
});
