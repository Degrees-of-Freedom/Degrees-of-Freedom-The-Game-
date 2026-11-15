import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_VIEW_MODES, VIEW_MODES } from "../../viewer/viewModes";
import { buildLegends } from "../../viewer/viewLegends";
import { ViewModesPanel } from "./ViewModesPanel";
import { ViewLegends } from "./ViewLegends";

const noop = () => {};
const panel = (open: boolean, modes = DEFAULT_VIEW_MODES, jointsShown = false) => renderToStaticMarkup(
  <ViewModesPanel modes={modes} jointsShown={jointsShown} open={open} scale={42} onOpenChange={noop} onPress={noop} dispatch={noop} />);

describe("view modes panel", () => {
  it("collapses to an eye button that announces the active count", () => {
    const html = panel(false);
    expect(html).toContain('aria-label="View modes, 2 active"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("view-tiles");
  });

  it("lists every mode as a toggle button with its pressed state", () => {
    const html = panel(true, DEFAULT_VIEW_MODES, true);
    for (const mode of VIEW_MODES) expect(html).toContain(mode.title.replace("&", "&amp;"));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html).toContain('role="switch"');
    expect(html).toContain("Auto (×42)");
  });

  it("offers diagram components only while that diagram is shown", () => {
    expect(panel(true)).not.toContain("Shear diagram component");
    const html = panel(true, { ...DEFAULT_VIEW_MODES, shear: true, shearAxis: 2 });
    expect(html).toContain('aria-label="Shear diagram component"');
    expect(html).toMatch(/aria-pressed="true">Vz</);
  });

  it("reflects the label switch", () => {
    expect(panel(true)).toMatch(/role="switch" checked=""/);
    expect(panel(true, { ...DEFAULT_VIEW_MODES, labels: false })).not.toMatch(/role="switch" checked=""/);
  });
});

describe("legend cards", () => {
  it("renders nothing without an active mode", () => {
    expect(renderToStaticMarkup(<ViewLegends legends={[]} />)).toBe("");
  });
  it("renders the colour ramp with an accessible range and every swatch label", () => {
    const legends = buildLegends({ modes: { ...DEFAULT_VIEW_MODES, loadPath: true }, jointsShown: false, response: { state: "ready" },
      scale: 10, peakM: 0.004, maxForceKN: 12, diagrams: [], jointCount: 2 });
    const html = renderToStaticMarkup(<ViewLegends legends={legends} />);
    expect(html).toContain('aria-label="Colour scale from 0 mm (blue) to 4 mm (red)"');
    for (const swatch of legends.flatMap(l => l.swatches)) expect(html).toContain(swatch.label);
    expect(html).toContain("Hide legends");
  });
  it("shows a status in place of keys while the response is unavailable", () => {
    const legends = buildLegends({ modes: DEFAULT_VIEW_MODES, jointsShown: false, response: { state: "pending" }, scale: 1, diagrams: [], jointCount: 0 });
    const html = renderToStaticMarkup(<ViewLegends legends={legends} />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("view-swatch");
  });
});
