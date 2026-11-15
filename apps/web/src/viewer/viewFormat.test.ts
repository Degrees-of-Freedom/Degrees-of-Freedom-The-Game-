import { describe, expect, it } from "vitest";
import { formatSigned, formatValue, isNegligible } from "./viewFormat";
import { diagramLabel } from "./boardDiagrams";
import { buildLegends } from "./viewLegends";
import { DEFAULT_VIEW_MODES } from "./viewModes";

describe("board number formatting", () => {
  it("rounds to three significant figures with separators", () => {
    expect(formatValue(12.345)).toBe("12.3");
    expect(formatValue(12345)).toBe("12,300");
    expect(formatValue(0.012345)).toBe("0.0123");
  });
  it("reads solver round-off and invalid values as zero", () => {
    for (const value of [1e-9, -3e-12, 0, Number.NaN]) {
      expect(isNegligible(value)).toBe(true);
      expect(formatValue(value)).toBe("0");
      expect(formatSigned(value)).toBe("0");
    }
  });
  it("signs negatives with a true minus and labels diagram peaks", () => {
    expect(formatSigned(-7.25)).toBe("−7.25");
    expect(diagramLabel(5, -12.44)).toBe("Mz −12.4 kN·m");
    expect(diagramLabel(1, 3)).toBe("Vy 3 kN");
  });
  it("describes an unloaded board instead of printing round-off", () => {
    const legends = buildLegends({ modes: { ...DEFAULT_VIEW_MODES, loadPath: true }, jointsShown: false, response: { state: "ready" },
      scale: 1, peakM: 1e-13, maxForceKN: 1e-9, diagrams: [], jointCount: 0 });
    expect(legends[0].notes[0]).toBe("No load is transferred on this board yet.");
    expect(legends[1].ramp?.max).toBe("0 mm");
    expect(legends[1].notes).toContain("No verified displacement on this board.");
  });
});
