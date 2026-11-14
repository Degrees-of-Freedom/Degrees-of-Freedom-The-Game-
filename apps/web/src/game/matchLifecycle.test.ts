import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('restores the active match across startup and mode changes, then persists a new match', async () => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  let { useGameStore } = await import('./store');
  useGameStore.getState().setMode('multiplayer');
  useGameStore.getState().setStyle('kit');
  expect(useGameStore.getState().newMatch()).toMatch(/Finish/);
  expect(useGameStore.getState().endTurn()).toBeNull();
  const turnAfterPass = useGameStore.getState().turn;
  expect(turnAfterPass?.turn).toBe(2);
  vi.resetModules();
  ({ useGameStore } = await import('./store'));
  expect(useGameStore.getState()).toMatchObject({ mode: 'multiplayer', style: 'kit', turn: turnAfterPass });
  useGameStore.getState().setMode('creative');
  useGameStore.getState().setMode('multiplayer');
  expect(useGameStore.getState().turn).toEqual(turnAfterPass);
  for (let n = 2; n <= 16; n++) expect(useGameStore.getState().endTurn()).toBeNull();
  expect(useGameStore.getState().turn?.finished).toBe(true);
  expect(useGameStore.getState().newMatch()).toBeNull();
  expect(useGameStore.getState().turn).toMatchObject({ seed: 2, turn: 1, finished: false, reports: [] });
  vi.resetModules();
  ({ useGameStore } = await import('./store'));
  expect(useGameStore.getState()).toMatchObject({
    mode: 'multiplayer', style: 'kit', selectedCardId: null,
    turn: { seed: 2, turn: 1, finished: false, reports: [] },
  });
});
