import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it } from "vitest";
import { openMatchDatabase, StaleMatch } from "./releaseDatabase";

let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); });

it("commits a single winner against a shared parent across independent tabs", async () => {
  const first = await openMatchDatabase(factory), second = await openMatchDatabase(factory);
  await first.replace(null, "draw");
  const results = await Promise.allSettled([first.replace("draw", "draft A"), second.replace("draw", "draft B")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected");
  expect(rejected?.reason).toBeInstanceOf(StaleMatch);
  const winner = await first.read("head");
  expect(await second.read("previous")).toBe("draw");
  // A retry after a lost acknowledgement cannot rotate the backup a second time.
  await first.replace("draw", winner!);
  expect(await first.read("previous")).toBe("draw");
  first.close(); second.close();
});

it("rotates one previous complete revision, preserving it while recovering a damaged head", async () => {
  const db = await openMatchDatabase(factory);
  await db.replace(null, "draw");
  await db.replace("draw", "assessing");
  await db.replace("assessing", "damaged");
  await db.replace("damaged", "restored", true);
  expect(await db.read("previous")).toBe("assessing");
  expect(await db.read("head")).toBe("restored");
  db.close();
});
