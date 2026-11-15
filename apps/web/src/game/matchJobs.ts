import type { MatchJob } from "./matchWorker";
import type { MatchRecord } from "./releaseSave";
import type { TurnState } from "./turns";

/** Each job receives an immutable snapshot. Navigation aborts the worker and prevents
 * a late result from publishing into the next match. No private data is logged. */
export function runMatchJob(job: Extract<MatchJob, {kind:"restore"}>, signal: AbortSignal): Promise<MatchRecord>;
export function runMatchJob(job: Extract<MatchJob, {kind:"end"}>, signal: AbortSignal): Promise<TurnState>;
export function runMatchJob(job: MatchJob, signal: AbortSignal): Promise<MatchRecord | TurnState> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./matchWorker.ts", import.meta.url), {type:"module"});
    const stop = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { stop(); reject(new DOMException("Match closed", "AbortError")); };
    signal.addEventListener("abort", abort, {once:true});
    worker.onerror = () => { stop(); reject(new Error("The assessment worker could not run. Retry to resume this turn.")); };
    worker.onmessageerror = worker.onerror as () => void;
    worker.onmessage = ({data}) => {
      stop();
      if (data.ok) resolve(data.value);
      else reject(new Error(data.message));
    };
    worker.postMessage(job);
  });
}

