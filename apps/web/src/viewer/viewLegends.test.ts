import { describe, expect, it } from "vitest";
import { buildLegends, type LegendInput } from "./viewLegends";
import { DEFAULT_VIEW_MODES, viewModesReducer, type ViewModes } from "./viewModes";
import { DISPLACEMENT_RAMP } from "./contourRamp";
import { LOAD_PATH_ARROWS, RESULT_ARROWS } from "./viewPalette";

const input = (modes: ViewModes, extra: Partial<LegendInput> = {}): LegendInput => ({
  modes, jointsShown: false, response: { state: "ready" }, scale: 100, diagrams: [], jointCount: 3, ...extra,
});
const everything: ViewModes = { ...DEFAULT_VIEW_MODES, loadPath: true, shear: true, moment: true, instability: true };

describe("view-mode legends", () => {
  it("adds one legend per active mode, in panel order", () => {
    expect(buildLegends(input(everything, { jointsShown: true })).map(l => l.id))
      .toEqual(["loadPath", "deflected", "joints", "reactions", "shear", "moment", "instability"]);
    expect(buildLegends(input(viewModesReducer(DEFAULT_VIEW_MODES, { type: "clear" })))).toEqual([]);
  });

  it("states the displacement range in millimetres with the drawn colour ramp and the exaggeration", () => {
    const [legend] = buildLegends(input({ ...DEFAULT_VIEW_MODES, reactions: false }, { peakM: 0.01234 }));
    expect(legend.ramp).toMatchObject({ min: "0 mm", max: "12.3 mm" });
    for (const stop of DISPLACEMENT_RAMP) expect(legend.ramp?.gradient).toContain(stop);
    expect(legend.notes[0]).toContain("×100");
  });

  it("distinguishes the shadow from the deflected shape", () => {
    const [legend] = buildLegends(input({ ...DEFAULT_VIEW_MODES, deflection: "shadow", reactions: false }, { peakM: 0.002 }));
    expect(legend.title).toBe("Displacement shadow");
    expect(legend.swatches.map(s => s.label)).toEqual(["Members at rest", "Deflected ghost", "Joint travel"]);
  });

  it("uses the drawn load-path and reaction colours and the transfer scale", () => {
    const [path, , reactions] = buildLegends(input({ ...DEFAULT_VIEW_MODES, loadPath: true }, { maxForceKN: 42.04, appliedGravityKN: 30 }));
    expect(path.swatches.slice(0, 3).map(s => s.color)).toEqual([LOAD_PATH_ARROWS.tension, LOAD_PATH_ARROWS.compression, LOAD_PATH_ARROWS.bending]);
    expect(path.notes[0]).toContain("42 kN");
    expect(reactions.swatches.map(s => s.color)).toEqual([RESULT_ARROWS.load, RESULT_ARROWS.reaction]);
    expect(reactions.notes[0]).toContain("30 kN");
  });

  it("names the selected diagram component, its peak and sign convention", () => {
    const modes = viewModesReducer({ ...DEFAULT_VIEW_MODES, deflection: "off", reactions: false }, { type: "momentAxis", axis: 4 });
    const [legend] = buildLegends(input(modes, { diagrams: [{ action: 4, peak: 7.5, series: [{}] }] }));
    expect(legend.title).toBe("Bending diagram · Moment My");
    expect(legend.notes).toEqual(["Peak 7.5 kN·m spans 1.5 m on the board.", "Positive values extend toward local +z."]);
  });

  it("marks a diagram with no verified sections as unavailable rather than zero", () => {
    const modes = { ...DEFAULT_VIEW_MODES, deflection: "off" as const, reactions: false, shear: true };
    expect(buildLegends(input(modes))[0].notes).toEqual(["No verified frame sections for this diagram."]);
  });

  it("explains why response legends are not drawn yet; joint freedoms never wait", () => {
    for (const [response, text] of [[{ state: "draft" }, "Finish or cancel the draft"], [{ state: "pending" }, "Checking"],
      [{ state: "error", message: "Worker failed." }, "Worker failed."]] as const) {
      const legends = buildLegends(input(DEFAULT_VIEW_MODES, { response, jointsShown: true }));
      expect(legends.find(l => l.id === "deflected")?.status).toContain(text);
      expect(legends.find(l => l.id === "joints")?.status).toBeUndefined();
    }
  });

  it("reports an absent instability witness explicitly", () => {
    const modes = { ...DEFAULT_VIEW_MODES, deflection: "off" as const, reactions: false, instability: true };
    expect(buildLegends(input(modes))[0].notes[0]).toBe("No instability witness on this board.");
    expect(buildLegends(input(modes, { instabilityWitnessed: true }))[0].notes[0]).toContain("No mode shape");
  });
});
