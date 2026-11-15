import { describe, expect, it } from "vitest";
import { AgentBridge } from "./bridge";

const send = (bridge: AgentBridge, request: object) =>
  bridge.handleLine(JSON.stringify(request)) as { ok: boolean; id?: unknown; result?: any; error?: string };

describe("AgentBridge", () => {
  it("resets, lists legal actions and echoes the request id", () => {
    const bridge = new AgentBridge();
    const response = send(bridge, { id: 7, method: "reset", params: { scenario: "single" } });
    expect(response).toMatchObject({ ok: true, id: 7 });
    expect(response.result.actions[0]).toEqual({ kind: "finish" });
    expect(response.result.observation.targets).toHaveLength(1);
    expect(response.result.features).toBeUndefined();
  });

  it("plays the known solution by action and by index, to a solved episode", () => {
    const bridge = new AgentBridge();
    send(bridge, { method: "reset" });
    send(bridge, { method: "step", params: { action: { kind: "foundation", at: [4, 4, 0] } } });
    const listing = send(bridge, { method: "actions" });
    const member = listing.result.actions.findIndex(
      (a: any) => a.kind === "member" && a.type === "ipe" && a.a.join() === "4,4,3" && a.b.join() === "4,4,0",
    );
    expect(member).toBeGreaterThan(0);
    send(bridge, { method: "step", params: { actionIndex: member } });
    const last = send(bridge, { method: "step", params: { action: { kind: "joint", at: [4, 4, 0] } } });
    expect(last.result).toMatchObject({ done: true, truncated: false });
    expect(last.result.info.analysis.success).toBe(true);
    expect(last.result.reward).toBeGreaterThan(1);
  });

  it("can attach a feature matrix aligned with the action list", () => {
    const bridge = new AgentBridge();
    const { result } = send(bridge, { method: "reset", params: { features: true } });
    expect(result.features).toHaveLength(result.actions.length);
    expect(result.prior).toHaveLength(result.actions.length);
    expect(result.features[0]).toHaveLength(result.featureNames.length);
  });

  it("reports protocol and rule errors without throwing", () => {
    const bridge = new AgentBridge();
    expect(send(bridge, { method: "step", params: { actionIndex: 0 } }).error).toMatch(/reset first/);
    expect(bridge.handleLine("not json")).toMatchObject({ ok: false });
    expect(send(bridge, { method: "dance" }).ok).toBe(false);
    expect(send(bridge, { method: "reset", params: { scenario: "nope" } }).ok).toBe(false);
    send(bridge, { method: "reset" });
    expect(send(bridge, { method: "step", params: {} }).error).toMatch(/needs a valid/);
    expect(send(bridge, { method: "step", params: { actionIndex: 99999 } }).error).toMatch(/needs a valid/);
    // An illegal-but-well-formed action is a penalised no-op, not a protocol error.
    const illegal = send(bridge, { method: "step", params: { action: { kind: "foundation", at: [4, 4, 2] } } });
    expect(illegal.ok).toBe(true);
    expect(illegal.result.info.invalid).toMatch(/solid ground/);
  });

  it("refuses to step after the episode has ended", () => {
    const bridge = new AgentBridge();
    send(bridge, { method: "reset" });
    expect(send(bridge, { method: "step", params: { action: { kind: "finish" } } }).result.done).toBe(true);
    expect(send(bridge, { method: "step", params: { action: { kind: "finish" } } }).error).toMatch(/Episode is over/);
  });
});
