import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { TurnState } from "../../game/turns";
import { updateSettings, useSettings } from "../../menu/settings";
import { computeLoadPath } from "../../evaluator/loadPath";
import { boardDiagram } from "../../viewer/boardDiagrams";
import { deformationField } from "../../viewer/deformationField";
import { useReleaseInspection } from "../../viewer/useReleaseInspection";
import { buildLegends, type ResponseAvailability } from "../../viewer/viewLegends";
import {
  DEFAULT_VIEW_MODES, diagramActions, displacementScale, needsResponse, pressMode, viewModesReducer, visibleModes,
  type ViewModeAction, type ViewModeId,
} from "../../viewer/viewModes";

/** Keys typed into form controls never toggle the panel. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));

/**
 * Board view state for the Grow Dusk match: view-mode reducer, the on-demand
 * committed-response solve, derived overlays and their legends. Everything
 * here is presentation; it reads the committed public board only.
 */
export function useBoardView(turn: TurnState, draft: boolean, jointCount: number) {
  const settings = useSettings();
  const [state, dispatchMode] = useReducer(viewModesReducer, DEFAULT_VIEW_MODES);
  const [responseOpen, setResponseOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const jointsShown = settings.jointDisplay === "all";
  const modes = visibleModes(state, responseOpen);

  const reading = useReleaseInspection(turn, responseOpen && !draft);
  const result = draft ? null : reading?.response?.result ?? null;
  const field = useMemo(() => result && modes.deflection !== "off" ? deformationField(result, 0) : undefined, [result, modes.deflection]);
  const { shear, shearAxis, moment, momentAxis } = modes;
  const diagrams = useMemo(() => result
    ? diagramActions({ ...DEFAULT_VIEW_MODES, shear, shearAxis, moment, momentAxis }).map(action => boardDiagram(result, action))
    : [], [result, shear, shearAxis, moment, momentAxis]);
  const path = useMemo(() => result && modes.loadPath ? computeLoadPath(result, 0) : null, [result, modes.loadPath]);
  const scale = displacementScale(modes.amplification, field?.peakM);

  const response: ResponseAvailability = draft ? { state: "draft" }
    : reading?.error ? { state: "error", message: reading.error }
    : result ? { state: "ready" } : { state: "pending" };
  // Cheap and pure: rebuilt every render so legends always match the drawn overlays.
  const legends = buildLegends({
    modes, jointsShown, response, scale, jointCount,
    peakM: field?.peakM, maxForceKN: path?.maxForce, diagrams,
    instabilityWitnessed: !!result?.combos[0]?.components?.some(scope => scope.instabilityWitness),
    appliedGravityKN: turn.board.loads.reduce((sum, load) => sum + load.magnitude, 0),
  });

  const openResponse = useCallback(() => setResponseOpen(true), []);
  /** Tile press: joint freedoms are the persisted joint-display setting; response modes open the solve. */
  const press = useCallback((mode: ViewModeId) => {
    if (mode === "joints") { updateSettings({ jointDisplay: jointsShown ? "selected" : "all" }); return; }
    const next = pressMode(state, mode, responseOpen);
    if (next !== state) dispatchMode({ type: "toggle", mode });
    if (needsResponse(next)) setResponseOpen(true);
  }, [state, responseOpen, jointsShown]);
  const dispatch = useCallback((action: ViewModeAction) => {
    // Clear and Reset also return joint glyphs to the default selected-joint display.
    if (action.type === "clear" || action.type === "reset") updateSettings({ jointDisplay: "selected" });
    if (action.type === "shearAxis" || action.type === "momentAxis" || action.type === "overlay") setResponseOpen(true);
    dispatchMode(action);
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "v" || event.ctrlKey || event.metaKey || event.altKey || event.repeat || typing(event.target)) return;
      event.preventDefault();
      setPanelOpen(open => !open);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return { state, modes, dispatch, press, responseOpen, openResponse, reading, result, field, diagrams, scale, legends,
    jointsShown, panelOpen, setPanelOpen };
}
