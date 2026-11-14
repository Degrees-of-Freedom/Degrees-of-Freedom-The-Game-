import { useEffect, useRef, useState } from 'react';
import type { GameModel } from './model';

/** Tiny synthesized placement sound; no remote assets or autoplay dependency. */
export function useEditorSound(model: GameModel) {
  const [enabled, setEnabled] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef(model);
  useEffect(() => {
    if (previous.current !== model && enabled && audio.current?.state === 'running') {
      const context = audio.current, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(440 + model.members.length % 8 * 45, context.currentTime);
      gain.gain.setValueAtTime(0.025, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.13);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    previous.current = model;
  }, [model, enabled]);
  useEffect(() => () => { void audio.current?.close(); audio.current = null; }, []);
  async function toggle() {
    if (!enabled) {
      try { audio.current ??= new AudioContext(); await audio.current.resume(); }
      catch { return; }
    }
    setEnabled((value) => !value);
  }
  return { enabled, toggle };
}
