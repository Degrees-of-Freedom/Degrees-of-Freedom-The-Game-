import type { MatchJob } from "./matchWorker";
import type { MatchRecord } from "./releaseSave";
import type { TurnState } from "./turns";

export class InvalidMatch extends Error {}

/** Each job receives an immutable snapshot. Navigation aborts the worker and prevents
 * a late result from publishing into the next match. No private data is logged. */
export function runMatchJob(job: Extract<MatchJob, {kind:"restore"}>, signal: AbortSignal): Promise<MatchRecord>;
export function runMatchJob(job: Extract<MatchJob, {kind:"end"}>, signal: AbortSignal): Promise<TurnState>;
export function runMatchJob(job: MatchJob, signal: AbortSignal): Promise<MatchRecord | TurnState> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./matchWorker.ts", import.meta.url), {type:"module"});
    // One End can include before/after assessment and three physical corrections.
    // A full restore may replay 16 such transactions. Preserve the confirmed intent
    // on infrastructure failure so a late result can never settle a replacement.
    const deadline = setTimeout(() => {
      stop(); reject(new Error("The assessment worker timed out. The confirmed match is available for retry or private export."));
    }, job.kind === "end" ? 10_000 : 60_000);
    const stop = () => { clearTimeout(deadline); worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { stop(); reject(new DOMException("Match closed", "AbortError")); };
    signal.addEventListener("abort", abort, {once:true});
    worker.onerror = () => { stop(); reject(new Error("The assessment worker could not run. Retry to resume this turn.")); };
    worker.onmessageerror = () => { stop(); reject(new Error("The worker returned an unreadable result. Retry this turn.")); };
    worker.onmessage = ({data}) => {
      stop();
      if (data.ok) resolve(data.value);
      else reject(data.kind === "invalid" ? new InvalidMatch(data.message) : new Error(data.message));
    };
    worker.postMessage(job);
  });
}

