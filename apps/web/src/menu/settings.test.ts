import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  parseSettings,
  readSettings,
  writeSettings,
  type SettingsStorage,
} from "./settings";

function fakeStorage(initial?: string): SettingsStorage & { raw: string | null } {
  const box = { raw: initial ?? null };
  return {
    get raw() {
      return box.raw;
    },
    getItem: (key) => (key === SETTINGS_KEY ? box.raw : null),
    setItem: (key, value) => {
      if (key === SETTINGS_KEY) box.raw = value;
    },
  };
}

describe("menu settings", () => {
  it("uses defaults when nothing is stored or the value is corrupt", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid booleans and ignores mistyped or unknown fields", () => {
    expect(
      parseSettings(
        JSON.stringify({ sound: true, reducedMotion: "yes", extra: 1 }),
      ),
    ).toEqual({ ...DEFAULT_SETTINGS, sound: true });
  });

  it("round-trips through storage under dof.settings", () => {
    const storage = fakeStorage();
    const settings = { sound: true, reducedMotion: true, showHelpOnStart: true, primarySolver: "opensees-linear" };
    expect(writeSettings(settings, storage)).toBe(true);
    expect(JSON.parse(storage.raw!)).toEqual(settings);
    expect(readSettings(storage)).toEqual(settings);
  });

  it("survives unavailable or throwing storage", () => {
    const broken: SettingsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(writeSettings(DEFAULT_SETTINGS, broken)).toBe(false);
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(writeSettings(DEFAULT_SETTINGS, null)).toBe(false);
  });
});

describe("primary solver setting", () => {
  it("defaults to voxel and keeps a stored solver id", () => {
    expect(parseSettings(null).primarySolver).toBe("voxel");
    expect(parseSettings(JSON.stringify({ primarySolver: "opensees-linear" })).primarySolver).toBe("opensees-linear");
    expect(parseSettings(JSON.stringify({ primarySolver: 3 })).primarySolver).toBe("voxel");
    expect(parseSettings(JSON.stringify({ primarySolver: "" })).primarySolver).toBe("voxel");
  });
});
