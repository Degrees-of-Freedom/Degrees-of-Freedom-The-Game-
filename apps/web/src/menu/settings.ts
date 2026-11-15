import { useSyncExternalStore } from "react";
import type { JointDisplay } from "../viewer/jointPermissions";

/**
 * Menu preferences, kept in `localStorage["dof.settings"]`.
 *
 * - `reducedMotion` switches off the menu animations (menu pages and pause menu).
 * - `showHelpOnStart` opens the workspace controls panel when /play mounts. It
 *   defaults to off because that panel sits over the brand chip and mode label.
 * - `sound` is stored only: the editor sound (`game/useEditorSound`) keeps its
 *   own in-component state and exposes no external mute hook, so nothing reads
 *   this value yet.
 * - `solver` picks the backend of the workspace's structural check: the Rust
 *   solver running in the browser, or an OpenSees service at `openSeesUrl`.
 *   `solver/index.ts` turns the pair into an adapter.
 */
export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  showHelpOnStart: boolean;
  jointDisplay: JointDisplay;
  solver: SolverChoice;
  openSeesUrl: string;
}

/** Structural solver backends the player can choose between. */
export type SolverChoice = "rust" | "opensees";
export const SOLVER_CHOICES: readonly SolverChoice[] = ["rust", "opensees"];

/** Port used by `npm run dev:opensees`. */
export const LOCAL_OPENSEES_URL = "http://localhost:8000";

export const SETTINGS_KEY = "dof.settings";

/** An absolute http(s) address without a trailing slash, or null. */
export function normalizeServiceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Defaults, with the solver ones taken from build-time configuration:
 * `VITE_OPENSEES_URL` sets the service address and makes OpenSees the default,
 * and `VITE_SOLVER=opensees` makes the local service the default. Without
 * either, the in-browser Rust solver is the default. A choice the player saves
 * in Settings overrides these.
 */
export function defaultSettings(
  env: { VITE_OPENSEES_URL?: string; VITE_SOLVER?: string } = {},
): Settings {
  const configured = env.VITE_OPENSEES_URL
    ? normalizeServiceUrl(env.VITE_OPENSEES_URL)
    : null;
  return {
    sound: false,
    reducedMotion: false,
    showHelpOnStart: false,
    jointDisplay: "selected",
    solver: configured || env.VITE_SOLVER === "opensees" ? "opensees" : "rust",
    openSeesUrl: configured ?? LOCAL_OPENSEES_URL,
  };
}

export const DEFAULT_SETTINGS: Readonly<Settings> = defaultSettings(
  import.meta.env ?? {},
);

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Unknown, missing or mistyped fields fall back to their defaults. */
export function parseSettings(raw: string | null): Settings {
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    /* corrupt value: use defaults */
  }
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const pick = (key: "sound" | "reducedMotion" | "showHelpOnStart") =>
    typeof record[key] === "boolean"
      ? (record[key] as boolean)
      : DEFAULT_SETTINGS[key];
  const solver = SOLVER_CHOICES.find((choice) => choice === record.solver);
  const openSeesUrl =
    typeof record.openSeesUrl === "string"
      ? normalizeServiceUrl(record.openSeesUrl)
      : null;
  return {
    sound: pick("sound"),
    reducedMotion: pick("reducedMotion"),
    showHelpOnStart: pick("showHelpOnStart"),
    jointDisplay: record.jointDisplay === "all" || record.jointDisplay === "off" ? record.jointDisplay : "selected",
    solver: solver ?? DEFAULT_SETTINGS.solver,
    openSeesUrl: openSeesUrl ?? DEFAULT_SETTINGS.openSeesUrl,
  };
}

function browserStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSettings(
  storage: SettingsStorage | null = browserStorage(),
): Settings {
  try {
    return parseSettings(storage ? storage.getItem(SETTINGS_KEY) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Returns false when storage is unavailable; the in-memory value still applies. */
export function writeSettings(
  settings: Settings,
  storage: SettingsStorage | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

// Shared in-memory copy so the menu pages, the pause menu and the workspace agree.
let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return (current ??= readSettings());
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...getSettings(), ...patch };
  writeSettings(current);
  listeners.forEach((listener) => listener());
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULT_SETTINGS });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

