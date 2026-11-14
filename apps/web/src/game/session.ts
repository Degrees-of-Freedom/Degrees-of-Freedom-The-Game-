import { z } from "zod";
import { replayTurnState, type TurnState } from "./turns";
import type { GameMode, PresentationStyle } from "./modes";

export const SESSION_KEY = "dof-runtime:session";
const fields = {
  mode: z.enum([
    "challenge",
    "creative",
    "multiplayer",
    "forensics",
    "load-space",
  ]),
  style: z.enum([
    "engineering",
    "grow",
    "grow-dusk",
    "levels",
    "blocks",
    "kit",
  ]),
  turn: z.unknown().nullable(),
};
const envelope = z.discriminatedUnion("version", [
  z.strictObject({ version: z.literal(1), ...fields }),
  z.strictObject({
    version: z.literal(2), ...fields,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    parent: z.number().int().nonnegative(),
    legacySource: z.string().optional(),
  }),
]);
export interface Session {
  mode: GameMode;
  style: PresentationStyle;
  turn: TurnState | null;
}
export type SessionRead =
  | { status: "missing" }
  | { status: "invalid"; reason?: string }
  | { status: "found"; session: Session };

/** A replayed event log validates card ownership and transitions at the storage boundary. */
export function readSession(storage: Storage): SessionRead {
  try {
    return decodeSession(storage.getItem(SESSION_KEY));
  } catch {
    return { status: "invalid" };
  }
}

function decodeSession(raw: string | null): SessionRead {
  try {
    if (raw === null) return { status: "missing" };
    const parsed = envelope.safeParse(JSON.parse(raw));
    if (!parsed.success || (parsed.data.version === 2 && parsed.data.parent !== parsed.data.revision - 1)) {
      return { status: "invalid" };
    }
    const replay = parsed.data.turn === null ? null : replayTurnState(parsed.data.turn);
    if (replay && !replay.ok) return { status: "invalid", reason: replay.reason };
    const turn = replay?.state ?? null;
    if (parsed.data.mode === "multiplayer" && !turn) return { status: "invalid" };
    return { status: "found", session: { mode: parsed.data.mode, style: parsed.data.style, turn } };
  } catch {
    return { status: "invalid" };
  }
}

export const SESSION_CONFLICT = "Another tab changed the saved session. Reload the saved game to continue.";
export const SESSION_UNSAVED = "This session is in memory only. The previous saved revision was preserved.";
type WriteResult = "saved" | "queued" | "conflict" | "failed";
export type SessionLocks = { exclusive: (work: () => void) => Promise<void> };

/** One writer belongs to one loaded view. Independent views never adopt an
 * external revision as their new parent without restoring its game state. */
export function openSessionWriter(
  storage: Storage, locks: SessionLocks | undefined,
  feedback: (result: WriteResult, lastSaved: Session | null) => void = () => {},
) {
  const source = storage.getItem(SESSION_KEY);
  const initial = decodeSession(source);
  let head = source;
  const metadata = source !== null && initial.status === "found" ? JSON.parse(source) : null;
  let revision: number = metadata?.version === 2 ? metadata.revision : 0;
  // The original v1 bytes and the migrated game are committed atomically.
  const legacySource: string | undefined = metadata?.version === 1 ? source! : metadata?.legacySource;
  let lastSaved = initial.status === "found" ? initial.session : null;
  let latestTurn = lastSaved?.turn ?? null;
  let stale = false;
  let pending = Promise.resolve();

  function current() {
    if (stale) return false;
    if (storage.getItem(SESSION_KEY) === head) return true;
    stale = true;
    feedback("conflict", lastSaved);
    return false;
  }
  function commit(session: Session): WriteResult {
    if (!current()) return "conflict";
    if (initial.status === "invalid" || revision >= Number.MAX_SAFE_INTEGER) return "failed";
    const serialized = JSON.stringify({
      version: 2, parent: revision, revision: revision + 1, legacySource,
      mode: session.mode,
      style: session.style,
      turn: session.turn && {
        version: session.turn.version,
        catalogue: session.turn.catalogue,
        seed: session.turn.seed,
        events: session.turn.events,
      },
    });
    storage.setItem(SESSION_KEY, serialized);
    head = serialized;
    revision++;
    lastSaved = session;
    return "saved";
  }
  function save(session: Session): WriteResult {
    try {
      if (!current()) return "conflict";
      if (initial.status === "invalid") return "failed";
      if (latestTurn && session.turn?.seed === latestTurn.seed &&
          (session.turn.turn < latestTurn.turn || (latestTurn.finished && !session.turn.finished))) {
        return "conflict";
      }
      if (!locks) {
        const result = commit(session);
        if (result === "saved") latestTurn = session.turn;
        return result;
      }
      latestTurn = session.turn;
      // Serialize successive drafts from this view and hold the origin-wide
      // lock across both the comparison and the single atomic replacement.
      pending = pending.then(() => locks.exclusive(() => {
        const result = commit(session);
        if (result !== "conflict") feedback(result, lastSaved);
      })).catch(() => { feedback("failed", lastSaved); });
      return "queued";
    } catch {
      return "failed";
    }
  }
  return { initial, save, current, settled: () => pending };
}

export function sessionLocks(): SessionLocks | undefined {
  if (typeof window === "undefined") return undefined; // synchronous memory storage in tests
  return { exclusive: async work => {
    if (!navigator.locks) throw new Error("Browser storage coordination unavailable");
    await navigator.locks.request(SESSION_KEY, { mode: "exclusive" }, work);
  } };
}

const standaloneWriters = new WeakMap<Storage, ReturnType<typeof openSessionWriter>>();

/** Standalone callers can update a session they created here. Resuming an
 * existing record requires a writer opened against its original parent. */
export function writeSession(storage: Storage, session: Session): boolean {
  try {
    let writer = standaloneWriters.get(storage);
    if (!writer) {
      writer = openSessionWriter(storage, sessionLocks());
      if (writer.initial.status !== "missing") return false;
      standaloneWriters.set(storage, writer);
    }
    const result = writer.save(session);
    return result === "saved" || result === "queued";
  } catch { return false; }
}
