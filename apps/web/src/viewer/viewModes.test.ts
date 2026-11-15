import { describe, expect, it } from "vitest";
import {
  activeModes, DEFAULT_VIEW_MODES, diagramActions, displacementScale, needsResponse, OVERLAY_LAYERS, overlayLayer,
  pressMode, viewModesReducer, visibleModes, VIEW_MODES, type OverlayLayer, type ViewModes,
} from "./viewModes";

const toggle = (state: ViewModes, mode: Parameters<typeof pressMode>[1]) => viewModesReducer(state, { type: "toggle", mode });

describe("view-mode reducer", () => {
  it("keeps the board's previous default: deflected shape with loads, labels on", () => {
    expect(activeModes(DEFAULT_VIEW_MODES, false)).toEqual(["deflected", "reactions"]);
    expect(DEFAULT_VIEW_MODES.labels).toBe(true);
    expect(overlayLayer(DEFAULT_VIEW_MODES)).toBe("shape");
  });

  it("treats deflected shape and displacement shadow as one exclusive choice", () => {
    const shadow = toggle(DEFAULT_VIEW_MODES, "shadow");
    expect(shadow.deflection).toBe("shadow");
    expect(toggle(shadow, "deflected").deflection).toBe("shape");
    expect(toggle(shadow, "shadow").deflection).toBe("off");
  });

  it("combines the other modes freely and leaves the input untouched", () => {
    const before = { ...DEFAULT_VIEW_MODES };
    const all = (["loadPath", "shear", "moment", "instability"] as const).reduce(toggle, DEFAULT_VIEW_MODES);
    expect(activeModes(all, true)).toEqual(["loadPath", "deflected", "joints", "reactions", "shear", "moment", "instability"]);
    expect(DEFAULT_VIEW_MODES).toEqual(before);
  });

  it("selecting a diagram component also shows the diagram", () => {
    const state = viewModesReducer(DEFAULT_VIEW_MODES, { type: "momentAxis", axis: 4 });
    expect(diagramActions(state)).toEqual([4]);
    expect(diagramActions(viewModesReducer(state, { type: "shearAxis", axis: 2 }))).toEqual([2, 4]);
  });

  it("clear hides every overlay but keeps the label preference and scale; reset restores defaults", () => {
    const custom = viewModesReducer(viewModesReducer(toggle(DEFAULT_VIEW_MODES, "loadPath"), { type: "labels", on: false }),
      { type: "amplification", value: 100 });
    const cleared = viewModesReducer(custom, { type: "clear" });
    expect(activeModes(cleared, false)).toEqual([]);
    expect(cleared).toMatchObject({ labels: false, amplification: 100 });
    expect(viewModesReducer(cleared, { type: "reset" })).toEqual(DEFAULT_VIEW_MODES);
  });

  it("rejects non-positive or non-finite exaggeration as automatic", () => {
    for (const value of [-5, 0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(viewModesReducer(DEFAULT_VIEW_MODES, { type: "amplification", value }).amplification).toBe(0);
  });
});

describe("Inspect drawer overlay mapping", () => {
  it("round-trips every single-choice layer", () => {
    for (const layer of Object.keys(OVERLAY_LAYERS) as OverlayLayer[])
      expect(overlayLayer(viewModesReducer(DEFAULT_VIEW_MODES, { type: "overlay", layer }))).toBe(layer);
  });
  it("keeps the scripted option order: reference, shape, path, combined first", () => {
    expect(Object.keys(OVERLAY_LAYERS).slice(0, 4)).toEqual(["reference", "shape", "path", "combined"]);
  });
  it("changes only deflection and load path", () => {
    const state = viewModesReducer({ ...DEFAULT_VIEW_MODES, shear: true, instability: true }, { type: "overlay", layer: "path" });
    expect(state).toMatchObject({ deflection: "off", loadPath: true, shear: true, instability: true, reactions: true });
  });
});

describe("on-demand response", () => {
  it("does not draw or report response modes until the response is open", () => {
    expect(activeModes(visibleModes(DEFAULT_VIEW_MODES, false), true)).toEqual(["joints"]);
    expect(visibleModes(DEFAULT_VIEW_MODES, true)).toBe(DEFAULT_VIEW_MODES);
  });
  it("pressing a stored but hidden mode reveals it instead of turning it off", () => {
    expect(pressMode(DEFAULT_VIEW_MODES, "deflected", false)).toBe(DEFAULT_VIEW_MODES);
    expect(pressMode(DEFAULT_VIEW_MODES, "deflected", true).deflection).toBe("off");
    expect(pressMode(DEFAULT_VIEW_MODES, "loadPath", false).loadPath).toBe(true);
  });
  it("joint freedoms alone never require a solve", () => {
    expect(VIEW_MODES.find(mode => mode.id === "joints")?.needsResponse).toBe(false);
    expect(needsResponse(viewModesReducer(DEFAULT_VIEW_MODES, { type: "clear" }))).toBe(false);
    expect(needsResponse(DEFAULT_VIEW_MODES)).toBe(true);
  });
});

describe("displacement scale", () => {
  it("uses a fixed choice when given", () => expect(displacementScale(10, 0.5)).toBe(10));
  it("lifts the peak to about 1.2 m between ×1 and ×500", () => {
    expect(displacementScale(0, 0.012)).toBe(100);
    expect(displacementScale(0, 1e-6)).toBe(500);
    expect(displacementScale(0, 5)).toBe(1);
  });
  it("falls back to ×1 without a valid peak", () => {
    for (const peak of [undefined, 0, Number.NaN]) expect(displacementScale(0, peak)).toBe(1);
  });
});
