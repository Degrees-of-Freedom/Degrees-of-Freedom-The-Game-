import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { getSettings, updateSettings, useSettings } from "../menu/settings";
import type { GameModel } from "./model";

/** The board and companion share one context. A suspended device drops its cue
 * so a later user gesture cannot flush sounds from a concealed turn. */
export function useEditorSound(model: GameModel, covered: boolean) {
  const { sound: enabled, masterVolume, effectsVolume } = useSettings();
  const audio = useRef<AudioContext | null>(null);
  const mix = useRef<{ master: GainNode; effects: GainNode } | null>(null);
  const unlocking = useRef(false);
  const voices = useRef(new Set<() => void>());
  const previous = useRef(model);
  const silence = useCallback(() => {
    for (const stop of voices.current) stop();
  }, []);

  const unlock = useCallback(() => {
    if (covered || document.hidden || !getSettings().sound || !navigator.userActivation?.isActive) return;
    try {
      if (!audio.current) {
        const context = new AudioContext(), settings = getSettings();
        const master = context.createGain(), effects = context.createGain();
        master.gain.value = settings.masterVolume / 100;
        effects.gain.value = settings.effectsVolume / 100;
        effects.connect(master);
        master.connect(context.destination);
        audio.current = context;
        mix.current = { master, effects };
      }
      if (audio.current.state === "suspended" && !unlocking.current) {
        unlocking.current = true;
        void audio.current.resume().catch(() => {}).finally(() => { unlocking.current = false; });
      }
    } catch { /* Sound is optional when the browser has no audio device. */ }
  }, [covered]);

  const tone = useCallback((from: number, to: number, duration: number) => {
    const context = audio.current;
    if (covered || document.hidden || !getSettings().sound || context?.state !== "running" || !mix.current) return;
    // Four simultaneous short accents bound rapid edits without queuing a burst.
    if (voices.current.size >= 4) voices.current.values().next().value?.();
    const oscillator = context.createOscillator(), gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0.025, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(mix.current.effects);
    function release() {
      oscillator.onended = null;
      oscillator.disconnect();
      gain.disconnect();
      voices.current.delete(stop);
    }
    function stop() {
      if (!voices.current.has(stop)) return;
      oscillator.stop();
      release();
    }
    oscillator.onended = release;
    voices.current.add(stop);
    oscillator.start();
    oscillator.stop(start + duration + 0.01);
    return stop;
  }, [covered]);

  useLayoutEffect(() => {
    if (mix.current) {
      mix.current.master.gain.value = enabled ? masterVolume / 100 : 0;
      mix.current.effects.gain.value = effectsVolume / 100;
    }
    if (!enabled || covered) silence();
  }, [enabled, covered, masterVolume, effectsVolume, silence]);
  useEffect(() => {
    const hide = () => { if (document.hidden) silence(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", silence);
    window.addEventListener("blur", silence);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", silence);
      window.removeEventListener("blur", silence);
      silence();
      mix.current?.effects.disconnect();
      mix.current?.master.disconnect();
      mix.current = null;
      if (audio.current && audio.current.state !== "closed") void audio.current.close().catch(() => {});
      audio.current = null;
    };
  }, [silence]);
  useEffect(() => {
    if (!enabled || covered) return;
    // Pointerup covers touch activation; keydown covers keyboard-only play.
    window.addEventListener("pointerup", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerup", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [enabled, covered, unlock]);
  useEffect(() => {
    if (previous.current !== model) {
      const frequency = 440 + (model.members.length % 8) * 45;
      tone(frequency, frequency, 0.12);
    }
    previous.current = model;
  }, [model, tone]);

  function toggle() {
    const sound = !getSettings().sound;
    if (!sound) silence();
    updateSettings({ sound });
    if (sound) unlock();
  }
  const foremanAccent = useCallback(() => {
    unlock();
    return tone(185, 110, 0.16);
  }, [tone, unlock]);
  return { enabled, toggle, foremanAccent };
}
