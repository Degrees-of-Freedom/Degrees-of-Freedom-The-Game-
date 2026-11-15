/**
 * Web Worker that runs the Rust solver off the main thread.
 *
 * The page stays responsive while an analysis runs, and the main thread can
 * stop an analysis at any moment by terminating this worker: WebAssembly
 * cannot be interrupted from inside, but a worker can be killed from outside.
 * See `runner.ts` for the main-thread side.
 */
import { handleRequest, type WorkerReply, type WorkerRequest } from './workerProtocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
};

const cache = {};
scope.onmessage = (event) => void handleRequest(event.data, cache, (reply) => scope.postMessage(reply));
