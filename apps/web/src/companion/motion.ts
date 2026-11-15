/**
 * Timburr's procedural motion vocabulary.
 *
 * The attributed GLBs are unrigged static meshes with no embedded clips (see
 * docs/kb/avatar-criteria.md §7), so every animation here is authored as
 * keyframes over a handful of whole-figure channels plus the single upper-body
 * flex morph that `figure.ts` builds. The same sampled pose drives the 3D model
 * and, through `portraitTransform`, the PNG portrait fallback, so the character
 * stays lively when WebGL is unavailable.
 *
 * This module is pure: no DOM, timers or Three.js. Scheduling lives in
 * `animator.ts`; scenario selection lives in `motionForCue`.
 */

/** Animatable channels. Units are chosen so the renderer can stay dumb. */
export const CHANNELS = ["lift", "squash", "lean", "tilt", "turn", "bend"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * A sampled pose.
 * - `lift`: vertical hop as a fraction of figure height (positive is up).
 * - `squash`: vertical squash as a fraction (positive is shorter and wider;
 *   negative stretches). Volume is roughly preserved by the renderer.
 * - `lean`: forward (+) / back (−) pitch about the feet, radians.
 * - `tilt`: sideways roll about the feet, radians (+ leans to the viewer's left).
 * - `turn`: yaw, radians (+ turns toward the viewer's right).
 * - `bend`: upper-body flex morph influence; 1 is the authored forward nod,
 *   negative values arch back (chest out).
 */
export type Pose = Readonly<Record<Channel, number>>;

export const REST: Pose = Object.freeze({ lift: 0, squash: 0, lean: 0, tilt: 0, turn: 0, bend: 0 });

/**
 * Interruption tiers. A cue may replace a playing clip of equal or lower
 * priority; idle fidgets only start when nothing else is playing. This keeps a
 * serious result from being overwritten by routine placement chatter.
 */
export const PRIORITY = { idle: 0, routine: 1, reaction: 2, dramatic: 3 } as const;
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

/** `[t, value]` where `t` is the normalized clip time in [0, 1]. */
export type Key = readonly [t: number, value: number];

export interface MotionClip {
  readonly duration: number;
  readonly priority: Priority;
  readonly tracks: Readonly<Partial<Record<Channel, readonly Key[]>>>;
}

/**
 * The clip library. Every track starts and ends at zero so a finished clip
 * always settles exactly at rest (enforced by tests). Amplitudes stay small:
 * the companion is a 36–68 px edge badge, and the criteria ask for subtle,
 * fast routine feedback with rare spectacle.
 */
export const CLIPS = {
  // Idle fidgets: subtle breathing and weight shift (release-safe), plus
  // glances and timber adjustments for the non-release workspaces.
  breathe: { duration: 2400, priority: PRIORITY.idle, tracks: {
    squash: [[0, 0], [.45, -.022], [1, 0]],
    bend: [[0, 0], [.45, -.12], [1, 0]],
  } },
  shift: { duration: 1800, priority: PRIORITY.idle, tracks: {
    tilt: [[0, 0], [.3, .035], [.7, -.025], [1, 0]],
    squash: [[0, 0], [.3, .012], [.7, .012], [1, 0]],
  } },
  glance: { duration: 1900, priority: PRIORITY.idle, tracks: {
    turn: [[0, 0], [.2, .32], [.75, .32], [1, 0]],
    bend: [[0, 0], [.2, .15], [.75, .15], [1, 0]],
  } },
  adjust: { duration: 1300, priority: PRIORITY.idle, tracks: {
    bend: [[0, 0], [.3, .45], [.55, .1], [1, 0]],
    tilt: [[0, 0], [.3, -.05], [1, 0]],
    lift: [[0, 0], [.55, .02], [.75, 0], [1, 0]],
  } },
  // A stretch: tall and arched back, then a settle.
  stretch: { duration: 1500, priority: PRIORITY.idle, tracks: {
    squash: [[0, 0], [.35, -.07], [.7, -.07], [1, 0]],
    bend: [[0, 0], [.35, -.5], [.7, -.5], [1, 0]],
    lift: [[0, 0], [.35, .02], [.7, .02], [1, 0]],
  } },
  // Three impatient taps of a foot, weight on the other.
  tapFoot: { duration: 1400, priority: PRIORITY.idle, tracks: {
    lift: [[0, 0], [.15, .03], [.3, 0], [.45, .03], [.6, 0], [.75, .03], [.9, 0], [1, 0]],
    tilt: [[0, 0], [.1, -.04], [.9, -.04], [1, 0]],
  } },
  // Leaning out to peek at the board, then back.
  peek: { duration: 1600, priority: PRIORITY.idle, tracks: {
    lean: [[0, 0], [.3, .15], [.7, .15], [1, 0]],
    turn: [[0, 0], [.3, -.25], [.7, -.25], [1, 0]],
    bend: [[0, 0], [.3, .4], [.7, .4], [1, 0]],
  } },

  // Routine feedback: a glance or nod, never narration.
  wave: { duration: 1300, priority: PRIORITY.routine, tracks: {
    tilt: [[0, 0], [.15, .121], [.32, -.088], [.5, .11], [.68, -.066], [.85, .044], [1, 0]],
    lift: [[0, 0], [.12, .04], [.25, 0], [1, 0]],
    turn: [[0, 0], [.2, -.21], [.85, -.21], [1, 0]],
  } },
  perk: { duration: 700, priority: PRIORITY.routine, tracks: {
    squash: [[0, 0], [.15, .08], [.4, -.06], [.7, .02], [1, 0]],
    lift: [[0, 0], [.2, 0], [.42, .09], [.68, 0], [1, 0]],
  } },
  point: { duration: 750, priority: PRIORITY.routine, tracks: {
    turn: [[0, 0], [.3, .42], [.75, .42], [1, 0]],
    lean: [[0, 0], [.3, .135], [.75, .135], [1, 0]],
    bend: [[0, 0], [.3, .52], [.75, .52], [1, 0]],
  } },
  measure: { duration: 950, priority: PRIORITY.routine, tracks: {
    lean: [[0, 0], [.25, .189], [.8, .189], [1, 0]],
    bend: [[0, 0], [.25, .65], [.8, .65], [1, 0]],
    tilt: [[0, 0], [.35, .055], [.5, -.055], [.65, .055], [.8, 0], [1, 0]],
  } },
  nod: { duration: 520, priority: PRIORITY.routine, tracks: {
    bend: [[0, 0], [.25, 1.105], [.5, 0], [.72, .78], [1, 0]],
  } },
  brace: { duration: 950, priority: PRIORITY.routine, tracks: {
    squash: [[0, 0], [.25, .1], [.7, .1], [.85, -.03], [1, 0]],
    bend: [[0, 0], [.25, .39], [.7, .39], [1, 0]],
    turn: [[0, 0], [.25, .28], [.7, .28], [1, 0]],
  } },
  stepBack: { duration: 650, priority: PRIORITY.routine, tracks: {
    lean: [[0, 0], [.3, -.162], [.7, -.081], [1, 0]],
    lift: [[0, 0], [.18, .03], [.36, 0], [1, 0]],
    turn: [[0, 0], [.3, -.14], [1, 0]],
  } },
  puzzled: { duration: 1000, priority: PRIORITY.routine, tracks: {
    tilt: [[0, 0], [.25, .187], [.8, .187], [1, 0]],
    turn: [[0, 0], [.25, .196], [.8, .196], [1, 0]],
  } },
  ponder: { duration: 1700, priority: PRIORITY.routine, tracks: {
    tilt: [[0, 0], [.2, -.11], [.85, -.11], [1, 0]],
    turn: [[0, 0], [.2, -.308], [.85, -.308], [1, 0]],
    bend: [[0, 0], [.2, .325], [.5, .455], [.85, .325], [1, 0]],
  } },

  // Result reactions: concern, relief and a little celebration.
  concern: { duration: 1500, priority: PRIORITY.reaction, tracks: {
    squash: [[0, 0], [.25, .05], [.85, .05], [1, 0]],
    bend: [[0, 0], [.25, .78], [.85, .78], [1, 0]],
    tilt: [[0, 0], [.25, -.066], [.85, -.066], [1, 0]],
    turn: [[0, 0], [.25, .35], [.85, .35], [1, 0]],
  } },
  cheer: { duration: 1200, priority: PRIORITY.reaction, tracks: {
    squash: [[0, 0], [.08, .07], [.2, -.05], [.38, .06], [.5, -.05], [.68, .04], [1, 0]],
    lift: [[0, 0], [.1, 0], [.24, .12], [.38, 0], [.52, .1], [.66, 0], [1, 0]],
    tilt: [[0, 0], [.24, .088], [.52, -.088], [.8, 0], [1, 0]],
  } },
  dance: { duration: 1800, priority: PRIORITY.reaction, tracks: {
    turn: [[0, 0], [.15, .532], [.4, -.532], [.65, .532], [.88, -.28], [1, 0]],
    lift: [[0, 0], [.15, .07], [.27, 0], [.4, .07], [.52, 0], [.65, .07], [.77, 0], [1, 0]],
    bend: [[0, 0], [.15, -.39], [.4, .39], [.65, -.39], [.88, .13], [1, 0]],
  } },

  // Rare spectacle: Conkeldurr's foreman arrival and the final outcome.
  foreman: { duration: 800, priority: PRIORITY.dramatic, tracks: {
    squash: [[0, 0], [.2, .13], [.45, -.09], [.62, .06], [.8, 0], [1, 0]],
    lift: [[0, 0], [.25, 0], [.45, .06], [.62, 0], [1, 0]],
    turn: [[0, 0], [.45, -.28], [.85, -.28], [1, 0]],
    bend: [[0, 0], [.45, -.6], [.85, -.6], [1, 0]],
  } },
  victory: { duration: 1600, priority: PRIORITY.dramatic, tracks: {
    squash: [[0, 0], [.12, .12], [.3, -.1], [.52, .08], [.66, -.04], [.8, 0], [1, 0]],
    lift: [[0, 0], [.14, 0], [.34, .15], [.52, 0], [1, 0]],
    turn: [[0, 0], [.3, .55], [.55, -.4], [.8, .2], [1, 0]],
    bend: [[0, 0], [.34, -.7], [.6, -.4], [1, 0]],
    tilt: [[0, 0], [.6, .1], [.8, -.06], [1, 0]],
  } },
} as const satisfies Record<string, MotionClip>;

export type MotionName = keyof typeof CLIPS;
export const MOTIONS = Object.keys(CLIPS) as MotionName[];

/** Fidgets allowed during release play: subtle breathing and weight shift only. */
export const RELEASE_IDLE: readonly MotionName[] = ["breathe", "shift"];
/** Fidgets for menus and earlier workspaces, where a little more character is welcome. */
export const AMBIENT_IDLE: readonly MotionName[] = ["breathe", "shift", "glance", "adjust", "breathe", "stretch", "tapFoot", "peek"];

/** Smooth-in/smooth-out interpolation between neighbouring keys. */
function sampleTrack(keys: readonly Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }
  return keys[keys.length - 1][1];
}

/** Sample a clip at `elapsed` milliseconds; clamps to rest outside [0, duration]. */
export function sampleClip(clip: MotionClip, elapsed: number): Pose {
  const t = Math.min(1, Math.max(0, elapsed / clip.duration));
  const pose = { ...REST };
  for (const channel of CHANNELS) {
    const keys = clip.tracks[channel];
    if (keys) pose[channel] = sampleTrack(keys, t);
  }
  return pose;
}

/**
 * Whether `next` may replace `current` (playing for `elapsed` ms). Finished
 * clips never block; equal priority restarts so repeated routine actions each
 * get their nod.
 */
export function canInterrupt(current: MotionName | null, elapsed: number, next: MotionName): boolean {
  if (!current || elapsed >= CLIPS[current].duration) return true;
  return CLIPS[next].priority >= CLIPS[current].priority && CLIPS[next].priority > PRIORITY.idle;
}

/** Choose the next fidget and its delay, avoiding an immediate repeat. */
export function nextIdle(palette: readonly MotionName[], previous: MotionName | null, random: () => number):
  { motion: MotionName; delay: number } {
  const options = palette.length > 1 ? palette.filter(name => name !== previous) : palette;
  const motion = options[Math.min(options.length - 1, Math.floor(random() * options.length))];
  return { motion, delay: 6000 + Math.round(random() * 6000) };
}

/**
 * Public, presentation-only scenarios. Cues carry no card identity or private
 * hand content: `select` names only the public card family being targeted.
 */
export type CompanionCue =
  | { kind: "greet" }
  | { kind: "activate" }
  | { kind: "turn-start" }
  | { kind: "select"; family: "element" | "connection" | "load" }
  | { kind: "cancel" }
  | { kind: "stage-member" }
  | { kind: "attach" }
  | { kind: "stage-load" }
  | { kind: "invalid" }
  | { kind: "inspect" }
  | { kind: "issue" }
  | { kind: "clean-turn" }
  | { kind: "repair" }
  | { kind: "foreman" }
  | { kind: "victory" };

/** A cue with a monotonically increasing identity so React can replay equal cues. */
export type CompanionCueEvent = CompanionCue & { readonly id: number };

/** Map a scenario to its motion. Exhaustive by construction. */
export function motionForCue(cue: CompanionCue): MotionName {
  switch (cue.kind) {
    case "greet": case "activate": return "wave";
    case "turn-start": return "perk";
    case "select": return cue.family === "element" ? "measure" : cue.family === "load" ? "brace" : "point";
    case "cancel": return "stepBack";
    case "stage-member": return "measure";
    case "attach": return "nod";
    case "stage-load": return "brace";
    case "invalid": return "puzzled";
    case "inspect": return "ponder";
    case "issue": return "concern";
    case "clean-turn": return "cheer";
    case "repair": return "dance";
    case "foreman": return "foreman";
    case "victory": return "victory";
  }
}

/**
 * CSS transform for the 2D portrait fallback. Yaw is approximated by a
 * horizontal squeeze and the flex morph by a small skew, so every clip still
 * reads on the static image. Transform origin is the feet (`50% 100%`).
 */
export function portraitTransform(pose: Pose): string {
  const sy = 1 - pose.squash;
  const sx = (1 + pose.squash * .5) * Math.max(.55, Math.cos(pose.turn));
  const roll = pose.tilt + pose.lean * .35;
  const skew = pose.bend * .08 + pose.turn * .06;
  const r = (n: number) => Number(n.toFixed(4));
  return `translateY(${r(-pose.lift * 100)}%) rotate(${r(roll)}rad) skewX(${r(skew)}rad) scale(${r(sx)}, ${r(sy)})`;
}
