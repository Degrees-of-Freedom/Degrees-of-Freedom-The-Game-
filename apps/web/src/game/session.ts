import { z } from 'zod';
import { parseTurnState, type TurnState } from './turns';
import type { GameMode, PresentationStyle } from './modes';

const key = 'dof-runtime:session';
const envelope = z.strictObject({
  version: z.literal(1),
  mode: z.enum(['challenge', 'creative', 'multiplayer', 'forensics', 'load-space']),
  style: z.enum(['engineering', 'grow', 'grow-dusk', 'levels', 'blocks', 'kit']),
  turn: z.unknown().nullable(),
});
export interface Session { mode: GameMode; style: PresentationStyle; turn: TurnState | null }
export type SessionRead = { status: 'missing' } | { status: 'invalid' } | { status: 'found'; session: Session };

/** A replayed event log validates card ownership and transitions at the storage boundary. */
export function readSession(storage: Storage): SessionRead {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { status: 'missing' };
    const parsed = envelope.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'invalid' };
    const turn = parsed.data.turn === null ? null : parseTurnState(parsed.data.turn);
    if ((parsed.data.turn !== null && !turn) || (parsed.data.mode === 'multiplayer' && !turn)) return { status: 'invalid' };
    return { status: 'found', session: { ...parsed.data, turn } };
  } catch { return { status: 'invalid' }; }
}

/** Preserve unreadable and future session data rather than overwriting it. */
export function writeSession(storage: Storage, session: Session): boolean {
  try {
    if (readSession(storage).status === 'invalid') return false;
    storage.setItem(key, JSON.stringify({ version: 1, mode: session.mode, style: session.style,
      turn: session.turn && { version: session.turn.version, seed: session.turn.seed, events: session.turn.events } }));
    return true;
  } catch { return false; }
}
