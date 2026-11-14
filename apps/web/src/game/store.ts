import { create } from 'zustand';
import { exampleModel } from './examples';
import {
  nodeKey,
  parseNodeKey,
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
import { hasForensicsFixture, modeSetup, type GameMode, type PresentationStyle } from './modes';
import { missingBayEdges, bayIssue } from './bay';
import { nodeValid } from './terrain';
import { readSession, writeSession, type Session } from './session';
import { activeTurnHand, cancelTurnDraft, createTurnGame, endTurn, projectTurnModel, stageConnection, stageElement, stageLoad, type TurnState } from './turns';
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
  turn: TurnState | null;
  selectedCardId: string | null;
  selectCard: (id: string | null) => void;
  playConnection: (cardId: string, memberId: number, end: 'a' | 'b', jointId?: string) => string | null;
  cancelDraft: () => string | null;
  endTurn: () => string | null;
  setMode: (mode: GameMode) => void;
  newMatch: () => string | null;
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
  setNodeLoad: (key: string, magnitude: number) => string | null;
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
  const saveSession = (session: Session) => {
    try { return writeSession(localStorage, session); } catch { return false; }
  };
  const turnTransition = (result: ReturnType<typeof stageElement>): string | null => {
    if (!result.ok) return result.reason;
    const s = get(), turn = result.state;
    const saved = saveSession({ mode: s.mode, style: s.style, turn });
    set({ turn, model: projectTurnModel(turn), selectedCardId: null, chainStart: null, selected: null,
      persistenceError: saved ? null : 'Session could not be saved; existing stored data was preserved.' });
    return null;
  };
  const commit = (model: GameModel) =>
    set((s) => {
      const persisted = save(s.levelId, model, s.mode);
      return { model, persistenceError: persisted.ok ? null : 'Changes could not be saved. Existing stored data was preserved.', history: [...s.history.slice(-199), clone(s.model)], future: [] };
    });
  const startLevel = savedLevel();
  const initial = loadWithStatus(startLevel);
  let session: Session = { mode: 'challenge', style: 'engineering', turn: null };
  let sessionError: string | null = null;
  try {
    const loaded = readSession(localStorage);
    if (loaded.status === 'found') session = loaded.session;
    else if (loaded.status === 'invalid') sessionError = 'Session could not be read; existing stored data was preserved.';
  } catch { /* Storage is optional. */ }
  const setup = modeSetup(session.mode);
  const other = session.mode === 'challenge' || session.mode === 'multiplayer' ? null : loadMode(setup.levelId, session.mode);
  const levelId = session.mode === 'challenge' ? startLevel : setup.levelId;
  const initialModelValue = session.mode === 'multiplayer' && session.turn ? projectTurnModel(session.turn)
    : session.mode === 'challenge' ? initial.model : other?.status === 'found' ? other.model : setup.model;
  return {
    levelId,
    model: initialModelValue,
    persistenceError: sessionError ?? (other?.status === 'error' ? 'Saved state could not be read; existing data was preserved.' : initial.error),
    swapTarget: 'ipe',
    setSwapTarget: (swapTarget) => set({ swapTarget }),
    history: [],
    future: [],
    mode: session.mode,
    style: session.style,
    turn: session.turn,
    selectedCardId: null,
    selectCard: (id) => set((s) => ({ selectedCardId: id && s.turn && activeTurnHand(s.turn).some((c) => c.id === id) ? id : null, chainStart: null })),
    playConnection: (cardId, memberId, end, jointId) => {
      const s = get();
      return s.mode === 'multiplayer' && s.turn ? turnTransition(stageConnection(s.turn, cardId, memberId, end, jointId)) : 'No multiplayer game is active';
    },
    cancelDraft: () => {
      const s = get();
      return s.mode === 'multiplayer' && s.turn ? turnTransition(cancelTurnDraft(s.turn)) : 'No multiplayer game is active';
    },
    endTurn: () => {
      const s = get();
      return s.mode === 'multiplayer' && s.turn ? turnTransition(endTurn(s.turn)) : 'No multiplayer game is active';
    },
    setMode: (mode) => {
      if (mode === get().mode) return;
      const prior = get();
      if (mode === 'challenge') {
        set({ mode });
        get().setLevel(savedLevel());
        const saved = saveSession({ mode, style: prior.style, turn: prior.turn });
        if (!saved) set({ persistenceError: 'Session could not be saved; existing stored data was preserved.' });
        return;
      }
      const setup = modeSetup(mode), loaded = loadMode(setup.levelId, mode);
      const turn = mode === 'multiplayer' ? prior.turn ?? createTurnGame() : prior.turn;
      const saved = saveSession({ mode, style: prior.style, turn });
      set({ mode, turn, selectedCardId: null, levelId: setup.levelId, model: mode === 'multiplayer' && turn ? projectTurnModel(turn) : loaded.status === 'found' ? loaded.model : setup.model,
        persistenceError: !saved || loaded.status === 'error' ? 'Saved state could not be read or saved; existing data was preserved.' : null,
        history: [], future: [], workK: LEVELS[setup.levelId].cliffH ?? 0, chainStart: null, selected: null });
    },
    setStyle: (style) => {
      const s = get(), saved = saveSession({ mode: s.mode, style, turn: s.turn });
      set({ style, chainStart: null, selected: null, ...(saved ? {} : { persistenceError: 'Session could not be saved; existing stored data was preserved.' }) });
    },
    exportModel: () => createGameSave(get().levelId, get().model),
    importModel: (value) => {
      if (get().mode === 'multiplayer') return 'Model import is unavailable during a multiplayer game';
      try {
        const model = readGameSave(value, get().levelId).save.model;
        const s = get(), level = LEVELS[s.levelId];
        if ([...model.members.flatMap((m) => [m.a, m.b]), ...Object.keys(model.attrs)].some((key) => !nodeValid(level, parseNodeKey(key))))
          return 'Imported geometry is outside this level';
        const setupAttrs = modeSetup(s.mode).levelId === s.levelId ? modeSetup(s.mode).model.attrs : initialModel(level).attrs;
        for (const [key, attrs] of Object.entries(setupAttrs)) {
          const imported = model.attrs[key];
          if (attrs.locked && (!imported?.locked || imported.found !== attrs.found || imported.load !== attrs.load || imported.target !== attrs.target))
            return 'Imported model must preserve the level setup';
        }
        for (const [key, attrs] of Object.entries(model.attrs)) {
          if (attrs.locked && !setupAttrs[key]?.locked) return 'Imported model contains an unknown locked fixture';
        }
        commit(model);
        set({ chainStart: null, selected: null });
        return null;
      } catch (error) { return error instanceof Error ? error.message : String(error); }
    },
    addBay: (origin, size, type) => {
      if (get().mode === 'multiplayer') return 'Bays cannot be placed during a multiplayer turn';
      const s = get(), model = clone(s.model);
      const issue = bayIssue(LEVELS[s.levelId], model, origin, size, type);
      if (issue) return issue;
      for (const [a, b] of missingBayEdges(model, origin, size))
        model.members.push({ id: model.nextId++, a: nodeKey(...a), b: nodeKey(...b), type });
      commit(model);
      return null;
    },
    redo: () => set((s) => {
      if (s.mode === 'multiplayer' || !s.future.length) return {};
      const model = s.future[s.future.length - 1];
      const persisted = save(s.levelId, model, s.mode);
      return { model, history: [...s.history.slice(-199), clone(s.model)], future: s.future.slice(0, -1), persistenceError: persisted.ok ? null : 'Changes could not be saved. Existing stored data was preserved.', chainStart: null, selected: null };
    }),
    tool: 'shs',
    workK: LEVELS[levelId].cliffH ?? 0,
    chainStart: null,
    selected: null,
    setLevel: (levelId) => {
      if (get().mode !== 'challenge') return;
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
      if (s.mode === 'multiplayer') return;
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
      if (get().mode === 'multiplayer') return false;
      const model = exampleModel(get().levelId);
      if (!model) return false;
      commit(model);
      set({ chainStart: null, selected: null });
      return true;
    },
    newLayout: () => {
      const s = get();
      if (s.mode === 'multiplayer') return false;
      if (!LEVELS[s.levelId].random) return false;
      commit(initialModel(LEVELS[s.levelId]));
      set({ chainStart: null, selected: null });
      return true;
    },
    // A design is valid only for the exact model from which it was computed.
    applyAutoDesign: (model, sourceModel) => {
      if (get().mode === 'multiplayer' || get().model !== sourceModel) return false;
      commit(clone(model));
      return true;
    },
    undo: () =>
      set((s) => {
        if (s.mode === 'multiplayer' || !s.history.length) return {};
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
      const s = get();
      if (s.mode === 'multiplayer') {
        if (!s.turn || !s.selectedCardId) return 'Select an element card first';
        const card = activeTurnHand(s.turn).find((c) => c.id === s.selectedCardId);
        if (!card || card.kind !== 'element') return 'Select an element card first';
        return turnTransition(stageElement(s.turn, card.id, nodeKey(...a), nodeKey(...b)));
      }
      const
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
      if (s.mode === 'multiplayer') return;
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
      if (s.mode === 'multiplayer') return 'Members cannot be changed during a multiplayer turn';
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
      if (s.mode === 'multiplayer') return 0;
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
      const s = get();
      if (s.mode === 'multiplayer') {
        if (type !== 'load' || !s.turn || !s.selectedCardId) return 'Select a load card to place a load';
        const card = activeTurnHand(s.turn).find((c) => c.id === s.selectedCardId);
        if (!card || card.kind !== 'load') return 'Select a load card first';
        return turnTransition(stageLoad(s.turn, card.id, nodeKey(...p)));
      }
      const
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
    setNodeLoad: (key, magnitude) => {
      const s = get(), attrs = s.model.attrs[key];
      if (s.mode === 'multiplayer') return 'Loads cannot be edited during a multiplayer turn';
      if (!attrs?.load || attrs.locked) return 'Choose an editable load';
      if (!Number.isFinite(magnitude) || magnitude <= 0) return 'Load magnitude must be positive and finite';
      if (attrs.load === magnitude) return null;
      const model = clone(s.model);
      model.attrs[key].load = magnitude;
      commit(model);
      return null;
    },
    removeNodeAttrs: (key) => {
      const s = get(),
        a = s.model.attrs[key];
      if (s.mode === 'multiplayer') return;
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
