import { Spinner } from "../Spinner";
import { useState, type CSSProperties } from "react";
import type { LegendSwatch, ViewLegend } from "../../viewer/viewLegends";
import { ViewModeIcon } from "./ViewModeIcon";

/** Small key drawn in the swatch's own shape, so colour is never the only cue. */
function Swatch({ swatch }: { swatch: LegendSwatch }) {
  const style = { "--swatch": swatch.color } as CSSProperties;
  return <li className="view-swatch" style={style}>
    <svg viewBox="0 0 28 14" aria-hidden="true" focusable="false">{swatchShape(swatch.shape)}</svg>
    <span>{swatch.label}</span>
  </li>;
}

function swatchShape(shape: LegendSwatch["shape"]) {
  const stroke = { stroke: "var(--swatch)", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (shape) {
    case "bar": return <path d="M3 7h22" {...stroke} strokeWidth="4" />;
    case "thin": return <path d="M3 7h22" {...stroke} strokeWidth="1.5" />;
    case "thick": return <path d="M3 11V4h22v7" {...stroke} strokeWidth="2.5" />;
    case "arrow": return <><path d="M3 7h18" {...stroke} strokeWidth="3" /><path d="m17 2.5 6 4.5-6 4.5Z" fill="var(--swatch)" /></>;
    case "dash": return <path d="M2 7h24" {...stroke} strokeWidth="2.2" strokeDasharray="4 3" />;
    case "ghost": return <path d="M3 4q11 10 22 0" {...stroke} strokeWidth="5" opacity=".5" />;
    case "dot": return <circle cx="14" cy="7" r="4.5" fill="var(--swatch)" />;
    case "zigzag": return <path d="M2 7l3-4 3 8 3-8 3 8 3-8 3 8 3-8 3 4" {...stroke} strokeWidth="1.6" />;
    case "arc": return <path d="M6 11a8 8 0 0 1 16 0m0 0-3-2m3 2 1-3" {...stroke} strokeWidth="1.8" />;
    case "hatch": return <path d="M3 4h22M3 11h22M7 4v7M12 4v7M17 4v7M22 4v7" {...stroke} strokeWidth="1.4" />;
    case "cross": return <path d="M9 2l10 10M19 2 9 12" {...stroke} strokeWidth="2" />;
  }
}

/**
 * Legend cards for every active view mode. The stack can be collapsed to a
 * single chip so legends never hide the board; the list is a polite live region so
 * screen-reader users hear when a legend's values change.
 */
/** Short screens start with legends folded so the board stays visible. */
const SHORT_SCREEN = "(max-height: 520px)";
const startCollapsed = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(SHORT_SCREEN).matches;

export function ViewLegends({ legends }: { legends: readonly ViewLegend[] }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  if (!legends.length) return null;
  return <section className="view-legends" aria-label="Legends" data-collapsed={collapsed}>
    <button className="view-legends-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? `Legends (${legends.length})` : "Hide legends"}
    </button>
    {!collapsed && <div className="view-legend-list" aria-live="polite">
      {legends.map(legend => <article key={legend.id} className="view-legend" data-mode={legend.id}>
        <h3><ViewModeIcon mode={legend.id} />{legend.title}</h3>
        {legend.pending ? <Spinner label={legend.status ?? "Checking structure"} /> : legend.status ? <p className="view-legend-status" role="status">{legend.status}</p> : <>
          {legend.ramp && <div className="view-ramp">
            <div className="view-ramp-bar" style={{ background: legend.ramp.gradient }} role="img"
              aria-label={`Colour scale from ${legend.ramp.min} (blue) to ${legend.ramp.max} (red)`} />
            <div className="view-ramp-ticks"><span>{legend.ramp.min}</span><span>{legend.ramp.max}</span></div>
          </div>}
          {!!legend.swatches.length && <ul className="view-swatches">{legend.swatches.map(swatch =>
            <Swatch key={swatch.label} swatch={swatch} />)}</ul>}
          {legend.notes.map(note => <p key={note}>{note}</p>)}
        </>}
      </article>)}
    </div>}
  </section>;
}
