import { create } from 'zustand';
import { exampleModel } from './examples';
import {
  nodeKey,
  type GameModel,
  type GridPoint,
  type LevelId,
  type MemberType,
  type NodeItem,
  type Tool,
} from './model';
import { LEVELS } from './levels';
import { initialModel } from './layout';
import { memberIssue, nodeItemIssue, swapIssue } from './placementRules';
import { save, savedLevel, loadWithStatus, saveLevel, loadMode } from './persistence';
import { createGameSave, readGameSave, type GameSave } from './structuralState';
import { modeSetup, type GameMode, type PresentationStyle } from './modes';
import { bayEdges, bayIssue } from './bay';
export type Selection =
  | { type: 'member'; id: number }
  | { type: 'node'; key: string }
  | null;
interface GameState {
  levelId: LevelId;
  model: GameModel;
  persistenceError: string | null;
  history: GameModel[];
  future: GameModel[];
  mode: GameMode;
  style: PresentationStyle;
  setMode: (mode: GameMode) => void;
  setStyle: (style: PresentationStyle) => void;
  addBay: (origin: GridPoint, size: GridPoint, type: MemberType) => string | null;
  exportModel: () => GameSave;
  importModel: (value: unknown) => string | null;
  redo: () => void;
  tool: Tool;
  workK: number;
  chainStart: string | null;
  selected: Selection;
  setLevel: (id: LevelId) => void;
  reset: () => void;
  loadExample: () => boolean;
  newLayout: () => boolean;
  applyAutoDesign: (model: GameModel, sourceModel: GameModel) => boolean;
  swapTarget: MemberType;
  setSwapTarget: (type: MemberType) => void;
  undo: () => void;
  setTool: (tool: Tool) => void;
  setWorkK: (k: number) => void;
  setChainStart: (key: string | null) => void;
  setSelected: (selection: Selection) => void;
  addMember: (a: GridPoint, b: GridPoint, type: MemberType) => string | null;
  removeMember: (id: number) => void;
  swapMember: (id: number, type: MemberType) => string | null;
  swapAllOfType: (from: MemberType, to: MemberType) => number;
  toggleAttr: (p: GridPoint, type: NodeItem) => string | null;
  removeNodeAttrs: (key: string) => void;
}
const clone = (model: GameModel): GameModel => ({
  members: model.members.map((m) => ({ ...m })),
  attrs: Object.fromEntries(
    Object.entries(model.attrs).map(([k, v]) => [k, { ...v }]),
  ),
  nextId: model.nextId,
});
function cleanup(model: GameModel) {
  for (const [key, a] of Object.entries(model.attrs)) {
    if (!model.members.some((m) => m.a === key || m.b === key)) {
      delete a.joint;
      if (!a.locked) delete a.load;
    }
    if (!a.found && !a.joint && !a.load && !a.locked) delete model.attrs[key];
  }
}
/** Pure game state and validated, undoable edits; renderer and solver are independent. */
export const useGameStore = create<GameState>((set, get) => {
  const commit = (model: GameModel) =>
    set((s) => {
      const persisted = save(s.levelId, model, s.mode);
      return { model, persistenceError: persisted.ok ? null : 'Changes could not be saved. Existing stored data was preserved.', history: [...s.history.slice(-199), clone(s.model)], future: [] };
    });
  const startLevel = savedLevel();
  const initial = loadWithStatus(startLevel);
  return {
    levelId: startLevel,
    model: initial.model,
    persistenceError: initial.error,
    swapTarget: 'ipe',
    setSwapTarget: (swapTarget) => set({ swapTarget }),
    history: [],
    future: [],
    mode: 'challenge',
    style: 'engineering',
    setMode: (mode) => {
      if (mode === get().mode) return;
      if (mode === 'challenge') {
        get().setLevel(savedLevel());
        set({ mode });
        return;
      }
      const setup = modeSetup(mode), loaded = loadMode(setup.levelId, mode);
      set({ mode, levelId: setup.levelId, model: loaded.status === 'found' ? loaded.model : setup.model,
        persistenceError: loaded.status === 'error' ? 'Saved state could not be read; existing data was preserved.' : null,
        history: [], future: [], workK: LEVELS[setup.levelId].cliffH ?? 0, chainStart: null, selected: null });
    },
    setStyle: (style) => set({ style, chainStart: null, selected: null }),
    exportModel: () => createGameSave(get().levelId, get().model),
    importModel: (value) => {
      try {
        const model = readGameSave(value, get().levelId).save.model;
        commit(model);
        set({ chainStart: null, selected: null });
        return null;
      } catch (error) { return error instanceof Error ? error.message : String(error); }
    },
    addBay: (origin, size, type) => {
      const s = get(), model = clone(s.model);
      const issue = bayIssue(LEVELS[s.levelId], model, origin, size, type);
      if (issue) return issue;
      for (const [a, b] of bayEdges(origin, size))
        model.members.push({ id: model.nextId++, a: nodeKey(...a), b: nodeKey(...b), type });
      commit(model);
      return null;
    },
    redo: () => set((s) => {
      if (!s.future.length) return {};
      const model = s.future[s.future.length - 1];
      const persisted = save(s.levelId, model, s.mode);
      return { model, history: [...s.history.slice(-199), clone(s.model)], future: s.future.slice(0, -1), persistenceError: persisted.ok ? null : 'Changes could not be saved. Existing stored data was preserved.', chainStart: null, selected: null };
    }),
    tool: 'shs',
    workK: LEVELS[startLevel].cliffH ?? 0,
    chainStart: null,
    selected: null,
    setLevel: (levelId) => {
      saveLevel(levelId);
      const loaded = loadWithStatus(levelId);
      set((s) => ({
        levelId,
        model: loaded.model,
        persistenceError: loaded.error,
        history: [],
        future: [],
        workK: LEVELS[levelId].cliffH ?? 0,
        chainStart: null,
        selected: null,
        tool:
          s.tool === 'load' && LEVELS[levelId].type !== 'sandbox'
            ? 'shs'
            : s.tool,
      }));
    },
    reset: () => {
      const s = get();
      if (!s.model.members.length && !Object.keys(s.model.attrs).length) return;
      const attrs: GameModel['attrs'] = {};
      for (const [key, a] of Object.entries(s.model.attrs))
        if (a.locked)
          attrs[key] = {
            found: a.found,
            load: a.load,
            target: a.target,
            locked: true,
          };
      commit({ members: [], attrs, nextId: 1 });
      set({ chainStart: null, selected: null });
    },
    loadExample: () => {
      const model = exampleModel(get().levelId);
      if (!model) return false;
      commit(model);
      set({ chainStart: null, selected: null });
      return true;
    },
    newLayout: () => {
      const s = get();
      if (!LEVELS[s.levelId].random) return false;
      commit(initialModel(LEVELS[s.levelId]));
      set({ chainStart: null, selected: null });
      return true;
    },
    // A design is valid only for the exact model from which it was computed.
    applyAutoDesign: (model, sourceModel) => {
      if (get().model !== sourceModel) return false;
      commit(clone(model));
      return true;
    },
    undo: () =>
      set((s) => {
        if (!s.history.length) return {};
        const model = s.history[s.history.length - 1];
        const persisted = save(s.levelId, model, s.mode);
        return {
          model,
          persistenceError: persisted.ok ? null : 'Changes could not be saved. Existing stored data was preserved.',
          history: s.history.slice(0, -1),
          future: [...s.future.slice(-199), clone(s.model)],
          chainStart: null,
          selected: null,
        };
      }),
    setTool: (tool) => set({ tool, chainStart: null }),
    setWorkK: (k) =>
      set((s) => ({
        workK: Math.max(0, Math.min(LEVELS[s.levelId].nz, Math.round(k))),
      })),
    setChainStart: (chainStart) => set({ chainStart }),
    setSelected: (selected) => set({ selected }),
    addMember: (a, b, type) => {
      const s = get(),
        issue = memberIssue(LEVELS[s.levelId], s.model, a, b, type);
      if (issue) return issue;
      const model = clone(s.model);
      model.members.push({
        id: model.nextId++,
        a: nodeKey(...a),
        b: nodeKey(...b),
        type,
      });
      commit(model);
      return null;
    },
    removeMember: (id) => {
      const s = get();
      if (!s.model.members.some((m) => m.id === id)) return;
      const model = clone(s.model);
      model.members = model.members.filter((m) => m.id !== id);
      cleanup(model);
      commit(model);
      if (s.selected?.type === 'member' && s.selected.id === id)
        set({ selected: null });
    },
    swapMember: (id, type) => {
      const s = get(),
        m = s.model.members.find((m) => m.id === id);
      if (!m) return 'Member not found';
      const issue = swapIssue(LEVELS[s.levelId], s.model, m, type);
      if (issue) return issue;
      const model = clone(s.model);
      model.members.find((m) => m.id === id)!.type = type;
      commit(model);
      return null;
    },
    swapAllOfType: (from, to) => {
      const s = get(),
        model = clone(s.model);
      let count = 0;
      for (const m of model.members)
        if (m.type === from && !swapIssue(LEVELS[s.levelId], model, m, to)) {
          m.type = to;
          count++;
        }
      if (count) commit(model);
      return count;
    },
    toggleAttr: (p, type) => {
      const s = get(),
        issue = nodeItemIssue(LEVELS[s.levelId], s.model, p, type);
      if (issue) return issue;
      const model = clone(s.model),
        key = nodeKey(...p),
        a = model.attrs[key] ?? (model.attrs[key] = {});
      if (type === 'load') a.load = a.load ? undefined : 50;
      else a[type] = !a[type];
      cleanup(model);
      commit(model);
      return null;
    },
    removeNodeAttrs: (key) => {
      const s = get(),
        a = s.model.attrs[key];
      if (!a || (a.locked && !a.joint) || (!a.load && !a.joint && !a.found))
        return;
      const model = clone(s.model),
        next = model.attrs[key];
      if (next.load && !next.locked) delete next.load;
      else if (next.joint) delete next.joint;
      else delete next.found;
      cleanup(model);
      commit(model);
    },
  };
});
