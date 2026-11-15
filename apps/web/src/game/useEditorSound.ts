import { useEffect, useRef, useState } from "react";
import type { GameModel } from "./model";

function playTone(context: AudioContext, from: number, to: number, duration: number) {
  const oscillator = context.createOscillator(), gain = context.createGain();
  const start = context.currentTime;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
  gain.gain.setValueAtTime(0.025, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start();
  oscillator.stop(start + duration + 0.01);
  return () => { gain.disconnect(); };
}

/** Tiny synthesized placement sound; no remote assets or autoplay dependency. */
export function useEditorSound(model: GameModel) {
  const [enabled, setEnabled] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef(model);
  useEffect(() => {
    if (
      previous.current !== model &&
      enabled &&
      audio.current?.state === "running"
    ) {
      const frequency = 440 + (model.members.length % 8) * 45;
      playTone(audio.current, frequency, frequency, 0.12);
    }
    previous.current = model;
  }, [model, enabled]);
  useEffect(
    () => () => {
      void audio.current?.close();
      audio.current = null;
    },
    [],
  );
  async function toggle() {
    if (!enabled) {
      try {
        audio.current ??= new AudioContext();
        await audio.current.resume();
      } catch {
        return;
      }
    }
    setEnabled((value) => !value);
  }
  // The companion requests this accent on the deliberate reveal only when its
  // saved audio setting is enabled. A suspended context never queues the cue.
  function foremanAccent() {
    if (document.hidden || !navigator.userActivation?.isActive) return;
    try {
      audio.current ??= new AudioContext();
      if (audio.current.state === "running") return playTone(audio.current, 185, 110, 0.16);
    } catch { /* The visual report is independent of output-device availability. */ }
  }
  return { enabled, toggle, foremanAccent };
}
