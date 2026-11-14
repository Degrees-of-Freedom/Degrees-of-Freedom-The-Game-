import { z } from "zod";
import { replayTurnState, type TurnState } from "./turns";
import type { GameMode, PresentationStyle } from "./modes";

const key = "dof-runtime:session";
const validatedWrites = new WeakMap<Storage, string>();
const envelope = z.strictObject({
  version: z.literal(1),
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
});
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
    return decodeSession(storage.getItem(key));
  } catch {
    return { status: "invalid" };
  }
}

function decodeSession(raw: string | null): SessionRead {
  try {
    if (raw === null) return { status: "missing" };
    const parsed = envelope.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: "invalid" };
    const replay = parsed.data.turn === null ? null : replayTurnState(parsed.data.turn);
    if (replay && !replay.ok) return { status: "invalid", reason: replay.reason };
    const turn = replay?.state ?? null;
    if (parsed.data.mode === "multiplayer" && !turn) return { status: "invalid" };
    return { status: "found", session: { ...parsed.data, turn } };
  } catch {
    return { status: "invalid" };
  }
}

/** Preserve unreadable and future session data rather than overwriting it. */
export function writeSession(storage: Storage, session: Session): boolean {
  try {
    const raw = storage.getItem(key);
    if (raw !== null && raw !== validatedWrites.get(storage) &&
      decodeSession(raw).status === "invalid") return false;
    const serialized = JSON.stringify({
      version: 1,
      mode: session.mode,
      style: session.style,
      turn: session.turn && {
        version: session.turn.version,
        seed: session.turn.seed,
        events: session.turn.events,
      },
    });
    storage.setItem(key, serialized);
    // The unchanged bytes came from a trusted transition. Revalidate any
    // external replacement before writing, including another tab's changes.
    validatedWrites.set(storage, serialized);
    return true;
  } catch {
    return false;
  }
}
