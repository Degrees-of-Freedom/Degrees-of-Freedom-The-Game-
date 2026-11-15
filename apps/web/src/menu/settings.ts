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
 */
export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  showHelpOnStart: boolean;
  jointDisplay: JointDisplay;
}

export const SETTINGS_KEY = "dof.settings";

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  sound: false,
  reducedMotion: false,
  showHelpOnStart: false,
  jointDisplay: "selected",
};

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
  return {
    sound: pick("sound"),
    reducedMotion: pick("reducedMotion"),
    showHelpOnStart: pick("showHelpOnStart"),
    jointDisplay: record.jointDisplay === "all" || record.jointDisplay === "off" ? record.jointDisplay : "selected",
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
