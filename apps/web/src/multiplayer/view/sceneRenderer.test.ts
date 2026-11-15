import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { sceneFixture } from './fixtures';
import { MultiplayerSceneRenderer } from './sceneRenderer';

vi.mock('three', async importActual => ({ ...await importActual<typeof THREE>(), WebGLRenderer: class { constructor() { throw new Error('Test: WebGL unavailable'); } } }));
vi.mock('three/addons/controls/OrbitControls.js', () => ({ OrbitControls: class {
  target = new THREE.Vector3(); enabled = true; update = vi.fn(); dispose = vi.fn();
} }));

class FakeCanvas extends EventTarget {
  width = 1; height = 1; hidden = false;
  parentElement = { getBoundingClientRect: () => ({ width: 900, height: 500 }) };
  focus = vi.fn();
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 500 }; }
  getContext() { return new Proxy({}, { get: () => () => undefined, set: () => true }); }
}
const dispatch = (canvas: FakeCanvas, type: string, values: Record<string, unknown>) => canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), values));

describe('scene lifecycle and interaction isolation', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup() {
    const raf = vi.fn(() => 1), cancel = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    vi.stubGlobal('requestAnimationFrame', raf); vi.stubGlobal('cancelAnimationFrame', cancel);
    const canvas = new FakeCanvas(), overlay = new FakeCanvas();
    const callbacks = { onSelection: vi.fn(), onTarget: vi.fn(), onFocus: vi.fn(), onTargetFocus: vi.fn(), onMode: vi.fn() };
    const options = { reducedMotion: false, paused: false, showFlow: true, showJoints: 'selected' as const, sectionMode: 'readable' as const };
    const renderer = new MultiplayerSceneRenderer(canvas as unknown as HTMLCanvasElement, overlay as unknown as HTMLCanvasElement, options, callbacks);
    renderer.setData(sceneFixture);
    return { renderer, canvas, overlay, callbacks, raf, cancel, disconnect, options };
  }
  it('falls back without disabling the scene, pauses and resumes exactly one animation loop', () => {
    const test = setup();
    expect(test.callbacks.onMode).toHaveBeenCalledWith('projected'); expect(test.canvas.hidden).toBe(true);
    expect(test.raf).toHaveBeenCalledTimes(1);
    test.renderer.resume(); expect(test.raf).toHaveBeenCalledTimes(1);
    test.renderer.pause(); expect(test.cancel).toHaveBeenCalledWith(1);
    test.renderer.resume(); expect(test.raf).toHaveBeenCalledTimes(2);
    test.renderer.dispose(); test.renderer.dispose(); test.renderer.resume();
    expect(test.disconnect).toHaveBeenCalledTimes(1); expect(test.raf).toHaveBeenCalledTimes(2);
  });
  it('synchronizes keyboard target focus, emits callbacks only, and removes listeners on dispose', () => {
    const test = setup();
    const targets = [{ id: 'one', kind: 'grid' as const, position: [2, 2, 2] as const }, { id: 'two', kind: 'grid' as const, position: [3, 3, 3] as const }];
    test.renderer.setTargets(Object.freeze(targets));
    dispatch(test.overlay, 'keydown', { key: 'ArrowRight' }); dispatch(test.overlay, 'keydown', { key: 'Enter' });
    expect(test.callbacks.onTargetFocus).toHaveBeenLastCalledWith('one');
    expect(test.callbacks.onTarget).toHaveBeenCalledWith(targets[0]);
    test.renderer.dispose(); dispatch(test.overlay, 'keydown', { key: 'Enter' });
    test.renderer.activateTarget('one'); test.renderer.setTargets(targets); test.renderer.activateTarget('two');
    expect(test.callbacks.onTarget).toHaveBeenCalledTimes(1);
    expect(sceneFixture.members[4].end).toEqual([12, 4, 4]);
  });
  it('ignores secondary clicks, multi-touch releases and all paused canvas interaction', () => {
    const test = setup();
    dispatch(test.overlay, 'pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
    dispatch(test.overlay, 'pointerup', { pointerId: 1, button: 2, clientX: 400, clientY: 200 });
    dispatch(test.overlay, 'pointerdown', { pointerId: 1, clientX: 400, clientY: 200 });
    dispatch(test.overlay, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 200 });
    dispatch(test.overlay, 'pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 200 });
    dispatch(test.overlay, 'pointerup', { pointerId: 2, button: 0, clientX: 400, clientY: 200 });
    expect(test.callbacks.onSelection).not.toHaveBeenCalled();
    test.renderer.pause(); test.renderer.setTargets([{ id: 'one', kind: 'grid', position: [2, 2, 2] }]);
    dispatch(test.overlay, 'keydown', { key: 'ArrowRight' });
    expect(test.callbacks.onTargetFocus).not.toHaveBeenCalled();
    test.renderer.dispose();
  });
});
