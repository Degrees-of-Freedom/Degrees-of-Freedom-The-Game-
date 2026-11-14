import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEVELS } from './levels';
import { memberIssue, nodeItemIssue } from './placementRules';
import { useGameStore } from './store';
describe('voxel game rules', () => {
  beforeEach(() => {
    useGameStore.getState().setLevel('tower1');
    useGameStore.getState().reset();
  });
  it('validates placement, duplicates and supply, and restores supply on undo', () => {
    const s = useGameStore.getState();
    expect(s.addMember([0, 0, 0], [0, 0, 3], 'ipe')).toBeNull();
    expect(
      useGameStore.getState().addMember([0, 0, 3], [0, 0, 0], 'ipe'),
    ).toContain('already');
    expect(
      useGameStore.getState().addMember([0, 0, 0], [4, 0, 0], 'ipe'),
    ).toContain('Too long');
    useGameStore.getState().undo();
    expect(useGameStore.getState().model.members).toHaveLength(0);
  });
  it('loads reference examples as undoable edits', () => {
    expect(useGameStore.getState().loadExample()).toBe(true);
    expect(useGameStore.getState().model.members.length).toBeGreaterThan(0);
    useGameStore.getState().undo();
    expect(useGameStore.getState().model.members).toHaveLength(0);
    useGameStore.getState().setLevel('tower2');
    expect(useGameStore.getState().loadExample()).toBe(false);
  });
  it('clears as an undoable edit and opens bridge at deck height', () => {
    const s = useGameStore.getState();
    s.addMember([0, 0, 0], [0, 0, 2], 'shs');
    s.reset();
    expect(useGameStore.getState().model.members).toHaveLength(0);
    useGameStore.getState().undo();
    expect(useGameStore.getState().model.members).toHaveLength(1);
    useGameStore.getState().setLevel('bridge1');
    expect(useGameStore.getState().workK).toBe(3);
  });
  it('applies auto-design as one edit and refuses stale designs', () => {
    const s = useGameStore.getState();
    s.addMember([0, 0, 0], [0, 0, 2], 'shs');
    const source = useGameStore.getState().model;
    const design = {
      ...source,
      members: source.members.map((m) => ({ ...m, type: 'ipe' as const })),
    };
    expect(s.applyAutoDesign(design, source)).toBe(true);
    expect(useGameStore.getState().model.members[0].type).toBe('ipe');
    expect(s.applyAutoDesign(design, source)).toBe(false);
    useGameStore.getState().undo();
    expect(useGameStore.getState().model.members[0].type).toBe('shs');
  });
  it('persists a level independently and restores it on return', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    try {
      useGameStore.getState().addMember([0, 0, 0], [0, 0, 2], 'shs');
      useGameStore.getState().setLevel('sandbox');
      expect(data.get('voxstruct:level')).toBe('sandbox');
      useGameStore.getState().setLevel('tower1');
      expect(useGameStore.getState().model.members).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('limits batch swaps to available supply and refunds the old type', () => {
    const s = useGameStore.getState();
    for (let x = 0; x < 7; x++) s.addMember([x, 0, 0], [x, 0, 1], 'shs');
    expect(s.swapAllOfType('shs', 'ipe')).toBe(6);
    const model = useGameStore.getState().model;
    expect(model.members.filter((m) => m.type === 'ipe')).toHaveLength(6);
    expect(model.members.filter((m) => m.type === 'shs')).toHaveLength(1);
    useGameStore.getState().undo();
    expect(
      useGameStore.getState().model.members.every((m) => m.type === 'shs'),
    ).toBe(true);
  });
  it('leaves the sandbox-only load tool when switching to a challenge', () => {
    const s = useGameStore.getState();
    s.setLevel('sandbox');
    s.setTool('load');
    s.setLevel('tower1');
    expect(useGameStore.getState().tool).toBe('shs');
    s.setTool('inspect');
    s.setLevel('bridge1');
    expect(useGameStore.getState().tool).toBe('inspect');
  });
  it('preserves fixed pickup weights through edits and clear', () => {
    const s = useGameStore.getState();
    s.setLevel('pickup1');
    s.reset();
    expect(useGameStore.getState().model.attrs['4,4,3']).toMatchObject({
      load: 40,
      target: true,
      locked: true,
    });
    s.addMember([4, 4, 0], [4, 4, 3], 'shs');
    s.toggleAttr([4, 4, 3], 'joint');
    s.removeNodeAttrs('4,4,3');
    expect(useGameStore.getState().model.attrs['4,4,3']).toMatchObject({
      load: 40,
      target: true,
      locked: true,
    });
    s.removeMember(1);
    expect(useGameStore.getState().model.attrs['4,4,3'].load).toBe(40);
    expect(s.loadExample()).toBe(true);
    s.reset();
    expect(useGameStore.getState().model.members).toHaveLength(0);
    expect(useGameStore.getState().model.attrs['4,4,3'].load).toBe(40);
    s.undo();
    expect(useGameStore.getState().model.members.length).toBeGreaterThan(0);
  });
  it('rejects foundations in the lake and makes new random layouts undoable', () => {
    const s = useGameStore.getState();
    s.setLevel('pickup2');
    expect(
      nodeItemIssue(LEVELS.pickup2, s.model, [7, 7, 0], 'found'),
    ).toContain('solid ground');
    s.setLevel('pickupR');
    const previous = useGameStore.getState().model;
    expect(Object.values(previous.attrs).length).toBeGreaterThanOrEqual(3);
    s.reset();
    expect(useGameStore.getState().model.attrs).toEqual(previous.attrs);
    expect(s.newLayout()).toBe(true);
    s.undo();
    expect(useGameStore.getState().model).toEqual(previous);
  });
  it('keeps bridge bearings locked and prevents foundations in water', () => {
    useGameStore.getState().setLevel('bridge1');
    const s = useGameStore.getState();
    s.removeNodeAttrs('4,4,3');
    expect(useGameStore.getState().model.attrs['4,4,3'].locked).toBe(true);
    expect(
      nodeItemIssue(LEVELS.bridge1, s.model, [7, 4, 0], 'found'),
    ).toContain('solid ground');
    expect(
      memberIssue(LEVELS.bridge1, s.model, [3, 4, 3], [5, 4, 0], 'shs'),
    ).toContain('ground');
  });
  it('swaps members as one undoable edit and removes orphaned attachments', () => {
    useGameStore.getState().setLevel('sandbox');
    let s = useGameStore.getState();
    s.addMember([0, 0, 0], [0, 0, 2], 'shs');
    s.addMember([0, 0, 2], [0, 0, 4], 'shs');
    s.toggleAttr([0, 0, 4], 'joint');
    expect(useGameStore.getState().swapAllOfType('shs', 'ipe')).toBe(2);
    useGameStore.getState().undo();
    expect(
      useGameStore.getState().model.members.every((m) => m.type === 'shs'),
    ).toBe(true);
    useGameStore.getState().removeMember(2);
    expect(useGameStore.getState().model.attrs['0,0,4']).toBeUndefined();
  });
});
