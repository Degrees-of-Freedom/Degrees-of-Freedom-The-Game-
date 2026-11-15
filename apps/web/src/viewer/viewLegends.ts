import { boardActions, type SectionAction } from "./boardDiagrams";
import { displacementGradient } from "./contourRamp";
import { DIAGRAM_COLORS, INSTABILITY_COLOR, JOINT_AXIS_COLORS, LOAD_PATH_ARROWS, LOAD_PATH_COLORS, REFERENCE_COLOR, RESULT_ARROWS } from "./viewPalette";
import { formatValue as number, isNegligible } from "./viewFormat";
import { activeModes, VIEW_MODES, type ViewModeId, type ViewModes } from "./viewModes";

/** Shapes the legend renders as small CSS/SVG keys. Every key pairs colour with shape or text. */
export type SwatchShape = "bar" | "thin" | "thick" | "arrow" | "dash" | "ghost" | "dot" | "zigzag" | "arc" | "hatch" | "cross";

export interface LegendSwatch {
  readonly shape: SwatchShape;
  readonly color: string;
  readonly label: string;
}

export interface LegendRamp {
  readonly gradient: string;
  readonly min: string;
  readonly max: string;
}

export interface ViewLegend {
  readonly id: ViewModeId;
  readonly title: string;
  readonly swatches: readonly LegendSwatch[];
  readonly ramp?: LegendRamp;
  readonly notes: readonly string[];
  /** Set when the mode cannot draw yet; replaces the keys with an explanation. */
  readonly status?: string;
  readonly pending?: boolean;
}

/** Why committed response data is or is not available to the board. */
export type ResponseAvailability =
  | { readonly state: "ready" }
  | { readonly state: "draft" }
  | { readonly state: "pending" }
  | { readonly state: "error"; readonly message: string };

export interface LegendInput {
  readonly modes: ViewModes;
  readonly jointsShown: boolean;
  readonly response: ResponseAvailability;
  /** Peak calculated translational displacement of the verified scope, metres. */
  readonly peakM?: number;
  readonly scale: number;
  /** Largest displayed transfer, kN. */
  readonly maxForceKN?: number;
  readonly diagrams: readonly { readonly action: SectionAction; readonly peak: number; readonly series: readonly unknown[] }[];
  readonly instabilityWitnessed?: boolean;
  readonly jointCount: number;
  readonly appliedGravityKN?: number;
}

const title = (id: ViewModeId) => VIEW_MODES.find(mode => mode.id === id)?.title ?? id;

function responseStatus(response: ResponseAvailability): string | undefined {
  switch (response.state) {
    case "ready": return undefined;
    case "draft": return "Finish or cancel the draft to see the committed response.";
    case "pending": return "Checking the committed structure…";
    case "error": return response.message;
  }
}

function deflectionLegend(id: "deflected" | "shadow", input: LegendInput): ViewLegend {
  const peak = input.peakM ?? 0;
  const shadow = id === "shadow";
  return {
    id, title: title(id),
    ramp: { gradient: displacementGradient, min: "0 mm", max: `${number(1000 * peak)} mm` },
    swatches: shadow
      ? [{ shape: "bar", color: LOAD_PATH_COLORS.idle, label: "Members at rest" }, { shape: "ghost", color: "#f2df3a", label: "Deflected ghost" },
        { shape: "dash", color: REFERENCE_COLOR, label: "Joint travel" }]
      : [{ shape: "bar", color: "#f2df3a", label: "Deflected member" }, { shape: "dash", color: REFERENCE_COLOR, label: "Reference shape" }],
    notes: [
      `Shown ×${input.scale}. Colours use calculated displacement, not the exaggeration.`,
      ...(isNegligible(1000 * peak) ? ["No verified displacement on this board."] : []),
    ],
  };
}

const builders: Record<ViewModeId, (input: LegendInput) => ViewLegend> = {
  loadPath: input => ({
    id: "loadPath", title: title("loadPath"),
    swatches: [
      { shape: "arrow", color: LOAD_PATH_ARROWS.tension, label: "Tension" },
      { shape: "arrow", color: LOAD_PATH_ARROWS.compression, label: "Compression" },
      { shape: "arrow", color: LOAD_PATH_ARROWS.bending, label: "Mixed / bending" },
      { shape: "thin", color: LOAD_PATH_COLORS.idle, label: "No transfer" },
    ],
    notes: [
      isNegligible(input.maxForceKN) ? "No load is transferred on this board yet."
        : `Thickness grows with transferred force, up to ${number(input.maxForceKN ?? 0)} kN.`,
      "Arrows point toward receiving supports. Static equilibrium, not travel in time.",
    ],
  }),
  deflected: input => deflectionLegend("deflected", input),
  shadow: input => deflectionLegend("shadow", input),
  joints: input => ({
    id: "joints", title: title("joints"),
    swatches: [
      ...["X", "Y", "Z"].map((axis, i) => ({ shape: "dot" as const, color: JOINT_AXIS_COLORS[i], label: `${axis} axis` })),
      { shape: "bar", color: "#ffffdb", label: "Straight · slide" },
      { shape: "arc", color: "#ffffdb", label: "Curve · spin" },
      { shape: "zigzag", color: "#ffffdb", label: "Zigzag · spring" },
      { shape: "hatch", color: "#ffffdb", label: "Striped base · ground" },
      { shape: "cross", color: "#ffffdb", label: "Cross · conflict" },
    ],
    notes: [
      "Flat bar ends lock a motion; arrowhead ends leave it free.",
      `${input.jointCount} joint${input.jointCount === 1 ? "" : "s"} on the board.`,
    ],
  }),
  reactions: input => ({
    id: "reactions", title: title("reactions"),
    swatches: [
      { shape: "arrow", color: RESULT_ARROWS.load, label: "Card gravity" },
      { shape: "arrow", color: RESULT_ARROWS.reaction, label: "Support reaction" },
    ],
    notes: [
      ...(input.appliedGravityKN !== undefined ? [`Applied card gravity ${number(input.appliedGravityKN)} kN.`] : []),
      "Signed reactions include uplift. Inspect shows all six components.",
    ],
  }),
  shear: input => diagramLegend("shear", input),
  moment: input => diagramLegend("moment", input),
  instability: input => ({
    id: "instability", title: title("instability"),
    swatches: [{ shape: "dash", color: INSTABILITY_COLOR, label: "Witnessed region" }],
    notes: [input.instabilityWitnessed ? "No mode shape or direction is inferred from the failed solve."
      : "No instability witness on this board."],
  }),
};

function diagramLegend(id: "shear" | "moment", input: LegendInput): ViewLegend {
  const action = id === "shear" ? input.modes.shearAxis : input.modes.momentAxis;
  const diagram = input.diagrams.find(d => d.action === action);
  const unit = id === "shear" ? "kN" : "kN·m";
  const toward = action === 1 || action === 5 ? "+y" : "+z";
  return {
    id, title: `${title(id)} · ${boardActions[action]}`,
    swatches: [{ shape: "thick", color: id === "shear" ? DIAGRAM_COLORS.shear : DIAGRAM_COLORS.moment, label: boardActions[action] }],
    notes: diagram?.series.length
      ? [`Peak ${number(diagram.peak)} ${unit} spans 1.5 m on the board.`, `Positive values extend toward local ${toward}.`]
      : ["No verified frame sections for this diagram."],
  };
}

/** One legend per active mode, in panel order. Response-backed modes report why they are not drawn yet. */
export function buildLegends(input: LegendInput): ViewLegend[] {
  const status = responseStatus(input.response);
  return activeModes(input.modes, input.jointsShown).map(id => {
    const needs = VIEW_MODES.find(mode => mode.id === id)?.needsResponse;
    return needs && status ? { id, title: title(id), swatches: [], notes: [], status, pending: input.response.state === "pending" } : builders[id](input);
  });
}
