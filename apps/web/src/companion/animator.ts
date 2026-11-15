import { CLIPS, REST, canInterrupt, nextIdle, sampleClip, type MotionName, type Pose } from "./motion";

/** Injectable clock and schedulers, so the animator is testable without a DOM. */
export interface AnimatorHost {
  now(): number;
  frame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  timeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  random(): number;
}

export const browserHost: AnimatorHost = {
  now: () => performance.now(),
  frame: callback => requestAnimationFrame(callback),
  cancelFrame: handle => cancelAnimationFrame(handle),
  timeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: handle => window.clearTimeout(handle),
  random: Math.random,
};

export interface AnimatorOptions {
  /** Receives every sampled pose, including the final rest pose. */
  apply(pose: Pose, motion: MotionName | null): void;
  host?: AnimatorHost;
}

export interface Animator {
  /** Play a clip if it may interrupt the current one. Returns whether it started. */
  play(motion: MotionName): boolean;
  /**
   * Enable occasional fidgets from `palette`, or disable them with `null`.
   * Idle never runs a continuous loop: one short clip, then a 6–12 s pause.
   */
  idle(palette: readonly MotionName[] | null): void;
  /** Still mode (reduced motion, skipped effects, hidden tab): settle and refuse clips. */
  still(value: boolean): void;
  /** Return to rest immediately. */
  settle(): void;
  readonly current: MotionName | null;
  dispose(): void;
}

/**
 * Plays one bounded clip at a time. No frames are requested while resting, so
 * an idle companion costs nothing between fidgets; still mode and disposal
 * cancel every pending frame and timer.
 */
export function createAnimator({ apply, host = browserHost }: AnimatorOptions): Animator {
  let current: MotionName | null = null;
  let started = 0;
  let handle: number | null = null;
  let idleTimer: number | null = null;
  let palette: readonly MotionName[] | null = null;
  let lastIdle: MotionName | null = null;
  let isStill = false;
  let disposed = false;

  const stopFrame = () => { if (handle !== null) host.cancelFrame(handle); handle = null; };
  const stopIdle = () => { if (idleTimer !== null) host.clearTimeout(idleTimer); idleTimer = null; };

  function scheduleIdle() {
    stopIdle();
    if (!palette?.length || isStill || disposed) return;
    const { motion, delay } = nextIdle(palette, lastIdle, host.random);
    idleTimer = host.timeout(() => {
      idleTimer = null;
      if (current === null && start(motion)) lastIdle = motion;
      else scheduleIdle();
    }, delay);
  }

  function tick(time: number) {
    handle = null;
    if (disposed || current === null) return;
    const clip = CLIPS[current];
    const elapsed = time - started;
    if (elapsed >= clip.duration) {
      current = null;
      apply(REST, null);
      scheduleIdle();
      return;
    }
    apply(sampleClip(clip, elapsed), current);
    handle = host.frame(tick);
  }

  function start(motion: MotionName): boolean {
    if (disposed || isStill) return false;
    if (!canInterrupt(current, host.now() - started, motion)) return false;
    stopFrame();
    stopIdle();
    current = motion;
    started = host.now();
    apply(sampleClip(CLIPS[motion], 0), motion);
    handle = host.frame(tick);
    return true;
  }

  function settle() {
    stopFrame();
    current = null;
    apply(REST, null);
  }

  return {
    play: start,
    idle(next) {
      palette = next;
      if (current === null) scheduleIdle();
      if (!next) stopIdle();
    },
    still(value) {
      if (value === isStill) return;
      isStill = value;
      if (value) { stopIdle(); settle(); } else scheduleIdle();
    },
    settle() { settle(); scheduleIdle(); },
    get current() { return current; },
    dispose() {
      disposed = true;
      stopFrame();
      stopIdle();
    },
  };
}
