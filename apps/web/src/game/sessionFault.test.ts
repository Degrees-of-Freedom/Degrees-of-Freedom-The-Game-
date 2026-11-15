import { describe, expect, it, vi } from "vitest";
import { BACKUP_KEY, MAX_SESSION_CHARS, openSessionWriter, readSession, SESSION_KEY } from "./session";

const good = JSON.stringify({ version: 1, mode: "multiplayer", style: "grow-dusk",
  turn: { version: 1, seed: 23, events: [] } });
function fixture(raw: string, previous?: string) {
  const bytes = new Map([[SESSION_KEY, raw]]);
  if (previous !== undefined) bytes.set(BACKUP_KEY, previous);
  return { bytes, storage: { getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => { bytes.set(key, value); } } as Storage };
}

describe("saved match fault recovery", () => {
  it("limits size before JSON parsing", () => {
    const { storage } = fixture("[".repeat(MAX_SESSION_CHARS + 1));
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(readSession(storage)).toMatchObject({ status: "invalid", reason: expect.stringMatching(/size/) });
      expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });
  it.each(["{malformed", JSON.stringify({ version: 89 }), "x".repeat(MAX_SESSION_CHARS + 1)])(
    "recovers validated backup and preserves the original under the lock", async raw => {
      const { bytes, storage } = fixture(raw, good);
      const lock = vi.fn(async work => work());
      const writer = openSessionWriter(storage, { exclusive: lock });
      expect(writer.initial.status).toBe("invalid");
      expect(bytes.get(SESSION_KEY)).toBe(raw);
      expect(await writer.recover("backup")).toBe("saved");
      expect(bytes.get(SESSION_KEY + ":damaged")).toBe(raw);
      expect(lock).toHaveBeenCalledTimes(1);
      expect(readSession(storage)).toMatchObject({ status: "found", session: { turn: { seed: 23, turn: 1 } } });
    });
  it("preserves source if backup is invalid, recovery cannot archive, or another writer changes the head", async () => {
    const { storage, bytes } = fixture("damaged", "not a backup");
    const writer = openSessionWriter(storage, undefined);
    expect(await writer.recover("backup")).toBe("failed");
    expect(bytes.get(SESSION_KEY)).toBe("damaged");
    bytes.set(BACKUP_KEY, good);
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new DOMException("Quota", "QuotaExceededError"); });
    expect(await writer.recover("backup")).toBe("needs-copy");
    expect(await writer.recover("backup", true)).toBe("failed");
    expect(bytes.get(SESSION_KEY)).toBe("damaged");
    bytes.set(SESSION_KEY, good);
    expect(await writer.recover("backup")).toBe("conflict");
    expect(bytes.get(SESSION_KEY)).toBe(good);
  });
  it("keeps a complete head at every archive/write boundary and restores parent lineage", async () => {
    const { storage, bytes } = fixture(good);
    const writer = openSessionWriter(storage, undefined);
    if (writer.initial.status !== "found") throw Error("Invalid fixture");
    const active = writer.initial.session;
    const store = storage.setItem.bind(storage);
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === BACKUP_KEY) throw Error("interrupted after main write");
      store(key, value);
    });
    expect(writer.save(active)).toBe("saved");
    const revisionOne = bytes.get(SESSION_KEY)!;
    expect(readSession(storage).status).toBe("found");
    bytes.set(BACKUP_KEY, revisionOne);
    bytes.set(SESSION_KEY, "truncated");
    const repair = openSessionWriter(storage, undefined);
    vi.mocked(storage.setItem).mockImplementation((key, value) => {
      if (key === SESSION_KEY) throw Error("interrupted after quarantine");
      store(key, value);
    });
    expect(await repair.recover("backup")).toBe("failed");
    expect(bytes.get(SESSION_KEY)).toBe("truncated");
    expect(bytes.get(BACKUP_KEY)).toBe(revisionOne);
    expect(bytes.get(SESSION_KEY + ":damaged")).toBe("truncated");
    vi.mocked(storage.setItem).mockImplementation(store);
    expect(await repair.recover("backup")).toBe("saved");
    expect(JSON.parse(bytes.get(SESSION_KEY)!)).toMatchObject({ revision: 2, parent: 1, legacySource: good });
  });
});
