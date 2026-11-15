import { useEffect, useId, useRef, useState } from "react";
import type { FigureName, FigurePose } from "./figure";
import type { PublicRepairReport } from "../game/publicRepairReport";
import { RepairExplanation } from "./RepairExplanation";
import { updateSettings, useSettings } from "../menu/settings";
import { checkpointNotice, mistakeCount, takeForemanCue } from "./reactions";
import "./companion.css";

type Area = "home" | "menu" | "board" | "drawer";

/** Keep the matching portrait available throughout lazy import/decoding. A
 * context loss replaces the canvas immediately and offers an explicit retry. */
function Figure({ name, retry, onFailure, pose, sequence, still }: {
  name: FigureName; retry: number; onFailure: (failed: boolean) => void;
  pose?: FigurePose; sequence?: number; still: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const actor = useRef<ReturnType<typeof import("./figure").createFigure> | undefined>(undefined);
  const currentPose = useRef({ pose, still });
  currentPose.current = { pose, still };
  useEffect(() => {
    if (pose) actor.current?.pose(pose, still);
    else actor.current?.settle();
    // The portrait shares the hop with the GLB. Repeated actions restart
    // only this transform; they never recreate a decoder or a WebGL context.
    if (pose !== "nod" || still || document.hidden) return;
    const hop = host.current?.animate?.([
      { transform: "translateY(0) scale(1)" },
      { transform: "translateY(2px) scale(1.08,.89)", offset: .18 },
      { transform: "translateY(-8px) rotate(-5deg) scale(.97,1.05)", offset: .48 },
      { transform: "translateY(1px) scale(1.05,.95)", offset: .78 },
      { transform: "translateY(0) scale(1)" },
    ], { duration: 360, easing: "ease-in-out" });
    return () => hop?.cancel();
  }, [pose, sequence, still]);
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
      actor.current = undefined;
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
        if (active && token === generation) {
          actor.current = stage;
          if (currentPose.current.pose) stage.pose(currentPose.current.pose, currentPose.current.still);
          setView("model"); onFailure(false);
        }
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

export interface CompanionProps {
  area: Area;
  repairs?: PublicRepairReport[];
  announceRepair?: boolean;
  announceFromTurn?: number;
  onPresented?: () => void;
  onForemanAccent?: () => void | (() => void);
  release?: boolean;
  action?: number;
  final?: boolean;
  skip?: boolean;
}

// Cosmetic cooldowns survive privacy unmounts. No cards, seed or topology are recorded.
let lastActivation = -Infinity;
export function Companion({ area, repairs, announceRepair = false, announceFromTurn, onPresented, onForemanAccent,
  release = false, action = 0, final = false, skip = false }: CompanionProps) {
  const id = useId();
  const settings = useSettings();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [foreman, setForeman] = useState<"preview" | "shrink" | "reaction" | null>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const presented = useRef<string | null>(null);
  const accentPending = useRef(false);
  const latest = repairs?.at(-1);
  const repair = repairs?.find(entry => entry.turn === selectedTurn) ?? repairs?.at(-1);
  const currentNotice = repairs && release && announceFromTurn !== undefined ? checkpointNotice(repairs, announceFromTurn) : latest;
  const count = repair ? mistakeCount(repairs ?? [], repair) : 0;
  const still = settings.reducedMotion || skip;
  useEffect(() => {
    if (announceRepair && currentNotice) {
      const notice = currentNotice.charge?.id ?? `repair/${currentNotice.turn}/${currentNotice.playerId}`;
      if (presented.current === notice) return;
      presented.current = notice;
      setSelectedTurn(currentNotice.turn);
      const eligible = settings.showCompanion && !document.hidden && !final && !skip &&
        (release ? takeForemanCue(mistakeCount(repairs ?? [], currentNotice)) : currentNotice.foreman);
      accentPending.current = eligible && settings.sound;
      setForeman(eligible ? release && !still ? "shrink" : "reaction" : null);
      setOpen(!final && !skip && settings.showCompanion);
      onPresented?.();
    }
  }, [announceRepair, currentNotice, repairs, onPresented, settings.sound, settings.showCompanion, final, skip, still, release]);
  useEffect(() => {
    if (foreman !== "shrink") return;
    if (still) { setForeman("reaction"); return; }
    const timer = window.setTimeout(() => setForeman("reaction"), 240);
    return () => window.clearTimeout(timer);
  }, [foreman, still]);
  useEffect(() => {
    if (foreman !== "reaction" && foreman !== "shrink") return;
    const settle = () => {
      if (document.activeElement?.hasAttribute("data-skip-foreman")) button.current?.focus({ preventScroll: true });
      setForeman(null); setFailed(false);
    };
    const timer = foreman === "reaction" ? window.setTimeout(settle, release ? 3560 : 4000) : undefined;
    const hidden = () => { if (document.hidden) { settle(); setOpen(false); } };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [foreman, release]);
  const automatic = foreman === "shrink" || foreman === "reaction";
  useEffect(() => {
    if (!automatic || !settings.sound || !accentPending.current || document.hidden) return;
    accentPending.current = false;
    const stop = onForemanAccent?.();
    return () => stop?.();
  }, [automatic, settings.sound, onForemanAccent]);
  useEffect(() => { if (final || skip || !settings.showCompanion) { setForeman(null); setOpen(false); } },
    [final, skip, settings.showCompanion]);
  const evolved = foreman === "preview" || foreman === "reaction";
  const name = evolved ? "Conkeldurr" : "Timburr";
  const instability = release && !final && repair?.charge?.unstableMemberId !== undefined;
  const fitting = repair?.jointAttempts.find(a => a.status === "verified");
  function close() {
    setOpen(false);
    if (foreman) { setForeman(null); setFailed(false); }
    button.current?.focus();
  }
  if (!settings.showCompanion) return <aside className={"companion companion-" + area}>
    <button className="companion-restore" onClick={() => updateSettings({ showCompanion: true })}>Show companion</button>
  </aside>;
  return <aside className={"companion companion-" + area} aria-label="Site companion"
    data-foreman={foreman ?? undefined} data-motion={still ? "reduced" : "system"} data-release={release || undefined}
    onKeyDown={e => {
      if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }}>
    <button type="button" ref={button} className="companion-figure"
      aria-label={"Talk to " + name} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => {
        if (open) close();
        else if (!release || performance.now() - lastActivation >= 5000) {
          lastActivation = performance.now(); setOpen(true);
        }
      }}>
      <span className="figure-motion"><Figure key={name} name={evolved ? "conkeldurr" : "timburr"} retry={retry} onFailure={setFailed}
        pose={final ? "victory" : foreman === "reaction" ? "foreman" : !foreman && (action || open) ? "nod" : undefined}
        sequence={action} still={!!still} /></span>
      <span>{name}</span>
    </button>
    {open && <div id={id} data-instability={instability || undefined} className={"companion-note" + (repair && foreman !== "preview" ? " companion-repair" : "")}>
      {instability && <p className="companion-warning" role="status"><b aria-hidden="true">!</b>
        <strong>Whoa, a wobble!<small>Instability · member {repair?.charge?.unstableMemberId} · turn {repair?.turn}</small></strong></p>}
      {release && evolved && repair && <p><strong>Foreman check</strong>Player {repair.playerId.replace("player-", "")} has {count} verified deductions.</p>}
      {foreman === "reaction" && <span className="companion-announcement" role="status">Conkeldurr has a foreman report for turn {repair?.turn}.</span>}
      {release ? <p>{final ? "The final scores are in." : fitting ? `A joint fitting was installed at ${fitting.jointId}. ${repair?.pending.length ? "Inspect the remaining issue." : "Inspect the updated joint."}`
        : repair ? repair.attempts.some(a => a.status === "verified")
        ? `A neutral prop was installed on turn ${repair.turn}.${repair.pending.length ? " Inspect the remaining issue." : " Inspect its support reaction."}`
        : `Inspect the unresolved region from turn ${repair.turn}.`
        : "Select a member or joint to inspect it."}</p> : repair && foreman !== "preview" ? <>
        {repairs && repairs.length > 1 && <label>Recorded repair
          <select value={repair.turn} onChange={e => { setForeman(null); setSelectedTurn(Number(e.target.value)); }}>
            {repairs.map(entry => <option key={entry.turn} value={entry.turn}>Turn {entry.turn}</option>)}
          </select>
        </label>}
        <RepairExplanation report={repair} foreman={foreman === "reaction"} />
      </> : <p>{foreman ? "Conkeldurr · Foreman preview" : area === "board" || area === "drawer"
        ? "Got a tricky joint? Inspect it to see which ends are connected."
        : "Ready to build? Pick a game mode and I’ll meet you on the board."}</p>}
      {(!release || foreman) && <button type="button" data-skip-foreman={foreman ? true : undefined} onClick={() => {
        setFailed(false); setForeman(foreman ? null : "preview");
        if (foreman) button.current?.focus({ preventScroll: true });
      }}>
        {foreman === "reaction" || foreman === "shrink" ? "Skip transformation" : foreman ? "Back to Timburr" : "Preview Conkeldurr"}
      </button>}
      {failed && <button type="button" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>
        Retry 3D model
      </button>}
      <button type="button" onClick={close}>Dismiss</button>
    </div>}
  </aside>;
}
