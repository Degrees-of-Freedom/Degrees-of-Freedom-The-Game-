import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { MainMenu } from './pages/MainMenu';
// Keep the Three.js workspace out of the initial menu download.
const Workspace = lazy(() => import('./pages/Workspace').then((module) => ({ default: module.Workspace })));
export function App() {
  return <><header><NavLink className="brand" to="/">✳ <span>DEGREES OF FREEDOM<small>THE STRUCTURAL PLAYGROUND</small></span></NavLink><nav><NavLink to="/" end>Play</NavLink><NavLink to="/play">Workspace</NavLink><NavLink to="/about">About</NavLink></nav><span className="badge">BUILD · CONNECT · DISCOVER</span></header>
    <Suspense fallback={<main className="about" role="status">Opening your workspace…</main>}><Routes>
      <Route path="/" element={<MainMenu />} /><Route path="/play" element={<Workspace />} />
      <Route path="/about" element={<main className="about"><p className="eyebrow">THE IDEA</p><h1>A playground for <em>structural thinking.</em></h1><p>Build, experiment, and discover how structures carry forces. Every building style uses the same structural workspace.</p><p>Analysis is experimental. Shared-table play follows a configured playtest policy; numerical verification of its individual end connections is not yet available.</p><NavLink to="/">Choose a mode →</NavLink></main>} />
      <Route path="*" element={<main className="about"><h1>Page not found.</h1><NavLink to="/">Return to the menu</NavLink></main>} />
    </Routes></Suspense></>;
}
