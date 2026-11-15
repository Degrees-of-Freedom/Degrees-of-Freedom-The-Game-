import { z } from "zod";
import { replayTurnState, type TurnState } from "./turns";
import type { GameMode, PresentationStyle } from "./modes";

export const SESSION_KEY = "dof-runtime:session";
export const BACKUP_KEY = SESSION_KEY + ":previous";
const DAMAGED_KEY = SESSION_KEY + ":damaged";
// UTF-16 code units. Check the limit before parsing or replaying an import.
export const MAX_SESSION_CHARS = 2_000_000;
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
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    parent: z.number().int().nonnegative().optional(),
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
    if (raw.length > MAX_SESSION_CHARS) return { status: "invalid", reason: "Saved session exceeds the supported size." };
    const value = JSON.parse(raw);
    if (Number.isSafeInteger(value?.version) && value.version > 2)
      return { status: "invalid", reason: `Save format version ${value.version} is newer than this game supports.` };
    const parsed = envelope.safeParse(value);
    if (!parsed.success || (parsed.data.version === 2 && ((parsed.data.revision === undefined) !== (parsed.data.parent === undefined) || (parsed.data.revision !== undefined && parsed.data.parent !== parsed.data.revision - 1)))) {
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
export const SESSION_UNSAVED = "This change could not be saved. The previous saved revision was preserved.";
type WriteResult = "saved" | "queued" | "conflict" | "failed";
export type SessionLocks = { exclusive: (work: () => void) => Promise<void> };

/** One writer belongs to one loaded view. Independent views never adopt an
 * external revision as their new parent without restoring its game state. */
export function openSessionWriter(
  storage: Storage, locks: SessionLocks | undefined,
  feedback: (result: WriteResult, lastSaved: Session | null, attempted?: Session) => void = () => {},
) {
  const source = storage.getItem(SESSION_KEY);
  const initial = decodeSession(source);
  let head = source;
  const metadata = source !== null && initial.status === "found" ? JSON.parse(source) : null;
  let revision: number = metadata?.version === 2 ? (metadata.revision ?? 0) : 0;
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
  function serialize(session: Session, parent = revision, legacy = legacySource) {
    return JSON.stringify({
      version: 2, parent, revision: parent + 1, legacySource: legacy,
      mode: session.mode,
      style: session.style,
      turn: session.turn && {
        version: session.turn.version,
        catalogue: session.turn.catalogue,
        seed: session.turn.seed,
        events: session.turn.events,
      },
    });
  }
  function commit(session: Session, recovering = false, parent = revision, legacy = legacySource): WriteResult {
    if (!current()) return "conflict";
    if ((initial.status === "invalid" && !recovering) || parent >= Number.MAX_SAFE_INTEGER) return "failed";
    const serialized = serialize(session, parent, legacy);
    if (serialized.length > MAX_SESSION_CHARS) return "failed";
    // Replace the entire head before spending any remaining quota on a
    // backup. A crash at either boundary leaves a complete primary revision.
    storage.setItem(SESSION_KEY, serialized);
    if (head !== null && !recovering) {
      try { storage.setItem(BACKUP_KEY, head); } catch { /* older backup is retained */ }
    }
    head = serialized;
    revision = parent + 1;
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
        if (result !== "conflict") feedback(result, lastSaved, session);
      })).catch(() => { feedback("failed", lastSaved, session); });
      return "queued";
    } catch {
      return "failed";
    }
  }
  /** Explicit recovery preserves the exact unreadable bytes and compares
   * the original head under the same lock used for normal writers. */
  async function recover(replacement: Session | "backup", hasExternalCopy = false): Promise<WriteResult | "needs-copy"> {
    if (initial.status !== "invalid" || source === null) return "failed";
    let outcome: WriteResult | "needs-copy" = "failed";
    const repair = () => {
      if (!current()) { outcome = "conflict"; return; }
      const rawBackup = replacement === "backup" ? storage.getItem(BACKUP_KEY) : null;
      const backup = rawBackup === null ? null : decodeSession(rawBackup);
      const target = replacement === "backup" ? (backup?.status === "found" ? backup.session : null) : replacement;
      if (!target) return;
      // Only read revision metadata after validating the size, schema and
      // replay. The restored history descends from the known-good revision.
      const info = rawBackup !== null ? JSON.parse(rawBackup) : null;
      try { storage.setItem(DAMAGED_KEY, source); }
      catch {
        if (!hasExternalCopy) { outcome = "needs-copy"; return; }
      }
      outcome = commit(target, true, info?.revision ?? 0, info?.version === 1 ? rawBackup! : info?.legacySource);
    };
    try {
      if (locks) await locks.exclusive(repair);
      else repair();
    } catch { return "failed"; }
    return outcome;
  }
  function hasBackup() {
    try { return decodeSession(storage.getItem(BACKUP_KEY)).status === "found"; }
    catch { return false; }
  }
  return { initial, save, current, recover, serialize, revision: () => lastSaved ? revision : null,
    original: () => source, hasBackup,
    settled: () => pending };
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
