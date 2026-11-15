import { describe, expect, it } from "vitest";
import { openSessionWriter, readSession, SESSION_KEY, writeSession, type Session } from "./session";
import { createTurnGame, endTurn } from "./turns";

function fixture() {
  const bytes = new Map<string, string>();
  let quota = false;
  const storage = {
    getItem: (k: string) => bytes.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (quota) throw new DOMException("Quota", "QuotaExceededError");
      bytes.set(k, v);
    },
  } as Storage;
  const initial: Session = { mode: "multiplayer", style: "grow-dusk", turn: createTurnGame(5) };
  const legacy = JSON.stringify({version: 1, mode: initial.mode, style: initial.style,
    turn: { version: 1, seed: 5, events: [] }});
  bytes.set(SESSION_KEY, legacy);
  return { storage, initial, legacy, setQuota: (value: boolean) => { quota = value; } };
}
function pass(session: Session): Session {
  const result = endTurn(session.turn!);
  if (!result.ok) throw Error(result.reason);
  return { ...session, turn: result.state };
}

describe("saved revision conflicts", () => {
  it("prevents an out-of-order turn from regressing the same writer's committed history", () => {
    const { storage, initial } = fixture();
    const author = openSessionWriter(storage, undefined);
    const second = pass(initial);
    expect(author.save(second)).toBe("saved");
    expect(author.save(pass(second))).toBe("saved");
    expect(author.save(second)).toBe("conflict");
    expect(writeSession(storage, second)).toBe(false);
    expect(readSession(storage)).toMatchObject({ session: { turn: { turn: 3 } } });
  });
  it("refuses a stale first write, including mode/style and a different valid replay", () => {
    const { storage, initial, legacy } = fixture();
    const author = openSessionWriter(storage, undefined);
    const stale = openSessionWriter(storage, undefined);
    const second = pass(initial);
    const third = pass(second);
    expect(author.save(second)).toBe("saved");
    expect(author.save(third)).toBe("saved");
    const head = storage.getItem(SESSION_KEY)!;
    expect(JSON.parse(head)).toMatchObject({ version: 2, revision: 2, parent: 1, legacySource: legacy });
    expect(stale.save(second)).toBe("conflict");
    expect(stale.save({ ...initial, mode: "creative", style: "kit" })).toBe("conflict");
    expect(storage.getItem(SESSION_KEY)).toBe(head);
    expect(readSession(storage)).toMatchObject({ session: { turn: { turn: 3 } } });
  });
  it("retries storage failure without advancing or adopting a different parent", () => {
    const { initial, storage, legacy, setQuota } = fixture();
    const author = openSessionWriter(storage, undefined);
    setQuota(true);
    const next = pass(initial);
    expect(author.save(next)).toBe("failed");
    expect(storage.getItem(SESSION_KEY)).toBe(legacy);
    setQuota(false);
    expect(author.save(next)).toBe("saved");
    expect(JSON.parse(storage.getItem(SESSION_KEY)!)).toMatchObject({ revision: 1, parent: 0 });
    const external = openSessionWriter(storage, undefined);
    expect(external.save(pass(next))).toBe("saved");
    expect(author.save({ ...next, style: "kit" })).toBe("conflict");
  });
  it("rechecks the parent after waiting for the lock and discards the losing queue", async () => {
    const { storage, initial } = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locks = { exclusive: async (work: () => void) => { await gate; work(); } };
    const results: string[] = [];
    const a = openSessionWriter(storage, locks);
    const b = openSessionWriter(storage, locks, status => results.push(status));
    const second = pass(initial);
    expect(a.save(second)).toBe("queued");
    expect(b.save({ ...initial, mode: "creative" })).toBe("queued");
    expect(b.save({ ...initial, style: "kit" })).toBe("queued");
    release();
    await Promise.all([a.settled(), b.settled()]);
    expect(results).toEqual(["conflict"]);
    expect(readSession(storage)).toMatchObject({ session: { mode: "multiplayer", turn: { turn: 2 } } });
  });
});
