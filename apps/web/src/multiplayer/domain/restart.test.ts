import { expect, it, vi } from "vitest";
import { commandFor, createMultiplayerDomain, restoreMultiplayerDomain, type Action } from "./index";
import { multiplayerFixture } from "./fixtures";
import { restartMultiplayerMatch } from "./restart";

function match() {
  const domain = createMultiplayerDomain({...multiplayerFixture(), rounds: 1});
  const send = (action: Action) => domain.dispatch(commandFor(domain.getSnapshot(), action));
  let saved = domain.serialize();
  const storage = {getItem: () => saved, setItem: vi.fn((_key: string, value: string) => { saved = value; })};
  return {domain, send, storage};
}

it.each(["handoff", "draw", "play", "checkpoint", "finished"])("requires confirmation during %s", phase => {
  const {domain, send, storage} = match();
  send({type:"interval", interval:1});
  if (phase !== "handoff") {
    send({type:"ready"});
    send({type:"draw", source:"elementsLoads"});
    if (phase !== "draw") {
      for (let i=0; i<3; i++) send({type:"draw", source:"elementsLoads"});
      send({type:"stage", play:{kind:"load",cardId:"l0",at:{memberId:"column/A",quarter:4}}});
      if (phase !== "play") send({type:"commit"});
    }
  }
  if (phase === "finished") {
    const checkpoint = () => send({type:"checkpoint",checkpointId:domain.getSnapshot().checkpointId!,
      requestId:"fixture",solver:"fixture",rules:"mr-v1",corrections:[]});
    checkpoint(); send({type:"ready"});
    for (let i=0; i<4; i++) send({type:"draw", source:"connections"});
    send({type:"commit"}); checkpoint();
  }
  expect(domain.getSnapshot().phase).toBe(phase);
  const original = domain.serialize();
  storage.setItem("slot", original);
  storage.setItem.mockClear();
  expect(restartMultiplayerMatch(domain,storage,"slot",()=>false)).toBeNull();
  expect(domain.serialize()).toBe(original);
  expect(storage.setItem).not.toHaveBeenCalled();
  const permission = vi.fn(()=>true);
  const next = restartMultiplayerMatch(domain,storage,"slot",permission)!;
  expect(permission).toHaveBeenCalledOnce();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(next.getSnapshot()).toMatchObject({phase:"handoff",turn:1,interval:1,history:[],drafts:[],corrections:[],pendingTurns:[]});
  expect(next.getSnapshot().matchId).not.toBe(domain.getSnapshot().matchId);
  expect(restoreMultiplayerDomain(storage.getItem()).getSnapshot()).toEqual(next.getSnapshot());
  expect(()=>restartMultiplayerMatch(domain,storage,"slot",()=>true)).toThrow();
});

it("keeps the old match usable if writing the replacement fails",()=>{
  const {domain,storage}=match();
  const original=domain.serialize();
  storage.setItem.mockImplementation(()=>{throw new Error("Storage full");});
  expect(()=>restartMultiplayerMatch(domain,storage,"slot",()=>true)).toThrow("Storage full");
  expect(domain.serialize()).toBe(original);
  expect(storage.getItem()).toBe(original);
});
