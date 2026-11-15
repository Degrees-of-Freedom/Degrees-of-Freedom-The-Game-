/**
 * Vitest setup for the web app. Node's fetch has no `file:` scheme, but the
 * Rust solver loads its module with `fetch(new URL('./dof_solver.wasm',
 * import.meta.url))`, which Vite resolves to a file URL under test. Serving
 * file URLs here lets tests use the app's own default solver instance.
 */
import { readFile } from 'node:fs/promises';

const networkFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input, 'file:///') : new URL(input.url);
  if (url.protocol !== 'file:') return networkFetch(input, init);
  try {
    return new Response(await readFile(url), { headers: { 'content-type': 'application/wasm' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;
