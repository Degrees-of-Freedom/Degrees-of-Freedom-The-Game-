import {expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createReleaseGame} from '../game/turns';
import {useGameStore} from '../game/store';
import {ReleaseBoard} from './ReleaseBoard';

const observed = vi.hoisted(() => ({scene: vi.fn(() => null), inspection: vi.fn(() => undefined)}));
vi.mock('../viewer/Scene', () => ({Scene: observed.scene}));
vi.mock('../viewer/useReleaseInspection', () => ({useReleaseInspection: observed.inspection}));
vi.mock('../companion/Companion', () => ({Companion: () => null}));

it('mounts the real Shared table eye menu without authorizing a pending-board solve', () => {
  const turn = createReleaseGame(0);
  const html = renderToStaticMarkup(<ReleaseBoard game={useGameStore.getState()} turn={turn}
    message="" notify={() => {}} onEnd={() => {}} onMenu={() => {}} menu={null} companion={{}}
    cameraMemory={{}} cue={() => {}} />);
  expect(html).toContain('aria-label="View modes, 4 active"');
  expect(html).toContain('title="View modes (V)"');
  expect(html).toContain('aria-label="Draw four cards"');
  expect(html).toContain('Current board awaits the next checkpoint');
  expect(observed.inspection).toHaveBeenCalledWith(expect.anything(), false);
  expect(observed.scene).toHaveBeenCalledWith(expect.objectContaining({result: null, loadPath: true,
    deformed: true, labels: true}), undefined);
});
