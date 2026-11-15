/** Head and recovery bytes change in one read/write transaction. Transactions on the
 * same store are serialized by IndexedDB, including between unrelated tabs. */
export const MATCH_DB = "dof-grow-dusk";
const STORE = "match";
export class StaleMatch extends Error {
  constructor() { super("Another tab changed the saved match. Reload to continue."); }
}

export async function openMatchDatabase(factory: IDBFactory = indexedDB) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(MATCH_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Grow Dusk tabs to open the save."));
    request.onsuccess = () => resolve(request.result);
  });
  db.onversionchange = () => db.close();

  function read(key: "head" | "previous"): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      tx.oncomplete = () => resolve(req.result ?? null);
      tx.onabort = () => reject(tx.error ?? new Error("Could not read the saved match."));
    });
  }

  function replace(expected: string | null, candidate: string, preservePrevious = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const records = tx.objectStore(STORE);
      let stale = false;
      const head = records.get("head");
      head.onsuccess = () => {
        const current = head.result ?? null;
        if (current === candidate) return; // An acknowledgement can be lost after a successful commit.
        if (current !== expected) { stale = true; tx.abort(); return; }
        if (current !== null && !preservePrevious) records.put(current, "previous");
        records.put(candidate, "head");
      };
      tx.onabort = () => reject(stale ? new StaleMatch() : tx.error ?? new Error("The save transaction failed."));
      tx.oncomplete = () => resolve();
    });
  }
  return { read, replace, close: () => db.close() };
}
export type MatchDatabase = Awaited<ReturnType<typeof openMatchDatabase>>;

