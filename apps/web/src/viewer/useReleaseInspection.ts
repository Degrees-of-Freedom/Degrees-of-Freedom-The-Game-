import { useEffect, useState } from "react";
import type { TurnState } from "../game/turns";
import type { InspectionInput, InspectionResponse } from "./releaseInspection.worker";

/** Scope every field to this immutable board and terminate pending work on handoff. */
export function useReleaseInspection(turn: TurnState, enabled: boolean) {
  const { board, catalogue, nextId, version, turn: number } = turn;
  const [reading, setReading] = useState<{ board: typeof board; response?: InspectionResponse; error?: string }>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let worker: Worker | undefined;
    const failed = (error: string) => { if (active) setReading({ board, error }); worker?.terminate(); };
    try {
      worker = new Worker(new URL("./releaseInspection.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<InspectionResponse | { error: string }>) => {
        if ("error" in data) { failed(data.error); return; }
        if (active) setReading({ board, response: data });
        worker?.terminate();
      };
      worker.onerror = () => failed("The inspection worker could not finish.");
      worker.onmessageerror = () => failed("The inspection response could not be read.");
      worker.postMessage({ board, catalogue, nextId, version, turn: number } satisfies InspectionInput);
    } catch { failed("The inspection worker could not start."); }
    return () => { active = false; worker?.terminate(); };
  }, [enabled, board, catalogue, nextId, version, number]);
  return reading?.board === board ? reading : undefined;
}
