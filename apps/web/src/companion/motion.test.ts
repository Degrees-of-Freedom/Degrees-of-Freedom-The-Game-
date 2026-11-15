import { describe, expect, it } from "vitest";
import { CHANNELS, CLIPS, MOTIONS, PRIORITY, RELEASE_IDLE, REST, canInterrupt, motionForCue, nextIdle,
  portraitTransform, sampleClip, type CompanionCue, type MotionName } from "./motion";

describe("companion motion clips", () => {
  it.each(MOTIONS)("%s starts and settles exactly at rest", name => {
    const clip = CLIPS[name];
    expect(sampleClip(clip, 0)).toEqual(REST);
    expect(sampleClip(clip, clip.duration)).toEqual(REST);
    expect(sampleClip(clip, clip.duration * 4)).toEqual(REST);
  });

  it.each(MOTIONS)("%s has ordered keys and visibly moves", name => {
    const clip = CLIPS[name];
    let moved = 0;
    for (const channel of CHANNELS) {
      const keys = (clip.tracks as Partial<Record<string, readonly (readonly [number, number])[]>>)[channel];
      if (!keys) continue;
      keys.forEach(([t], i) => { if (i) expect(t).toBeGreaterThanOrEqual(keys[i - 1][0]); });
      expect(keys[0][0]).toBe(0);
      expect(keys.at(-1)![0]).toBe(1);
    }
    for (let ms = 0; ms <= clip.duration; ms += 16)
      moved = Math.max(moved, ...CHANNELS.map(c => Math.abs(sampleClip(clip, ms)[c])));
    expect(moved).toBeGreaterThan(.01);
  });

  it("keeps hops and tilts inside the badge's headroom", () => {
    for (const name of MOTIONS) for (let ms = 0; ms <= CLIPS[name].duration; ms += 8) {
      const pose = sampleClip(CLIPS[name], ms);
      expect(pose.lift).toBeLessThanOrEqual(.16);
      expect(pose.lift).toBeGreaterThanOrEqual(0);
      expect(Math.abs(pose.tilt)).toBeLessThan(.2);
      expect(Math.abs(pose.squash)).toBeLessThan(.15);
    }
  });

  it("interpolates smoothly and continuously between keys", () => {
    const clip = CLIPS.nod;
    let previous = sampleClip(clip, 0).bend;
    for (let ms = 1; ms <= clip.duration; ms++) {
      const next = sampleClip(clip, ms).bend;
      expect(Math.abs(next - previous)).toBeLessThan(.03);
      previous = next;
    }
    expect(sampleClip(clip, clip.duration * .25).bend).toBeCloseTo(CLIPS.nod.tracks.bend[1][1]);
  });

  it("keeps release idle to subtle breathing and weight shift", () => {
    expect(RELEASE_IDLE).toEqual(["breathe", "shift"]);
    for (const name of RELEASE_IDLE) expect(CLIPS[name].priority).toBe(PRIORITY.idle);
  });
});

describe("interruption", () => {
  it("lets serious reactions override routine chatter but not the reverse", () => {
    expect(canInterrupt("nod", 100, "concern")).toBe(true);
    expect(canInterrupt("concern", 100, "nod")).toBe(false);
    expect(canInterrupt("foreman", 100, "cheer")).toBe(false);
    expect(canInterrupt("cheer", 100, "victory")).toBe(true);
  });

  it("restarts equal-priority routine motions and frees finished clips", () => {
    expect(canInterrupt("nod", 100, "nod")).toBe(true);
    expect(canInterrupt("concern", CLIPS.concern.duration, "nod")).toBe(true);
    expect(canInterrupt(null, 0, "breathe")).toBe(true);
  });

  it("never lets an idle fidget interrupt anything that is playing", () => {
    expect(canInterrupt("breathe", 10, "shift")).toBe(false);
    expect(canInterrupt("nod", 10, "breathe")).toBe(false);
  });
});

describe("idle scheduling", () => {
  it("avoids repeating the previous fidget and waits 6–12 s", () => {
    for (const r of [0, .3, .6, .999]) {
      const { motion, delay } = nextIdle(RELEASE_IDLE, "breathe", () => r);
      expect(motion).toBe("shift");
      expect(delay).toBeGreaterThanOrEqual(6000);
      expect(delay).toBeLessThanOrEqual(12000);
    }
  });

  it("handles a single-entry palette", () => {
    expect(nextIdle(["breathe"], "breathe", () => .5).motion).toBe("breathe");
  });
});

describe("scenario mapping", () => {
  const cues: [CompanionCue, MotionName][] = [
    [{ kind: "greet" }, "wave"],
    [{ kind: "activate" }, "wave"],
    [{ kind: "turn-start" }, "perk"],
    [{ kind: "select", family: "element" }, "measure"],
    [{ kind: "select", family: "connection" }, "point"],
    [{ kind: "select", family: "load" }, "brace"],
    [{ kind: "cancel" }, "stepBack"],
    [{ kind: "stage-member" }, "measure"],
    [{ kind: "attach" }, "nod"],
    [{ kind: "stage-load" }, "brace"],
    [{ kind: "invalid" }, "puzzled"],
    [{ kind: "inspect" }, "ponder"],
    [{ kind: "issue" }, "concern"],
    [{ kind: "clean-turn" }, "cheer"],
    [{ kind: "repair" }, "dance"],
    [{ kind: "foreman" }, "foreman"],
    [{ kind: "victory" }, "victory"],
  ];
  it.each(cues)("%j plays %s", (cue, motion) => expect(motionForCue(cue)).toBe(motion));

  it("never answers invalid input with a dramatic motion", () => {
    expect(CLIPS[motionForCue({ kind: "invalid" })].priority).toBe(PRIORITY.routine);
  });
});

describe("portrait fallback transform", () => {
  it("is the identity at rest", () => {
    expect(portraitTransform(REST)).toBe("translateY(0%) rotate(0rad) skewX(0rad) scale(1, 1)");
  });

  it("maps a hop upward and a squash shorter and wider", () => {
    const css = portraitTransform({ ...REST, lift: .1, squash: .1 });
    expect(css).toContain("translateY(-10%)");
    expect(css).toContain("scale(1.05, 0.9)");
  });

  it("never mirrors the portrait on a large turn", () => {
    const sx = Number(/scale\(([^,]+),/.exec(portraitTransform({ ...REST, turn: Math.PI }))![1]);
    expect(sx).toBeGreaterThan(.5);
  });
});
