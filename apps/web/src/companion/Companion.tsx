import { useEffect, useId, useRef, useState } from "react";
import type { FigureName } from "./figure";
import type { PublicRepairReport } from "../game/publicRepairReport";
import { RepairExplanation } from "./RepairExplanation";
import { useSettings } from "../menu/settings";
import "./companion.css";

type Area = "home" | "menu" | "board" | "drawer";

/** Keep the matching portrait available throughout lazy import/decoding. A
 * context loss replaces the canvas immediately and offers an explicit retry. */
function Figure({ name, retry, onFailure }: {
  name: FigureName; retry: number; onFailure: (failed: boolean) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [view, setView] = useState<"portrait" | "model">("portrait");
  useEffect(() => {
    const element = host.current!;
    let active = true, visible = false, generation = 0;
    let stage: ReturnType<typeof import("./figure").createFigure> | undefined;
    const drop = () => {
      generation++;
      if (!stage) return;
      stage.canvas.removeEventListener("webglcontextlost", lost);
      stage.canvas.remove();
      stage.dispose();
      stage = undefined;
    };
    function lost(event: Event) {
      event.preventDefault();
      drop();
      setView("portrait");
      onFailure(true);
    }
    async function load() {
      const token = ++generation;
      try {
        const { createFigure } = await import("./figure");
        if (!active || token !== generation) return;
        stage = createFigure();
        stage.canvas.setAttribute("aria-hidden", "true");
        stage.canvas.addEventListener("webglcontextlost", lost);
        element.append(stage.canvas);
        await stage.show(name);
        if (active && token === generation) { setView("model"); onFailure(false); }
      } catch {
        if (active && token === generation) { drop(); setView("portrait"); onFailure(true); }
      }
    }
    function visibility() {
      const next = visible && !document.hidden;
      if (next && !stage) void load();
      else if (!next) { drop(); setView("portrait"); }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visibility();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false; observer.disconnect();
      document.removeEventListener("visibilitychange", visibility); drop();
    };
  }, [name, retry, onFailure]);
  return <span className="figure-stage" data-view={view} ref={host} aria-hidden="true">
    <img src={import.meta.env.BASE_URL + "companion/" + name + ".png"} alt="" />
  </span>;
}

export function Companion({ area, repairs, announceRepair = false, onPresented, onForemanAccent }: {
  area: Area;
  repairs?: PublicRepairReport[];
  announceRepair?: boolean;
  onPresented?: () => void;
  onForemanAccent?: () => void | (() => void);
}) {
  const id = useId();
  const settings = useSettings();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [foreman, setForeman] = useState<"preview" | "reaction" | null>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const presentedTurn = useRef<number | null>(null);
  const stopAccent = useRef<(() => void) | null>(null);
  const latest = repairs?.at(-1);
  const repair = repairs?.find(entry => entry.turn === selectedTurn) ?? repairs?.at(-1);
  useEffect(() => {
    if (announceRepair && latest && presentedTurn.current !== latest.turn) {
      presentedTurn.current = latest.turn;
      setSelectedTurn(null);
      setForeman(latest.foreman ? "reaction" : null);
      if (latest.foreman && settings.sound && !document.hidden) stopAccent.current = onForemanAccent?.() ?? null;
      setOpen(true);
      onPresented?.();
    }
  }, [announceRepair, latest, onPresented, onForemanAccent, settings.sound]);
  useEffect(() => {
    if (foreman !== "reaction") return;
    const settle = () => { setForeman(null); setFailed(false); };
    const timer = window.setTimeout(settle, 4000);
    const hidden = () => { if (document.hidden) settle(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      stopAccent.current?.();
      stopAccent.current = null;
    };
  }, [foreman]);
  useEffect(() => {
    if (!settings.sound) stopAccent.current?.();
    return () => { stopAccent.current?.(); };
  }, [settings.sound]);
  const name = foreman ? "Conkeldurr" : "Timburr";
  function close() {
    setOpen(false);
    if (foreman) { setForeman(null); setFailed(false); }
    button.current?.focus();
  }
  return <aside className={"companion companion-" + area} aria-label="Site companion"
    data-foreman={foreman ?? undefined} data-motion={settings.reducedMotion ? "reduced" : "system"}
    onKeyDown={e => {
      if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }}>
    <button type="button" ref={button} className="companion-figure"
      aria-label={"Talk to " + name} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : setOpen(true)}>
      <Figure key={name} name={foreman ? "conkeldurr" : "timburr"} retry={retry} onFailure={setFailed} />
      <span>{name}</span>
    </button>
    {open && <div id={id} className={"companion-note" + (repair && foreman !== "preview" ? " companion-repair" : "")}>
      {foreman === "reaction" && <span className="companion-announcement" role="status">Conkeldurr has a foreman report for turn {repair?.turn}.</span>}
      {repair && foreman !== "preview" ? <>
        {repairs && repairs.length > 1 && <label>Recorded repair
          <select value={repair.turn} onChange={e => { setForeman(null); setSelectedTurn(Number(e.target.value)); }}>
            {repairs.map(entry => <option key={entry.turn} value={entry.turn}>Turn {entry.turn}</option>)}
          </select>
        </label>}
        <RepairExplanation report={repair} foreman={foreman === "reaction"} />
      </> : <p>{foreman ? "Conkeldurr · Foreman preview" : area === "board" || area === "drawer"
        ? "Got a tricky joint? Inspect it to see which ends are connected."
        : "Ready to build? Pick a game mode and I’ll meet you on the board."}</p>}
      <button type="button" onClick={() => { setFailed(false); setForeman(foreman ? null : "preview"); }}>
        {foreman === "reaction" ? "Skip transformation" : foreman ? "Back to Timburr" : "Preview Conkeldurr"}
      </button>
      {failed && <button type="button" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>
        Retry 3D model
      </button>}
      <button type="button" onClick={close}>Dismiss</button>
    </div>}
  </aside>;
}
