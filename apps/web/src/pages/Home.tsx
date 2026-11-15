import { useRef, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { MenuShell } from "../components/MenuShell";

const ARROW = (
  <svg
    className="arrow"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Title screen. Continue opens the persisted workspace without changing any state. */
export function Home() {
  const nav = useRef<HTMLElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...(nav.current?.querySelectorAll<HTMLElement>("a") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? (at + 1) % items.length
        : (at - 1 + items.length) % items.length;
    items[at < 0 ? 0 : next].focus();
  };
  return (
    <MenuShell home documentTitle="Home">
      <div className="hero" onKeyDown={onKeyDown}>
        <div className="eyebrow">
          <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
            <circle cx="3" cy="11" r="3" fill="#f3ead8" />
            <circle cx="23" cy="11" r="3" fill="#f3ead8" />
            <path
              d="M3 11 L13 3 L23 11"
              stroke="#f2b134"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          The structural game
        </div>
        <h1 className="title">
          Degrees of
          <br />
          <em>Freedom</em>
        </h1>
        <p className="tagline">Build it. Load it. See what moves.</p>
        <nav className="menu" aria-label="Main menu" ref={nav}>
          <Link className="btn primary" to={"/match" + window.location.search} data-menu-focus>
            Play {ARROW}
          </Link>
          <Link className="btn" to="/how">
            How to play
          </Link>
          <Link className="btn" to="/settings">
            Settings
          </Link>
          <Link className="btn" to="/about">
            About
          </Link>
        </nav>
        <p className="continue">
          <Link to="/modes">More modes</Link>
        </p>
      </div>
      <div className="keys">
        Use <kbd>Up</kbd> <kbd>Down</kbd> and <kbd>Enter</kbd> to choose.{" "}
        <kbd>Esc</kbd> goes back.
      </div>
    </MenuShell>
  );
}
