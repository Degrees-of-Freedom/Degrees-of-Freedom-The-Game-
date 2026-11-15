import { useEffect, useRef, useState } from "react";
import type { TurnState } from "../game/turns";
import type { InspectionInput, InspectionResponse } from "./releaseInspection.worker";

// Keep only the two most recent public physical responses across privacy
// handoffs. Recovering a rendered checkpoint never starts another turn solve.
const responses = new Map<string, InspectionResponse>();

/** Scope every field to this immutable board and terminate pending work on handoff. */
export function useReleaseInspection(turn: TurnState, enabled: boolean) {
  const { board, catalogue, nextId, version, turn: number } = turn;
  const identity = JSON.stringify([board, catalogue, nextId, version, number]);
  const [reading, setReading] = useState<{ board: typeof board; response?: InspectionResponse; error?: string } | undefined>(() => {
    const response = responses.get(identity);
    return response ? { board, response } : undefined;
  });
  const cached = useRef<{ board: typeof board; response: InspectionResponse } | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    if (cached.current?.board === board) { setReading(cached.current); return; }
    const recovered = responses.get(identity);
    if (recovered) { cached.current = { board, response: recovered }; setReading(cached.current); return; }
    let active = true;
    let worker: Worker | undefined;
    const failed = (error: string) => { if (active) setReading({ board, error }); worker?.terminate(); };
    try {
      worker = new Worker(new URL("./releaseInspection.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<InspectionResponse | { error: string }>) => {
        if ("error" in data) { failed(data.error); return; }
        if (active) {
          responses.set(identity, data);
          if (responses.size > 2) responses.delete(responses.keys().next().value!);
          cached.current = { board, response: data }; setReading(cached.current);
        }
        worker?.terminate();
      };
      worker.onerror = () => failed("The inspection worker could not finish.");
      worker.onmessageerror = () => failed("The inspection response could not be read.");
      worker.postMessage({ board, catalogue, nextId, version, turn: number } satisfies InspectionInput);
    } catch { failed("The inspection worker could not start."); }
    return () => { active = false; worker?.terminate(); };
  }, [enabled, board, catalogue, nextId, version, number, identity]);
  return reading?.board === board ? reading : undefined;
}
