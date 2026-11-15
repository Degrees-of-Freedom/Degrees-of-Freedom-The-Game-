/**
 * Release a WebGL context without blocking the main thread.
 *
 * `WEBGL_lose_context.loseContext()` (what three's `forceContextLoss()` calls)
 * destroys the context's GPU command buffer with a synchronous IPC. Chromium
 * answers it only after the GPU process has executed every command already
 * queued for that context. A continuously rendering board can queue several
 * frames ahead of a software rasteriser (SwiftShader, as in CI, or any blocked
 * GPU), so calling it during an unmount stalled the page for 1–6 s. The
 * stall happened inside the click that unmounted the board (Menu → pause),
 * because React runs passive-effect cleanups synchronously for discrete input.
 *
 * Instead, the caller stops rendering and disposes its resources as usual, and
 * this helper inserts a fence after the last queued command. It polls the
 * fence, which never blocks: WebGL2 sync status is a cached value refreshed
 * between tasks. Once the GPU has drained, it releases the context, which is
 * then cheap. The context is still released explicitly, never left for GC,
 * so repeated handoffs cannot exhaust the browser's live-context limit.
 */

/** Injectable timers so the release schedule is testable without a browser. */
export interface ReleaseHost {
  now(): number;
  timeout(callback: () => void, ms: number): unknown;
}

const browserHost: ReleaseHost = {
  now: () => performance.now(),
  timeout: (callback, ms) => window.setTimeout(callback, ms),
};

/** The subset of WebGL2 used here, so tests can supply a fake context. */
export type FencedContext = Pick<WebGL2RenderingContext,
  "isContextLost" | "fenceSync" | "flush" | "getSyncParameter" | "deleteSync" | "getExtension"
  | "SYNC_GPU_COMMANDS_COMPLETE" | "SYNC_STATUS" | "SIGNALED">;
/** three's renderer is typed as possibly WebGL1. Three r163+ requires WebGL2
 * at runtime, but a fenceless context is still released, one task later. */
export type ReleasableContext = FencedContext | Pick<WebGLRenderingContext, "isContextLost" | "flush" | "getExtension">;

export interface ReleaseOptions {
  host?: ReleaseHost;
  /** Delay between fence polls, in milliseconds. */
  pollMs?: number;
  /** Release anyway after this long, so a fence that never signals cannot keep
   * the context alive. The render loop has stopped, so the GPU queue is finite
   * and this is only a safety bound. */
  maxWaitMs?: number;
}

/**
 * Schedule the release of `gl` once the GPU has finished its queued work.
 * Call it after the render loop is stopped and the renderer is disposed. It
 * returns at once. Release happens in a later task, and never twice.
 */
export function releaseContextWhenIdle(gl: ReleasableContext,
  { host = browserHost, pollMs = 50, maxWaitMs = 20_000 }: ReleaseOptions = {}): void {
  if (gl.isContextLost()) return;
  const fenced = "fenceSync" in gl ? gl : null;
  const fence = fenced?.fenceSync(fenced.SYNC_GPU_COMMANDS_COMPLETE, 0) ?? null;
  // Submit the fence now. Otherwise it may wait in the client-side buffer and
  // never reach the GPU process.
  gl.flush();
  const deadline = host.now() + maxWaitMs;
  const poll = () => {
    if (gl.isContextLost()) return; // Lost meanwhile: nothing is left to release.
    const drained = !fenced || !fence || fenced.getSyncParameter(fence, fenced.SYNC_STATUS) === fenced.SIGNALED;
    if (!drained && host.now() < deadline) { host.timeout(poll, pollMs); return; }
    if (fence) fenced?.deleteSync(fence);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  host.timeout(poll, 0);
}
