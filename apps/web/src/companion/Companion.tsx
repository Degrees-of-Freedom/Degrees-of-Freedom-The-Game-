import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FigureName } from "./figure";
import { createAnimator, type Animator } from "./animator";
import { AMBIENT_IDLE, CLIPS, REST as REST_POSE, RELEASE_IDLE, motionForCue, portraitTransform, type CompanionCue,
  type CompanionCueEvent, type MotionName } from "./motion";
import type { PublicRepairReport } from "../game/publicRepairReport";
import { RepairExplanation } from "./RepairExplanation";
import { updateSettings, useSettings } from "../menu/settings";
import { checkpointNotice, mistakeCount, takeForemanCue } from "./reactions";
import "./companion.css";

type Area = "home" | "menu" | "board" | "drawer";
type Stage = ReturnType<typeof import("./figure").createFigure>;

/** Keep the matching portrait available throughout lazy import/decoding. A
 * context loss replaces the canvas immediately and offers an explicit retry.
 *
 * One animator per mounted figure samples `motion.ts` clips and applies each
 * pose to whichever view is showing: the 3D rig, or the portrait's CSS
 * transform. `entrance` plays once when the figure mounts (Conkeldurr's
 * foreman arrival); `cue` plays whenever its identity changes. */
function Figure({ name, retry, onFailure, cue, entrance, idle, still }: {
  name: FigureName; retry: number; onFailure: (failed: boolean) => void;
  cue?: { motion: MotionName; id: number }; entrance?: MotionName;
  idle: readonly MotionName[] | null; still: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const portrait = useRef<HTMLImageElement>(null);
  const actor = useRef<Stage | undefined>(undefined);
  const animator = useRef<Animator | undefined>(undefined);
  const [view, setView] = useState<"portrait" | "model">("portrait");
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const motion = createAnimator({ apply(pose, playing) {
      if (viewRef.current === "model" && actor.current) actor.current.apply(pose);
      else if (portrait.current) portrait.current.style.transform = portraitTransform(pose);
      const element = host.current;
      if (element && element.dataset.clip !== (playing ?? undefined)) {
        if (playing) element.dataset.clip = playing; else delete element.dataset.clip;
      }
    } });
    animator.current = motion;
    return () => { motion.dispose(); animator.current = undefined; };
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
  const played = useRef(cue?.id);
  useEffect(() => {
    if (cue && cue.id !== played.current) {
      played.current = cue.id;
      animator.current!.play(cue.motion);
    }
  }, [cue]);
  // Hand any in-progress pose over when the 3D view replaces the portrait.
  useEffect(() => {
    if (view === "model" && portrait.current) portrait.current.style.transform = "";
    if (!animator.current?.current) actor.current?.apply(REST_POSE);
  }, [view]);
  useEffect(() => {
    const element = host.current!;
    // The foreman cue can change the character while the same sampler is
    // running. Keep posing the matching portrait as its GLB becomes ready.
    setView("portrait");
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

export interface CompanionProps {
  area: Area;
  repairs?: PublicRepairReport[];
  announceRepair?: boolean;
  announceFromTurn?: number;
  onPresented?: () => void;
  onForemanAccent?: () => void | (() => void);
  release?: boolean;
  /** Latest public gameplay scenario. Each new `id` plays its motion once. */
  cue?: CompanionCueEvent;
  final?: boolean;
  skip?: boolean;
}

// Cosmetic cooldowns survive privacy unmounts. No cards, seed or topology are recorded.
let lastActivation = -Infinity;
// The welcome wave plays once per page load, not on every route or reopen.
let greeted = false;
export function Companion({ area, repairs, announceRepair = false, announceFromTurn, onPresented, onForemanAccent,
  release = false, cue, final = false, skip = false }: CompanionProps) {
  const id = useId();
  const settings = useSettings();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [foreman, setForeman] = useState<"preview" | "shrink" | "reaction" | null>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const presented = useRef<string | null>(null);
  const accentPending = useRef(false);
  const [motion, setMotion] = useState<{ motion: MotionName; id: number }>();
  const react = useCallback((next: CompanionCue) =>
    setMotion(previous => ({ motion: motionForCue(next), id: (previous?.id ?? 0) + 1 })), []);
  // A reopened drawer can retain the preceding board cue. Only consume
  // events emitted while this companion is on screen.
  const seenCue = useRef(cue?.id);
  useEffect(() => {
    if (cue && cue.id !== seenCue.current) { seenCue.current = cue.id; react(cue); }
  }, [cue, react]);
  useEffect(() => { if (final) react({ kind: "victory" }); }, [final, react]);
  useEffect(() => {
    if (greeted || (area !== "home" && area !== "menu")) return;
    greeted = true;
    react({ kind: "greet" });
  }, [area, react]);
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
      if (!eligible && !final && !skip) {
        const repaired = [...currentNotice.attempts, ...currentNotice.jointAttempts].some(a => a.status === "verified");
        if (repaired && !currentNotice.pending.length) react({ kind: "repair" });
        else if (currentNotice.charge) react({ kind: "issue" });
      }
      onPresented?.();
    }
  }, [announceRepair, currentNotice, repairs, onPresented, settings.sound, settings.showCompanion, final, skip, still, release, react]);
  useEffect(() => {
    if (foreman !== "shrink") return;
    if (still) { setForeman("reaction"); return; }
    // Swap at the first authored crouch. One upstream clip drives both
    // characters through the crouch, rise and turn, on mesh or portrait.
    const foremanClip = CLIPS.foreman;
    const timer = window.setTimeout(() => setForeman("reaction"), foremanClip.duration * foremanClip.tracks.squash[1][0]);
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
    data-still={skip || undefined}
    onKeyDown={e => {
      if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }}>
    <button type="button" ref={button} className="companion-figure"
      aria-label={"Talk to " + name} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => {
        if (open) close();
        else if (!release || performance.now() - lastActivation >= 5000) {
          lastActivation = performance.now(); setOpen(true); react({ kind: "activate" });
        }
      }}>
      <Figure key={automatic ? "foreman-reaction" : name} name={evolved ? "conkeldurr" : "timburr"} retry={retry} onFailure={setFailed}
        cue={motion} entrance={foreman ? "foreman" : undefined}
        idle={foreman || final ? null : release ? RELEASE_IDLE : AMBIENT_IDLE} still={still} />
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
