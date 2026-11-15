import { useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SCENE_ART } from "../menu/art";
import { useSettings } from "../menu/settings";
import { Companion } from "../companion/Companion";
import "../pages/menu.css";

const ARROW_BACK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

/**
 * Shared frame for the menu pages: the Dusk scene behind a scrollable screen,
 * a back link, Esc-to-go-back, a page title and focus on the heading.
 *
 * Pages reached from the pause menu pass `state={{ from: "/play" }}`; their back
 * link then returns to the game instead of the menu hierarchy.
 */
export function MenuShell({
  title,
  documentTitle,
  parent,
  parentLabel,
  home = false,
  narrow = false,
  crumb,
  children,
}: {
  title?: string;
  documentTitle: string;
  parent?: string;
  parentLabel?: string;
  home?: boolean;
  narrow?: boolean;
  /** Quiet text beside the back link, e.g. a player count. */
  crumb?: string;
  children: ReactNode;
}) {
  const settings = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const fromGame =
    (location.state as { from?: unknown } | null)?.from === "/play";
  const back = fromGame
    ? { to: "/play", label: "Game" }
    : parent
      ? { to: parent, label: parentLabel ?? "Back" }
      : null;
  const backTo = back?.to;

  useEffect(() => {
    const previous = document.title;
    document.title = home
      ? "Degrees of Freedom: The Game"
      : `${documentTitle} – Degrees of Freedom`;
    return () => {
      document.title = previous;
    };
  }, [documentTitle, home]);

  useEffect(() => {
    document
      .querySelector<HTMLElement>("[data-menu-focus]")
      ?.focus({ preventScroll: true });
  }, [documentTitle]);

  useEffect(() => {
    if (!backTo) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        (event.target as HTMLElement | null)?.closest?.(
          "input, select, textarea",
        )
      )
        return;
      event.preventDefault();
      navigate(backTo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backTo, navigate]);

  return (
    <div
      className={`dof-menu dm-page${home ? " is-home" : ""}${settings.reducedMotion ? " reduce" : ""}`}
    >
      <div
        className="scene-wrap"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: SCENE_ART }}
      />
      <div className="shade" />
      <main className={`screen${home ? " home" : ""}`}>
        {home ? (
          children
        ) : (
          <div className={`wrap${narrow ? " narrow" : ""}`}>
            {back && (
              <div className="topbar">
                <Link className="back" to={back.to}>
                  {ARROW_BACK}
                  {back.label}
                </Link>
                {crumb && <span className="crumb">{crumb}</span>}
                <Companion area="menu" />
              </div>
            )}
            {title && (
              <h1 className="page" tabIndex={-1} data-menu-focus>
                {title}
              </h1>
            )}
            {children}
          </div>
        )}
      </main>
      {home && <Companion area="home" />}
    </div>
  );
}
