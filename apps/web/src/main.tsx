import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { prepareTurnSolver } from './game/turnAnalysis';
import './styles.css';

// The store restores a saved Shared table match synchronously when it loads,
// replaying each turn's assessment. Matches on the Rust turn solver need its
// WebAssembly instantiated first, so the app is imported only afterwards.
// If the module cannot load, the app still starts; such a save then reports
// that it could not be restored instead of being assessed differently.
async function start() {
  try {
    await prepareTurnSolver();
  } catch (error) {
    console.error('The structural solver could not be loaded.', error);
  }
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
}
void start();
