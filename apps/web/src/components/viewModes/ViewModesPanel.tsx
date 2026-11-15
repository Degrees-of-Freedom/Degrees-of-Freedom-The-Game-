import { useEffect, useId, useRef } from "react";
import {
  DISPLACEMENT_SCALES, isModeActive, VIEW_MODES,
  type MomentAction, type ShearAction, type ViewModeAction, type ViewModeId, type ViewModes,
} from "../../viewer/viewModes";
import { EyeIcon, ViewModeIcon } from "./ViewModeIcon";
import { ESCAPE_OWNER } from "../PauseMenu";

export interface ViewModesPanelProps {
  /** Modes as drawn (response modes cleared until the response is open). */
  readonly modes: ViewModes;
  readonly jointsShown: boolean;
  readonly open: boolean;
  /** Displayed displacement exaggeration, for the automatic option's label. */
  readonly scale: number;
  onOpenChange(open: boolean): void;
  onPress(mode: ViewModeId): void;
  dispatch(action: ViewModeAction): void;
}

const shearAxes: readonly ShearAction[] = [1, 2];
const momentAxes: readonly MomentAction[] = [4, 5];
const axisName = { 1: "Vy", 2: "Vz", 4: "My", 5: "Mz" } as const;

/**
 * Eye button and its pop-over of view-mode tiles. Tiles are toggle buttons
 * (aria-pressed); the label switch is a real switch. Escape or a press outside
 * closes the panel and returns focus to the eye.
 */
export function ViewModesPanel({ modes, jointsShown, open, scale, onOpenChange, onPress, dispatch }: ViewModesPanelProps) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const eye = useRef<HTMLButtonElement>(null);
  const active = VIEW_MODES.filter(mode => isModeActive(modes, mode.id, jointsShown)).length;
  useEffect(() => {
    if (!open) return;
    // Opening by keyboard (V) or click moves focus to the first tile.
    root.current?.querySelector<HTMLButtonElement>(".view-tile-main")?.focus({ preventScroll: true });
    const close = () => { onOpenChange(false); eye.current?.focus({ preventScroll: true }); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      // This press only closes the panel. Listeners registered before this one
      // (pause menu, board) yield to ESCAPE_OWNER; later ones never see it.
      // React may flush the close between listeners, removing the marker.
      event.stopImmediatePropagation();
      close();
    };
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onOpenChange(false);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", pointer, true); };
  }, [open, onOpenChange]);
  return <div className="view-modes" ref={root} data-open={open} {...(open ? { [ESCAPE_OWNER]: "" } : {})}>
    <button ref={eye} className="view-eye" aria-expanded={open} aria-controls={panelId}
      aria-label={`View modes, ${active} active`} title="View modes (V)" onClick={() => onOpenChange(!open)}>
      <EyeIcon />{active > 0 && <span className="view-eye-count" aria-hidden="true">{active}</span>}
    </button>
    {open && <section id={panelId} className="view-panel" aria-label="View modes">
      <header><h2>View modes</h2><small>Mix and match overlays</small></header>
      <div className="view-tiles">
        {VIEW_MODES.map(mode => {
          const on = isModeActive(modes, mode.id, jointsShown);
          const axes = mode.id === "shear" ? shearAxes : mode.id === "moment" ? momentAxes : null;
          const current = mode.id === "shear" ? modes.shearAxis : modes.momentAxis;
          return <div key={mode.id} className="view-tile" data-mode={mode.id} data-on={on}>
            <button className="view-tile-main" aria-pressed={on} onClick={() => onPress(mode.id)}>
              <ViewModeIcon mode={mode.id} />
              <span><strong>{mode.title}</strong><small>{mode.hint}</small></span>
              <i className="view-tile-pip" aria-hidden="true" />
            </button>
            {axes && on && <div className="view-axes" role="group" aria-label={mode.id === "shear" ? "Shear component" : "Bending component"}>
              {axes.map(axis => <button key={axis} aria-pressed={axis === current} onClick={() =>
                dispatch(mode.id === "shear" ? { type: "shearAxis", axis: axis as ShearAction } : { type: "momentAxis", axis: axis as MomentAction })}>
                {axisName[axis]}</button>)}
            </div>}
          </div>;
        })}
      </div>
      <footer>
        <label className="view-switch">
          <input type="checkbox" role="switch" checked={modes.labels} onChange={event => dispatch({ type: "labels", on: event.target.checked })} />
          <span aria-hidden="true" /><strong>Labels</strong>
        </label>
        <label className="view-scale">Sag ×
          <select aria-label="Sag exaggeration" value={modes.amplification} onChange={event => dispatch({ type: "amplification", value: Number(event.target.value) })}>
            <option value={0}>Auto (×{scale})</option>
            {DISPLACEMENT_SCALES.map(n => <option key={n} value={n}>×{n}</option>)}
          </select>
        </label>
        <button className="view-text-button" onClick={() => dispatch({ type: "clear" })}>Clear</button>
        <button className="view-text-button" onClick={() => dispatch({ type: "reset" })}>Reset</button>
      </footer>
    </section>}
  </div>;
}
