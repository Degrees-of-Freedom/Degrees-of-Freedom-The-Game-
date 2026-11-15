import type { SectionAction } from "./boardDiagrams";

/**
 * Board visualization modes for the Grow Dusk match. This is presentation
 * state only: it chooses which overlays to draw from the committed response
 * and never changes geometry, numerical values, connectivity or scoring.
 *
 * Joint freedoms are listed here as a mode, but their on/off state is the
 * persisted `jointDisplay` setting, so the Inspect drawer and the view panel
 * share one source of truth. Every other mode lives in {@link ViewModes}.
 */
export type ViewModeId =
  | "deflected" | "shadow" | "loadPath" | "joints" | "reactions" | "shear" | "moment" | "instability";

export type DeflectionStyle = "off" | "shape" | "shadow";
export type ShearAction = Extract<SectionAction, 1 | 2>;
export type MomentAction = Extract<SectionAction, 4 | 5>;

export interface ViewModes {
  /** `shape` moves members to the deflected position; `shadow` keeps them in place and adds a translucent deflected ghost. */
  readonly deflection: DeflectionStyle;
  readonly loadPath: boolean;
  /** Applied card gravity and signed support reactions. */
  readonly reactions: boolean;
  readonly shear: boolean;
  readonly shearAxis: ShearAction;
  readonly moment: boolean;
  readonly momentAxis: MomentAction;
  readonly instability: boolean;
  /** One switch for every in-scene text label (values, axis letters and peaks). */
  readonly labels: boolean;
  /** Displacement exaggeration; 0 selects the automatic scale. */
  readonly amplification: number;
}

export interface ViewModeInfo {
  readonly id: ViewModeId;
  readonly title: string;
  /** Short game-style hint shown on the tile. */
  readonly hint: string;
  /** Needs the solved committed response, not just the board. */
  readonly needsResponse: boolean;
}

/** Tile order in the view panel. */
export const VIEW_MODES: readonly ViewModeInfo[] = [
  { id: "loadPath", title: "Load path", hint: "Follow gravity to the ground", needsResponse: true },
  { id: "deflected", title: "Deflected shape", hint: "Bend the board by its sag", needsResponse: true },
  { id: "shadow", title: "Displacement shadow", hint: "Ghost of the sag, frame stays put", needsResponse: true },
  { id: "joints", title: "Joint freedoms", hint: "Every joint's six DOF", needsResponse: false },
  { id: "reactions", title: "Loads & reactions", hint: "What pushes and what pushes back", needsResponse: true },
  { id: "shear", title: "Shear diagram", hint: "Cutting force along members", needsResponse: true },
  { id: "moment", title: "Bending diagram", hint: "Bending along members", needsResponse: true },
  { id: "instability", title: "Instability", hint: "Mark witnessed mechanisms", needsResponse: true },
];

export const DISPLACEMENT_SCALES = [1, 10, 100, 500] as const;

/** Matches the board's previous default: deflected shape with loads and reactions. */
export const DEFAULT_VIEW_MODES: ViewModes = {
  deflection: "shape", loadPath: false, reactions: true,
  shear: false, shearAxis: 1, moment: false, momentAxis: 5,
  instability: false, labels: true, amplification: 0,
};

/** The Inspect drawer's single-choice overlay, kept for keyboard and scripted use. */
export type OverlayLayer = "reference" | "shape" | "path" | "combined" | "shadow" | "shadow-path";
export const OVERLAY_LAYERS: Readonly<Record<OverlayLayer, string>> = {
  reference: "Reference geometry",
  shape: "Deflected shape",
  path: "Load transfer",
  combined: "Deflected shape and load transfer",
  shadow: "Displacement shadow",
  "shadow-path": "Displacement shadow and load transfer",
};

export type ViewModeAction =
  | { type: "toggle"; mode: Exclude<ViewModeId, "joints"> }
  | { type: "shearAxis"; axis: ShearAction }
  | { type: "momentAxis"; axis: MomentAction }
  | { type: "labels"; on: boolean }
  | { type: "amplification"; value: number }
  | { type: "overlay"; layer: OverlayLayer }
  | { type: "clear" }
  | { type: "reset" };

/** Pure reducer. The two deflection styles are mutually exclusive; all other modes combine freely. */
export function viewModesReducer(state: ViewModes, action: ViewModeAction): ViewModes {
  switch (action.type) {
    case "toggle":
      switch (action.mode) {
        case "deflected": return { ...state, deflection: state.deflection === "shape" ? "off" : "shape" };
        case "shadow": return { ...state, deflection: state.deflection === "shadow" ? "off" : "shadow" };
        default: return { ...state, [action.mode]: !state[action.mode] };
      }
    case "shearAxis": return { ...state, shear: true, shearAxis: action.axis };
    case "momentAxis": return { ...state, moment: true, momentAxis: action.axis };
    case "labels": return { ...state, labels: action.on };
    case "amplification":
      return { ...state, amplification: Number.isFinite(action.value) && action.value > 0 ? action.value : 0 };
    case "overlay": {
      const layer = action.layer;
      const deflection: DeflectionStyle = layer === "shape" || layer === "combined" ? "shape"
        : layer === "shadow" || layer === "shadow-path" ? "shadow" : "off";
      return { ...state, deflection, loadPath: layer === "path" || layer === "combined" || layer === "shadow-path" };
    }
    // Clearing keeps the label preference and scale: they describe how to draw, not what.
    case "clear": return { ...state, deflection: "off", loadPath: false, reactions: false, shear: false, moment: false, instability: false };
    case "reset": return DEFAULT_VIEW_MODES;
  }
}

export function overlayLayer(state: ViewModes): OverlayLayer {
  if (state.deflection === "shape") return state.loadPath ? "combined" : "shape";
  if (state.deflection === "shadow") return state.loadPath ? "shadow-path" : "shadow";
  return state.loadPath ? "path" : "reference";
}

export function isModeActive(state: ViewModes, id: ViewModeId, jointsShown: boolean): boolean {
  switch (id) {
    case "deflected": return state.deflection === "shape";
    case "shadow": return state.deflection === "shadow";
    case "joints": return jointsShown;
    default: return state[id];
  }
}

export function activeModes(state: ViewModes, jointsShown: boolean): ViewModeId[] {
  return VIEW_MODES.filter(mode => isModeActive(state, mode.id, jointsShown)).map(mode => mode.id);
}

/** Whether the board must solve the committed structure to draw the active modes. */
export function needsResponse(state: ViewModes): boolean {
  return VIEW_MODES.some(mode => mode.needsResponse && isModeActive(state, mode.id, false));
}

/** Diagram actions to plot, shear first. */
export function diagramActions(state: ViewModes): SectionAction[] {
  return [...(state.shear ? [state.shearAxis] : []), ...(state.moment ? [state.momentAxis] : [])];
}

/**
 * Displayed displacement exaggeration. The automatic scale lifts the peak to
 * about 1.2 m on the board, between ×1 and ×500. Colour and inspected values
 * use calculated magnitudes and never depend on this scale.
 */
export function displacementScale(amplification: number, peakM: number | undefined): number {
  if (amplification > 0) return amplification;
  return peakM && Number.isFinite(peakM) && peakM > 0 ? Math.max(1, Math.min(500, Math.round(1.2 / peakM))) : 1;
}

/**
 * The committed response is solved on demand. Until the player opens it,
 * response-backed modes are kept in state but not drawn or reported active.
 */
export function visibleModes(state: ViewModes, responseOpen: boolean): ViewModes {
  return responseOpen ? state : { ...state, deflection: "off", loadPath: false, reactions: false, shear: false, moment: false, instability: false };
}

/**
 * Tile press. Pressing a response mode before the response is open opens it
 * with that mode shown, rather than hiding a mode the player never saw.
 * Joint freedoms are a setting and are handled by the caller.
 */
export function pressMode(state: ViewModes, mode: Exclude<ViewModeId, "joints">, responseOpen: boolean): ViewModes {
  if (!responseOpen && isModeActive(state, mode, false)) return state;
  return viewModesReducer(state, { type: "toggle", mode });
}
