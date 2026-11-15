import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { AiLab } from "./pages/AiLab";
import { Home } from "./pages/Home";
import { Companion } from "./companion/Companion";
import { ModeSelect } from "./pages/ModeSelect";
import { ModeSetup } from "./pages/ModeSetup";
import { About, HowToPlay, SettingsPage } from "./pages/InfoPages";

// Keep the Three.js workspace out of the initial menu download.
const Workspace = lazy(() =>
  import("./pages/Workspace").then((module) => ({ default: module.Workspace })),
);
const ReleaseMatch = lazy(() => import("./pages/ReleaseMatch"));

export function App() {
  return (
    <Suspense
      fallback={
        <main className="launcher" role="status">
          Opening the workspace…
        </main>
      }
    >
      <Routes>
        <Route path="/" element={<Home />} />
<Route path="/ai-lab" element={<AiLab />} />
        <Route path="/modes" element={<ModeSelect />} />
        <Route path="/setup/:mode" element={<ModeSetup />} />
        <Route path="/how" element={<HowToPlay />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<About />} />
        <Route path="/play" element={<Workspace />} />
        <Route path="/match" element={
          <Suspense fallback={<main className="dof-menu dm-pause dm-handoff"><p role="status">Opening Shared table…</p></main>}>
            <ReleaseMatch />
          </Suspense>
        } />
        <Route
          path="*"
          element={
            <main className="launcher">
              <h1>Page not found</h1>
              <Link to="/">Return to the main menu</Link>
              <Companion area="menu" />
            </main>
          }
        />
      </Routes>
    </Suspense>
  );
}


