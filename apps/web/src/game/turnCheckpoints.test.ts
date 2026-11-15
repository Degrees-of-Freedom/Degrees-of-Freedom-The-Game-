import {readFile} from "node:fs/promises";
import {beforeAll, expect, it, vi} from "vitest";
import {createReleaseGame, chooseTurnDraw, activeTurnHand, stageElement, endTurn, parseTurnState,
  changeCheckpointInterval, checkpointDueForTurn, nextAnalysisInTurns, type TurnState} from "./turns";
import * as analysis from "./turnAnalysis";
import {createTurnCheckpoints, queueTurnCheckpoint, resolveTurnCheckpoint, turnCheckpointFreshness} from "./turnCheckpoints";

beforeAll(() => analysis.prepareReleaseSolver(() => readFile(new URL("../solver/wasm/dof_solver.wasm",import.meta.url))));
function accept(move: ReturnType<typeof endTurn>) {
  if (!move.ok) throw new Error(move.reason);
  return move.state;
}
function drawFour(state: TurnState) {
  for (const source of ["members","connections","connections","loads"] as const)
    state = accept(chooseTurnDraw(state,source));
  return state;
}

it("counts completed player turns, persists genuine pending windows and attributes the original actor at turn three", () => {
  const spy = vi.spyOn(analysis,"analyzeTurn");
  let state = drawFour(createReleaseGame(0));
  const beam = activeTurnHand(state).find(card => card.kind === "element")!;
  state = accept(stageElement(state,beam.id,"2,2,1","2,3,1"));
  expect(nextAnalysisInTurns(state)).toBe(3);
  expect(checkpointDueForTurn(state)).toBe(false);
  spy.mockClear();
  state = accept(endTurn(state));
  expect(spy).not.toHaveBeenCalled();
  expect(state.reports[0]).toMatchObject({status:"pending",penalty:0,playerId:"player-1"});
  expect(state.checkpoints!.pending.map(origin => origin.turn)).toEqual([1]);
  expect(nextAnalysisInTurns(state)).toBe(2);
  state = parseTurnState(JSON.parse(JSON.stringify(state)))!;
  expect(state).not.toBeNull();
  expect(spy).not.toHaveBeenCalled();
  state = accept(endTurn(drawFour(state)));
  expect(spy).not.toHaveBeenCalled();
  expect(nextAnalysisInTurns(state)).toBe(1);
  expect(checkpointDueForTurn(state)).toBe(true);
  state = accept(endTurn(drawFour(state)));
  expect(spy).toHaveBeenCalled();
  expect(state.reports.map(report => report.penalty)).toEqual([-1,0,0]);
  expect(state.reports[0].penaltyDecision!.event!.playerId).toBe("player-1");
  expect(state.reports[0].penaltyDecision!.event!.turn).toBe(1);
  expect(state.reports.some(report => report.status === "pending")).toBe(false);
  expect(state.board.members).toHaveLength(3);
  expect(state.checkpoints!.lastAttemptTurn).toBe(3);
  expect(state.checkpoints!.pending).toEqual([]);
  expect(state.checkpoints!.receipts[0].attributedTurns).toEqual([1,2,3]);
  expect(state.checkpoints!.receipts[0].penaltyIds).toHaveLength(1);
  expect(resolveTurnCheckpoint(state,state.checkpoints!).checkpoints).toBe(state.checkpoints);
  expect(endTurn(state,3)).toMatchObject({ok:false});
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const forged = JSON.parse(JSON.stringify(state));
  forged.events.find((event:{kind:string;checkpoint?:unknown}) => event.kind === "end" && event.checkpoint).checkpoint.penaltyIds = [];
  expect(parseTurnState(forged)).toBeNull();
  spy.mockRestore();
});

it("records interval changes without solving and applies a shorter interval at the next completed turn", () => {
  const spy = vi.spyOn(analysis,"analyzeTurn");
  let state = accept(endTurn(drawFour(createReleaseGame(3))));
  spy.mockClear();
  state = accept(changeCheckpointInterval(state,1));
  expect(spy).not.toHaveBeenCalled();
  expect(state.checkpoints!.pending).toHaveLength(1);
  expect(state.checkpoints!.lastAttemptTurn).toBe(0);
  expect(state.events.at(-1)).toEqual({kind:"interval",interval:1});
  expect(checkpointDueForTurn(state)).toBe(true);
  state = accept(endTurn(drawFour(state)));
  expect(state.checkpoints!.receipts[0]).toMatchObject({throughTurn:2,interval:1,settingVersion:1,attributedTurns:[1,2]});
  expect(state.checkpoints!.lastVerifiedTurn).toBe(2);
  expect(turnCheckpointFreshness(state.checkpoints!).state).toBe("current");
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  expect(changeCheckpointInterval(state,0)).toMatchObject({ok:false});
  expect(changeCheckpointInterval(state,13)).toMatchObject({ok:false});
  spy.mockRestore();
});

it("keeps settings choices during a provisional placement replayable", () => {
  let state = drawFour(createReleaseGame(0));
  const beam = activeTurnHand(state).find(card => card.kind === "element")!;
  state = accept(stageElement(state,beam.id,"2,2,1","2,3,1"));
  state = accept(changeCheckpointInterval(state,2));
  state = accept(endTurn(state));
  expect(state.reports[0].status).toBe("pending");
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
});

it("forces one final checkpoint for the sixteenth pass and preserves last compatible analysis identity", () => {
  let state = createReleaseGame(11);
  for (let turn=1;turn<=16;turn++) {
    const before = state.checkpoints!.lastAnalysis;
    state = accept(endTurn(drawFour(state)));
    if (turn % 3 && turn !== 16) {
      expect(state.checkpoints!.lastAnalysis).toEqual(before);
      expect(turnCheckpointFreshness(state.checkpoints!).state).toBe(before ? "stale" : "none");
    }
  }
  expect(state.finished).toBe(true);
  expect(state.checkpoints!.receipts.map(receipt => receipt.throughTurn)).toEqual([3,6,9,12,15,16]);
  expect(state.checkpoints!.receipts.at(-1)).toMatchObject({final:true,attributedTurns:[16]});
  expect(state.checkpoints!.pending).toEqual([]);
  expect(state.checkpoints!.lastAnalysis!.board).toEqual(state.board);
  expect(state.checkpoints!.lastAnalysis!.modelId).toBeTruthy();
  expect(state.checkpoints!.lastVerifiedTurn).toBe(16);
  expect(state.reports).toHaveLength(16);
  expect(state.reports.every(report => report.status === "stable" && report.penalty === 0)).toBe(true);
  expect(state.finalScore!.winners).toHaveLength(2);
  expect(nextAnalysisInTurns(state)).toBe(0);
  expect(parseTurnState(JSON.parse(JSON.stringify(state)))).toEqual(state);
});

it("carries an earlier origin's separate node fitting into later origins and the next checkpoint", () => {
  const opening = createReleaseGame(0);
  let state: TurnState = {...opening,nextId:5,board:{...opening.board,
    members:[...opening.board.members,{id:3,type:"heb",owner:"player-1",a:"5,7,1",b:"6,7,1"}],
    joints:[...opening.board.joints,{id:"6,7,1"}],connections:[...opening.board.connections,
      {memberId:3,end:"a",jointId:"5,7,1",profile:"fixed",owner:"player-1"},
      {memberId:3,end:"b",jointId:"6,7,1",profile:"lock-x",owner:"player-1"}]},
    draft:{members:[{id:4,type:"heb",owner:"player-1",a:"6,7,1",b:"6,8,1"}],
      connections:[{memberId:4,end:"a",jointId:"6,7,1",profile:"lock-x",owner:"player-1"}],
      loads:[{cardId:"fixture",jointId:"endpoint:4:b",magnitude:5,owner:"player-1"}]}};
  const originals = JSON.stringify(state.board.connections);
  const after = {...state.board,members:[...state.board.members,...state.draft.members],
    connections:[...state.board.connections,...state.draft.connections],loads:state.draft.loads};
  let checkpoints = createTurnCheckpoints();
  for (let turn=1;turn<=3;turn++) {
    state = {...state,turn,playerIndex:(turn-1)%2};
    const queued = queueTurnCheckpoint(state,after,checkpoints);
    checkpoints = queued.checkpoints;
    state = {...state,board:after,draft:{members:[],connections:[],loads:[]},reports:[...state.reports,queued.report]};
  }
  const resolved = resolveTurnCheckpoint(state,checkpoints);
  expect(resolved.reports.map(report => report.penalty)).toEqual([-1,0,0]);
  expect(resolved.board.jointCorrections).toHaveLength(1);
  expect(resolved.board.members).toEqual(after.members);
  expect(JSON.stringify(resolved.board.connections.slice(0,-1))).toBe(originals);
  expect(resolved.checkpoints.lastVerifiedTurn).toBe(3);
  state = {...state,board:resolved.board,reports:resolved.reports};
  checkpoints = resolved.checkpoints;
  for (let turn=4;turn<=6;turn++) {
    state = {...state,turn,playerIndex:(turn-1)%2};
    const queued = queueTurnCheckpoint(state,state.board,checkpoints);
    checkpoints = queued.checkpoints;
    state = {...state,reports:[...state.reports,queued.report]};
  }
  const next = resolveTurnCheckpoint(state,checkpoints);
  expect(next.board.jointCorrections).toEqual(resolved.board.jointCorrections);
  expect(next.reports.map(report => report.penalty)).toEqual([-1,0,0,0,0,0]);
  expect(next.receipt!.correctionIds).toEqual([]);
});

it("does not back-charge an unknown original turn when its overload becomes observable later", () => {
  const opening = createReleaseGame(4);
  let state: TurnState = {...opening,nextId:4,draft:{
    members:[{id:3,type:"heb",owner:"player-1",a:"5,7,1",b:"6,7,1"}],
    connections:[{memberId:3,end:"a",jointId:"5,7,1",profile:"fixed",owner:"player-1"}],
    loads:[{cardId:"fixture",jointId:"endpoint:3:b",magnitude:500,owner:"player-1"}]}};
  const after = {...state.board,members:[...state.board.members,...state.draft.members],
    connections:[...state.board.connections,...state.draft.connections],loads:state.draft.loads};
  let checkpoints = createTurnCheckpoints();
  for (let turn=1;turn<=3;turn++) {
    state = {...state,turn,playerIndex:(turn-1)%2};
    const queued = queueTurnCheckpoint(state,after,checkpoints);
    checkpoints = queued.checkpoints;
    state = {...state,board:after,draft:{members:[],connections:[],loads:[]},reports:[...state.reports,queued.report]};
  }
  const unavailable = vi.spyOn(analysis,"analyzeTurn").mockImplementation(() => {throw new Error("fixture unavailable");});
  const unresolved = resolveTurnCheckpoint(state,checkpoints);
  unavailable.mockRestore();
  expect(unresolved.reports.every(report => report.status === "unresolved" && !report.penalty)).toBe(true);
  expect(unresolved.receipt!.unresolvedTurns).toEqual([1,2,3]);
  state = {...state,board:unresolved.board,reports:unresolved.reports};
  checkpoints = unresolved.checkpoints;
  for (let turn=4;turn<=6;turn++) {
    state = {...state,turn,playerIndex:(turn-1)%2};
    const queued = queueTurnCheckpoint(state,state.board,checkpoints);
    checkpoints = queued.checkpoints;
    state = {...state,reports:[...state.reports,queued.report]};
  }
  const known = resolveTurnCheckpoint(state,checkpoints);
  expect(known.reports[3].issues!.changes.some(change => change.category.includes("overload") && change.after.active)).toBe(true);
  expect(known.reports.every(report => report.penalty === 0)).toBe(true);
  expect(known.receipt!.penaltyIds).toEqual([]);
});
