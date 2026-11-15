import { describe, expect, it } from "vitest";
import { createAnimator, type AnimatorHost } from "./animator";
import { CLIPS, REST, type MotionName, type Pose } from "./motion";

/** Deterministic frame and timer scheduler. */
function fakeHost(random = () => 0) {
  let time = 0, ids = 0;
  const frames = new Map<number, (t: number) => void>();
  const timers = new Map<number, { at: number; run: () => void }>();
  const host: AnimatorHost = {
    now: () => time,
    frame: cb => { frames.set(++ids, cb); return ids; },
    cancelFrame: id => { frames.delete(id); },
    timeout: (run, ms) => { timers.set(++ids, { at: time + ms, run }); return ids; },
    clearTimeout: id => { timers.delete(id); },
    random,
  };
  /** Advance time in 16 ms frames, firing due timers and queued frames. */
  function advance(ms: number) {
    const end = time + ms;
    while (time < end) {
      time = Math.min(end, time + 16);
      for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.run(); }
      const due = [...frames];
      frames.clear();
      for (const [, cb] of due) cb(time);
    }
  }
  return { host, advance, pending: () => ({ frames: frames.size, timers: timers.size }) };
}

function setup(random?: () => number) {
  const clock = fakeHost(random);
  const poses: { pose: Pose; motion: MotionName | null }[] = [];
  const animator = createAnimator({ host: clock.host, apply: (pose, motion) => poses.push({ pose, motion }) });
  return { ...clock, animator, poses };
}

describe("companion animator", () => {
  it("plays a clip to completion and settles at rest without further frames", () => {
    const { animator, advance, poses, pending } = setup();
    expect(animator.play("nod")).toBe(true);
    advance(CLIPS.nod.duration / 4);
    expect(poses.at(-1)!.pose.bend).toBeGreaterThan(.5);
    advance(CLIPS.nod.duration);
    expect(poses.at(-1)).toEqual({ pose: REST, motion: null });
    expect(animator.current).toBeNull();
    expect(pending()).toEqual({ frames: 0, timers: 0 });
  });

  it("keeps a serious reaction over a later routine cue", () => {
    const { animator, advance } = setup();
    animator.play("concern");
    advance(200);
    expect(animator.play("nod")).toBe(false);
    expect(animator.current).toBe("concern");
    expect(animator.play("victory")).toBe(true);
    expect(animator.current).toBe("victory");
  });

  it("schedules one idle fidget at a time and none while a clip plays", () => {
    const { animator, advance, pending } = setup(() => 0);
    animator.idle(["breathe", "shift"]);
    expect(pending().timers).toBe(1);
    advance(6000);
    expect(animator.current).toBe("breathe");
    expect(pending().timers).toBe(0);
    advance(CLIPS.breathe.duration);
    expect(animator.current).toBeNull();
    expect(pending().timers).toBe(1);
    advance(6000);
    expect(animator.current).toBe("shift");
  });

  it("refuses motion and cancels idle in still mode", () => {
    const { animator, advance, poses, pending } = setup();
    animator.idle(["breathe"]);
    animator.play("cheer");
    advance(100);
    animator.still(true);
    expect(poses.at(-1)).toEqual({ pose: REST, motion: null });
    expect(animator.play("victory")).toBe(false);
    expect(pending()).toEqual({ frames: 0, timers: 0 });
    animator.still(false);
    expect(pending().timers).toBe(1);
  });

  it("releases every frame and timer on dispose", () => {
    const { animator, pending } = setup();
    animator.idle(["breathe"]);
    animator.play("dance");
    animator.dispose();
    expect(pending()).toEqual({ frames: 0, timers: 0 });
    expect(animator.play("nod")).toBe(false);
  });
});
