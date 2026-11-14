import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { MainMenu } from './pages/MainMenu';

// Keep the Three.js workspace out of the initial launcher download.
const Workspace = lazy(() => import('./pages/Workspace').then((module) => ({ default: module.Workspace })));

export function App() {
  return <Suspense fallback={<main className="launcher" role="status">Opening the workspace…</main>}>
    <Routes>
      <Route path="/" element={<MainMenu />} />
      <Route path="/play" element={<Workspace />} />
      <Route path="/about" element={<main className="launcher"><p>Degrees of Freedom is a game about how structures carry forces.</p><Link to="/">Choose an environment</Link></main>} />
      <Route path="*" element={<main className="launcher"><h1>Page not found</h1><Link to="/">Return to the launcher</Link></main>} />
    </Routes>
  </Suspense>;
}
