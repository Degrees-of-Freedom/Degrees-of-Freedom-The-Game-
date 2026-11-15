import { useEffect, useId, useRef, useState } from "react";
import type { FigureName } from "./figure";
import { createAnimator, type Animator } from "./animator";
import { AMBIENT_IDLE, REST as REST_POSE, RELEASE_IDLE, motionForCue, portraitTransform, type CompanionCue,
  type CompanionCueEvent, type MotionName, type Pose } from "./motion";
import { publishBoardPose } from "./boardPose";
import type { PublicRepairReport } from "../game/publicRepairReport";
import { RepairExplanation } from "./RepairExplanation";
import { updateSettings, useSettings } from "../menu/settings";
import "./companion.css";

type Area = "home" | "menu" | "board" | "drawer";
type Stage = ReturnType<typeof import("./figure").createFigure>;

/** Keep the matching portrait available throughout lazy import/decoding. A
 * context loss replaces the canvas immediately and offers an explicit retry.
 *
 * One animator per mounted figure samples `motion.ts` clips and applies each
 * pose to whichever view is showing: the 3D rig, or the portrait's CSS
 * transform. `entrance` plays once when the figure mounts (Conkeldurr's
 * foreman arrival); `cue` plays whenever its identity changes. `onPose`
 * receives every sampled pose as well, for a second view of the same figure
 * (the model on the islet in the board scene). */
function Figure({ name, retry, onFailure, cue, entrance, idle, still, onPose }: {
  name: FigureName; retry: number; onFailure: (failed: boolean) => void;
  cue?: { motion: MotionName; id: number }; entrance?: MotionName;
  idle: readonly MotionName[] | null; still: boolean;
  onPose?: (pose: Pose, motion: MotionName | null) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const portrait = useRef<HTMLImageElement>(null);
  const actor = useRef<Stage | undefined>(undefined);
  const animator = useRef<Animator | undefined>(undefined);
  const [view, setView] = useState<"portrait" | "model">("portrait");
  const viewRef = useRef(view);
  viewRef.current = view;
  const publish = useRef(onPose);
  publish.current = onPose;
  useEffect(() => {
    const motion = createAnimator({ apply(pose, playing) {
      publish.current?.(pose, playing);
      if (viewRef.current === "model" && actor.current) actor.current.apply(pose);
      else if (portrait.current) portrait.current.style.transform = portraitTransform(pose);
      const element = host.current;
      if (element && element.dataset.clip !== (playing ?? undefined)) {
        if (playing) element.dataset.clip = playing; else delete element.dataset.clip;
      }
    } });
    animator.current = motion;
    publish.current?.(REST_POSE, null);
    return () => { motion.dispose(); animator.current = undefined; publish.current?.(REST_POSE, null); };
  }, []);
  useEffect(() => {
    const motion = animator.current!;
    const sync = () => motion.still(still || document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [still]);
  useEffect(() => { animator.current!.idle(idle); }, [idle]);
  useEffect(() => { if (entrance) animator.current!.play(entrance); }, [entrance]);
  // A remount (Timburr ⇄ Conkeldurr, privacy cover) must not replay a stale cue.
  const mountedCue = useRef(cue?.id);
  useEffect(() => { if (cue && cue.id !== mountedCue.current) animator.current!.play(cue.motion); }, [cue]);
  // Hand any in-progress pose over when the 3D view replaces the portrait.
  useEffect(() => {
    if (view === "model" && portrait.current) portrait.current.style.transform = "";
    if (!animator.current?.current) actor.current?.apply(REST_POSE);
  }, [view]);
  useEffect(() => {
    const element = host.current!;
    let active = true, visible = false, generation = 0;
    let stage: Stage | undefined;
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
    <img ref={portrait} src={import.meta.env.BASE_URL + "companion/" + name + ".png"} alt="" />
  </span>;
}

/**
 * The islet the companion stands on beside the board: a small pastel diorama
 * in the spirit of the Grow Dusk scene, with a quay, a lit cottage and a
 * lantern. It is a screen overlay drawn over the water, not an object in the
 * 3D scene, so it never covers a snap point or takes pointer input.
 */
function Island() {
  return <svg className="companion-island" viewBox="0 0 160 84" aria-hidden="true" focusable="false">
    <ellipse cx="80" cy="67" rx="77" ry="15" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
    <ellipse cx="80" cy="65" rx="68" ry="13" fill="#13222f" fillOpacity=".5" />
    {/* Quay wall with a few block joints. */}
    <path d="M17 47q63 27 126 0v10q-63 27-126 0z" fill="#a9977c" />
    <path d="M40 58v9M62 62v10M98 62v10M120 58v9M17 52q63 27 126 0" fill="none" stroke="#857459" strokeWidth="1" strokeOpacity=".7" />
    <ellipse cx="80" cy="47" rx="63" ry="13.5" fill="#e3d2ab" />
    <ellipse cx="80" cy="46" rx="53" ry="10.5" fill="#86b780" />
    {/* Cottage. */}
    <path d="M106 22h24v23h-24z" fill="#efc7a2" />
    <path d="M130 22l7 4v19l-7 0z" fill="#d3a785" />
    <path d="M102 23l16-14 13 10 8 8-9-4-12 0z" fill="#cf6257" />
    <path d="M112 30h7v8h-7z" fill="#ffe39a" />
    <path d="M121 36h5v9h-5z" fill="#8a5a44" />
    {/* Mooring post and lantern. */}
    <path d="M30 49V24" stroke="#5c4735" strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="30" cy="20" r="9" fill="#f2b134" fillOpacity=".25" />
    <circle cx="30" cy="20" r="3.6" fill="#ffdc8f" />
  </svg>;
}

export interface CompanionProps {
  area: Area;
  repairs?: PublicRepairReport[];
  announceRepair?: boolean;
  onPresented?: () => void;
  onForemanAccent?: () => void | (() => void);
  release?: boolean;
  /** Latest public gameplay scenario. Each new `id` plays its motion once. */
  cue?: CompanionCueEvent;
  final?: boolean;
  skip?: boolean;
}

// Cosmetic cooldowns survive privacy unmounts. No cards, seed or topology are recorded.
let lastForeman = -Infinity;
let lastActivation = -Infinity;
// The welcome wave plays once per page load, not on every route or reopen.
let greeted = false;
export function Companion({ area, repairs, announceRepair = false, onPresented, onForemanAccent,
  release = false, cue, final = false, skip = false }: CompanionProps) {
  const id = useId();
  const settings = useSettings();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [foreman, setForeman] = useState<"preview" | "reaction" | null>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const presentedTurn = useRef<number | null>(null);
  const stopAccent = useRef<(() => void) | null>(null);
  const [motion, setMotion] = useState<{ motion: MotionName; id: number }>();
  const react = (next: CompanionCue) => setMotion(previous => ({ motion: motionForCue(next), id: (previous?.id ?? 0) + 1 }));
  useEffect(() => { if (cue) react(cue); }, [cue]);
  useEffect(() => { if (final) react({ kind: "victory" }); }, [final]);
  useEffect(() => {
    if (greeted || (area !== "home" && area !== "menu")) return;
    greeted = true;
    react({ kind: "greet" });
  }, [area]);
  const latest = repairs?.at(-1);
  const repair = repairs?.find(entry => entry.turn === selectedTurn) ?? repairs?.at(-1);
  useEffect(() => {
    if (announceRepair && latest && presentedTurn.current !== latest.turn) {
      presentedTurn.current = latest.turn;
      setSelectedTurn(null);
      const eligible = settings.showCompanion && !document.hidden && !final && !skip &&
        (release ? latest.releaseForeman && performance.now() - lastForeman >= 45_000 : latest.foreman);
      if (release && eligible) lastForeman = performance.now();
      setForeman(eligible ? "reaction" : null);
      // Conkeldurr's entrance supersedes; otherwise relief or concern.
      if (!eligible && !final) react({ kind: latest.attempts.some(a => a.status === "verified") && !latest.pending.length
        ? "repair" : "issue" });
      if (eligible && settings.sound) stopAccent.current = onForemanAccent?.() ?? null;
      setOpen(!final && settings.showCompanion);
      onPresented?.();
    }
  }, [announceRepair, latest, onPresented, onForemanAccent, settings.sound, settings.showCompanion, final, skip, release]);
  useEffect(() => {
    if (foreman !== "reaction") return;
    const settle = () => { setForeman(null); setFailed(false); };
    const timer = window.setTimeout(settle, release ? 3800 : 4000);
    const hidden = () => { if (document.hidden) settle(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      stopAccent.current?.();
      stopAccent.current = null;
    };
  }, [foreman, release]);
  useEffect(() => { if (final || skip || !settings.showCompanion) { setForeman(null); setOpen(false); } },
    [final, skip, settings.showCompanion]);
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
  if (!settings.showCompanion) return <aside className={"companion companion-" + area}>
    <button className="companion-restore" onClick={() => updateSettings({ showCompanion: true })}>Show companion</button>
  </aside>;
  return <aside className={"companion companion-" + area} aria-label="Site companion"
    data-foreman={foreman ?? undefined} data-motion={settings.reducedMotion ? "reduced" : "system"}
    data-still={skip || undefined}
    onKeyDown={e => {
      if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }}>
    {area === "board" && <Island />}
    <button type="button" ref={button} className="companion-figure"
      aria-label={"Talk to " + name} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => {
        if (open) close();
        else if (!release || performance.now() - lastActivation >= 5000) {
          lastActivation = performance.now(); setOpen(true); react({ kind: "activate" });
        }
      }}>
      <Figure key={name} name={foreman ? "conkeldurr" : "timburr"} retry={retry} onFailure={setFailed}
        cue={motion} entrance={foreman ? "foreman" : undefined}
        idle={foreman || final ? null : release ? RELEASE_IDLE : AMBIENT_IDLE}
        still={settings.reducedMotion || skip} onPose={area === "board" ? publishBoardPose : undefined} />
      <span>{name}</span>
    </button>
    {open && <div id={id} className={"companion-note" + (repair && foreman !== "preview" ? " companion-repair" : "")}>
      {foreman === "reaction" && <span className="companion-announcement" role="status">Conkeldurr has a foreman report for turn {repair?.turn}.</span>}
      {release ? <p>{final ? "The final scores are in." : repair ? repair.attempts.some(a => a.status === "verified")
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
      {(!release || foreman === "reaction") && <button type="button" onClick={() => { setFailed(false); setForeman(foreman ? null : "preview"); }}>
        {foreman === "reaction" ? "Skip transformation" : foreman ? "Back to Timburr" : "Preview Conkeldurr"}
      </button>}
      {failed && <button type="button" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>
        Retry 3D model
      </button>}
      <button type="button" className="companion-close" aria-label="Dismiss" title="Dismiss" onClick={close}>×</button>
    </div>}
  </aside>;
}
