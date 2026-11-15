import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { LEVELS } from "../game/levels";
import { useGameStore } from "../game/store";
import { useSettings } from "../menu/settings";
import { SettingToggles } from "../pages/InfoPages";
import { MODE_CATALOG } from "./runtimeCatalog";
import "../pages/menu.css";
import "./PauseMenu.css";

type View = "main" | "settings" | "confirm";

/** Elements the focus trap may land on. */
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), a[href]";

/**
 * Pause overlay for the workspace, in the Dusk look whatever the environment.
 *
 * - Opens with the Menu button or `P`; `Esc` opens it only when nothing else in
 *   the workspace is using Esc (see `escapeBusy` and the store checks below).
 * - While open the app root is `inert` (no pointer, focus or scene input) and a
 *   capture-phase key listener swallows every key for the rest of the app, so
 *   scene shortcuts such as `R` or `1` cannot fire behind it.
 * - Restart calls an existing store action: `reset` (Creative, Challenge,
 *   Forensics, Load in space) or `newMatch` (Shared table, only once the match
 *   has finished because the store refuses it otherwise).
 */
export function PauseMenu({
  open,
  onOpen,
  onClose,
  escapeBusy,
  onMessage,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** True while the workspace has its own use for Esc (e.g. an open drawer). */
  escapeBusy: boolean;
  onMessage: (message: string) => void;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const mode = useGameStore((state) => state.mode);
  const levelId = useGameStore((state) => state.levelId);
  const turn = useGameStore((state) => state.turn);
  const [view, setView] = useState<View>("main");
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const live = useRef({ open, view, escapeBusy });
  live.current = { open, view, escapeBusy };

  const title = MODE_CATALOG.find((item) => item.id === mode)?.title ?? "";
  const subtitle =
    mode === "challenge" ? `${title} · ${LEVELS[levelId].name}` : title;
  const canRestart = mode !== "multiplayer" || !!turn?.finished;
  const restartText =
    mode === "multiplayer"
      ? "Deal a new match. The finished match is replaced."
      : mode === "forensics"
        ? "Restore the prepared structure. Your repairs are replaced. You can undo this."
        : "Clear every member you placed. Supports and loads set by the level stay. You can undo this.";

  const close = useCallback(() => {
    setView("main");
    onClose();
  }, [onClose]);

  function restart() {
    const game = useGameStore.getState();
    if (game.mode === "multiplayer") {
      const error = game.newMatch();
      onMessage(error ?? "New match dealt");
    } else {
      game.reset();
      onMessage(game.mode === "forensics" ? "Repair exercise restarted" : "Structure cleared");
    }
    close();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      const target = event.target as HTMLElement | null;
      const key = event.key;
      if (!now.open) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        // Let Escape dismiss the focused companion conversation first.
        if (key === "Escape" && target?.closest?.(".companion")?.querySelector('[aria-expanded="true"]')) return;
        if (target?.closest?.("input, textarea, select, [contenteditable]"))
          return;
        const state = useGameStore.getState();
        const escapeFree =
          !now.escapeBusy &&
          !state.chainStart &&
          !state.selected &&
          !state.selectedCardId;
        if (key.toLowerCase() === "p" || (key === "Escape" && escapeFree)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          onOpen();
        }
        return;
      }
      // Open: nothing else in the app may see the key.
      event.stopImmediatePropagation();
      if (key === "Escape" || key.toLowerCase() === "p") {
        event.preventDefault();
        if (key === "Escape" && now.view !== "main") setView("main");
        else close();
      } else if (key === "Tab" || key === "ArrowDown" || key === "ArrowUp") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
        ];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const step = key === "ArrowUp" || (key === "Tab" && event.shiftKey) ? -1 : 1;
        if (key === "Tab" || now.view === "main") {
          event.preventDefault();
          items[(at + step + items.length) % items.length].focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, onOpen]);

  // Block the app behind the overlay and manage focus.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      root?.removeAttribute("inert");
      const back = returnFocus.current;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLElement>("[data-first]")
      ?.focus({ preventScroll: true });
  }, [open, view]);

  if (!open) return null;
  return createPortal(
    <div
      className={`dof-menu dm-pause${settings.reducedMotion ? " reduce" : ""}`}
      role="presentation"
    >
      <div
        className="dm-pause-panel panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-pause-title"
        ref={panel}
      >
        {view === "main" && (
          <section>
            <h2 id="dm-pause-title">Paused</h2>
            <p className="msub">{subtitle}</p>
            <div className="mlist">
              <button className="btn mbtn primary" data-first onClick={close}>
                Resume
              </button>
              <button
                className="btn mbtn"
                disabled={!canRestart}
                onClick={() => setView("confirm")}
              >
                Restart
              </button>
              {!canRestart && (
                <p className="mnote">
                  A match can be restarted once it is finished.
                </p>
              )}
              <button
                className="btn mbtn"
                onClick={() => navigate("/how", { state: { from: "/play" } })}
              >
                How to play
              </button>
              <button className="btn mbtn" onClick={() => setView("settings")}>
                Settings
              </button>
              <div className="msep" />
              <button className="btn mbtn danger" onClick={() => navigate("/modes")}>
                Quit to menu
              </button>
              <p className="mnote">Progress is saved in this browser.</p>
            </div>
          </section>
        )}
        {view === "settings" && (
          <section>
            <h2 id="dm-pause-title">Settings</h2>
            <p className="msub">Saved in this browser.</p>
            <SettingToggles />
            <div className="mrow">
              <button className="btn mbtn" data-first onClick={() => setView("main")}>
                Back
              </button>
            </div>
          </section>
        )}
        {view === "confirm" && (
          <section>
            <h2 id="dm-pause-title">Restart?</h2>
            <p className="ask">{restartText}</p>
            <div className="mrow">
              <button className="btn mbtn" data-first onClick={() => setView("main")}>
                Cancel
              </button>
              <button className="btn mbtn danger" onClick={restart}>
                Restart
              </button>
            </div>
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
