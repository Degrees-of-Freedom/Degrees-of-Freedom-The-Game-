import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LOCAL_OPENSEES_URL,
  SETTINGS_KEY,
  defaultSettings,
  normalizeServiceUrl,
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
    const settings = {
      sound: true,
      reducedMotion: true,
      showHelpOnStart: true,
      solver: "opensees" as const,
      openSeesUrl: "http://solver.test:9000",
    };
    expect(writeSettings(settings, storage)).toBe(true);
    expect(JSON.parse(storage.raw!)).toEqual(settings);
    expect(readSettings(storage)).toEqual(settings);
  });

  it("keeps a valid solver choice and service address, and falls back otherwise", () => {
    expect(
      parseSettings(
        JSON.stringify({ solver: "opensees", openSeesUrl: " https://solver.example/api/ " }),
      ),
    ).toMatchObject({ solver: "opensees", openSeesUrl: "https://solver.example/api" });
    expect(
      parseSettings(JSON.stringify({ solver: "voxel", openSeesUrl: "ftp://x" })),
    ).toMatchObject({
      solver: DEFAULT_SETTINGS.solver,
      openSeesUrl: DEFAULT_SETTINGS.openSeesUrl,
    });
    expect(parseSettings(JSON.stringify({ openSeesUrl: 8000 })).openSeesUrl).toBe(
      DEFAULT_SETTINGS.openSeesUrl,
    );
  });

  it("takes the default solver from build configuration", () => {
    expect(defaultSettings({})).toMatchObject({ solver: "rust", openSeesUrl: LOCAL_OPENSEES_URL });
    expect(defaultSettings({ VITE_SOLVER: "opensees" })).toMatchObject({
      solver: "opensees",
      openSeesUrl: LOCAL_OPENSEES_URL,
    });
    expect(defaultSettings({ VITE_OPENSEES_URL: "http://10.0.0.5:8000/" })).toMatchObject({
      solver: "opensees",
      openSeesUrl: "http://10.0.0.5:8000",
    });
    // An unusable configured address is ignored rather than trusted.
    expect(defaultSettings({ VITE_OPENSEES_URL: "not a url" })).toMatchObject({ solver: "rust" });
    expect(normalizeServiceUrl("javascript:alert(1)")).toBeNull();
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
