import { describe, expect, it } from "vitest";
import { releaseContextWhenIdle, type FencedContext as ReleasableContext, type ReleaseHost } from "./releaseContext";

const SYNC_GPU_COMMANDS_COMPLETE = 0x9117, SYNC_STATUS = 0x9114, SIGNALED = 0x9119, UNSIGNALED = 0x9118;

/** A context whose fence signals once `state.drained` is set. */
function fakeContext({ fence = true } = {}) {
  const calls: string[] = [];
  const state = { lost: false, drained: false };
  const sync = {} as WebGLSync;
  const gl: ReleasableContext = {
    SYNC_GPU_COMMANDS_COMPLETE, SYNC_STATUS, SIGNALED,
    isContextLost: () => state.lost,
    fenceSync: () => { calls.push("fence"); return fence ? sync : null; },
    flush: () => { calls.push("flush"); },
    getSyncParameter: (value, name) => {
      expect(value).toBe(sync);
      expect(name).toBe(SYNC_STATUS);
      return state.drained ? SIGNALED : UNSIGNALED;
    },
    deleteSync: value => { expect(value).toBe(sync); calls.push("delete"); },
    getExtension: ((name: string) => name === "WEBGL_lose_context"
      ? { loseContext: () => { calls.push("lose"); state.lost = true; }, restoreContext() {} }
      : null) as ReleasableContext["getExtension"],
  };
  return { gl, calls, state };
}

/** Manual clock: `run()` fires every due timer in order. */
function fakeHost() {
  let time = 0;
  const timers: { at: number; run: () => void }[] = [];
  const host: ReleaseHost = { now: () => time, timeout: (run, ms) => { timers.push({ at: time + ms, run }); } };
  function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      time = next.at;
      next.run();
    }
    time = end;
  }
  return { host, advance, pending: () => timers.length };
}

describe("releaseContextWhenIdle", () => {
  it("never releases inside the calling task", () => {
    const { gl, calls } = fakeContext();
    releaseContextWhenIdle(gl, { host: fakeHost().host });
    expect(calls).toEqual(["fence", "flush"]);
  });

  it("waits for the fence, then releases exactly once", () => {
    const { gl, calls, state } = fakeContext();
    const clock = fakeHost();
    releaseContextWhenIdle(gl, { host: clock.host, pollMs: 50 });
    clock.advance(500);
    expect(calls).not.toContain("lose");
    state.drained = true;
    clock.advance(50);
    expect(calls).toEqual(["fence", "flush", "delete", "lose"]);
    clock.advance(1000);
    expect(clock.pending()).toBe(0);
    expect(calls.filter(call => call === "lose")).toHaveLength(1);
  });

  it("releases at the deadline if the fence never signals", () => {
    const { gl, calls } = fakeContext();
    const clock = fakeHost();
    releaseContextWhenIdle(gl, { host: clock.host, pollMs: 50, maxWaitMs: 1000 });
    clock.advance(950);
    expect(calls).not.toContain("lose");
    clock.advance(100);
    expect(calls.at(-1)).toBe("lose");
    expect(clock.pending()).toBe(0);
  });

  it("does nothing more once the context is lost by other means", () => {
    const { gl, calls, state } = fakeContext();
    const clock = fakeHost();
    releaseContextWhenIdle(gl, { host: clock.host });
    state.lost = true;
    clock.advance(30_000);
    expect(calls).toEqual(["fence", "flush"]);
    expect(clock.pending()).toBe(0);
  });

  it("skips an already-lost context and releases at once without a fence", () => {
    const lost = fakeContext();
    lost.state.lost = true;
    const clock = fakeHost();
    releaseContextWhenIdle(lost.gl, { host: clock.host });
    expect(lost.calls).toEqual([]);
    expect(clock.pending()).toBe(0);

    const unfenced = fakeContext({ fence: false });
    releaseContextWhenIdle(unfenced.gl, { host: clock.host });
    clock.advance(0);
    expect(unfenced.calls).toEqual(["fence", "flush", "lose"]);
  });
});
