import { create } from "zustand";
import type { ConnectionProfile } from "./jointFreedom";
import type { SolverAdapter } from "@dof/solver-contract";
import { analyzeCompletedTurn, assessTurn } from "./turnAnalysis";
import { SCORED_CATALOGUE, isScoredCatalogue, type CatalogueId } from "./cardCatalogue";
import { assessTurnWithSolver } from "./turnSolve";
import { getSettings } from "../menu/settings";
import { solverForSettings } from "../solver";
import { exampleModel } from "./examples";
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type GridPoint,
  type Restraint,
  type LoadDirection,
  type LevelId,
  type MemberType,
  type NodeItem,
  type Tool,
} from "./model";
import { LEVELS } from "./levels";
import { initialModel } from "./layout";
import { memberIssue, nodeItemIssue, swapIssue } from "./placementRules";
import {
  save,
  savedLevel,
  loadWithStatus,
  saveLevel,
  loadMode,
} from "./persistence";
import { createGameSave, readGameSave, type GameSave } from "./structuralState";
import {
  hasForensicsFixture,
  modeSetup,
  type GameMode,
  type PresentationStyle,
} from "./modes";
import { missingBayEdges, bayIssue } from "./bay";
import { cycleBayBrace, type BayFace } from "./bayBrace";
import { nodeValid } from "./terrain";
import { openSessionWriter, sessionLocks, SESSION_CONFLICT, SESSION_KEY, SESSION_UNSAVED, type Session } from "./session";
import {
  activeTurnHand,
  cancelTurnDraft,
  createTurnGame,
  endTurn,
  projectTurnModel,
  stageConnection,
  stageElement,
  stageLoad,
  type TurnState,
} from "./turns";
export type Selection =
  | { type: "member"; id: number }
  | { type: "node"; key: string }
  | null;
interface GameState {
  importPrivateMatch?: (bytes: string) => Promise<string | null>;
  pendingPrivateBytes?: () => string | null;
  levelId: LevelId;
  model: GameModel;
  persistenceError: string | null;
  sessionConflict: boolean;
  sessionSave: "idle" | "writing" | "committing" | "failed" | "invalid";
  savedRevision: number | null;
  hasSessionBackup: boolean;
  privateRecoveryBytes: () => string | null;
  retrySessionSave: () => void;
  recoverSession: (choice: "backup" | "restart", hasExternalCopy?: boolean) => Promise<"saved" | "failed" | "needs-copy">;
  history: GameModel[];
  future: GameModel[];
  mode: GameMode;
  style: PresentationStyle;
  turn: TurnState | null;
  selectedCardId: string | null;
  selectedConnectionProfile?: ConnectionProfile;
  setConnectionProfile: (profile?: ConnectionProfile) => void;
  loadBrush: { magnitude: number; direction: LoadDirection };
  setLoadBrush: (magnitude: number, direction: LoadDirection) => void;
  selectCard: (id: string | null) => void;
  playElement: (cardId: string, a: string, b: string) => string | null;
  playLoad: (cardId: string, jointId: string) => string | null;
  playConnection: (
    cardId: string,
    memberId: number,
    end: "a" | "b",
    jointId?: string,
    profile?: ConnectionProfile,
  ) => string | null;
  cancelDraft: () => string | null;
  /**
   * Commit the staged turn. The verified in-browser analysis decides issues,
   * penalties, repair and score; the structural solver chosen in Settings
   * runs alongside as a recorded cross-check. Resolves to an issue message,
   * or null once the turn is committed.
   */
  endTurn: () => Promise<string | null>;
  /** True while an ended turn's cross-check runs; staging is frozen meanwhile. */
  turnAnalysing: boolean;
  /**
   * Solver for the end-of-turn cross-check. Null means the one chosen in the
   * settings; tests set an explicit one.
   */
  turnSolver: SolverAdapter | null;
  setMode: (mode: GameMode, catalogue?: CatalogueId) => void;
  newMatch: (catalogue?: CatalogueId) => string | null;
  setStyle: (style: PresentationStyle) => void;
  addBay: (
    origin: GridPoint,
    size: GridPoint,
    type: MemberType,
  ) => string | null;
  cycleBrace: (face: BayFace) => string | null;
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
  loadLibraryModel: (model: GameModel) => void;
  libraryLoadRevision: number;
  newLayout: () => boolean;
  applyAutoDesign: (model: GameModel, sourceModel: GameModel) => boolean;
  swapTarget: MemberType;
  setSwapTarget: (type: MemberType) => void;
  undo: () => void;
  setTool: (tool: Tool) => void;
  placeFoundation: (point: GridPoint) => string | null;
  setWorkK: (k: number) => void;
  setChainStart: (key: string | null) => void;
  setSelected: (selection: Selection) => void;
  addMember: (a: GridPoint, b: GridPoint, type: MemberType) => string | null;
  removeMember: (id: number) => void;
  swapMember: (id: number, type: MemberType) => string | null;
  swapAllOfType: (from: MemberType, to: MemberType) => number;
  toggleAttr: (p: GridPoint, type: NodeItem) => string | null;
  setNodeLoad: (key: string, magnitude: number) => string | null;
  setNodeRestraint: (key: string, restraint: Restraint) => string | null;
  setNodeLoadDirection: (
    key: string,
    direction: LoadDirection,
  ) => string | null;
  removeNodeAttrs: (key: string) => void;
}
const clone = (model: GameModel): GameModel => ({
  members: model.members.map((m) => ({ ...m })),
  attrs: Object.fromEntries(
    Object.entries(model.attrs).map(([k, v]) => [
      k,
      {
        ...v,
        ...(v.restraint ? { restraint: [...v.restraint] as Restraint } : {}),
      },
    ]),
  ),
  nextId: model.nextId,
});
function cleanup(model: GameModel) {
  for (const [key, a] of Object.entries(model.attrs)) {
    if (!model.members.some((m) => m.a === key || m.b === key)) {
      delete a.joint;
      if (!a.locked) delete a.load;
    }
    if (!a.load) delete a.loadDirection;
    if (!a.found) delete a.restraint;
    if (!a.found && !a.joint && !a.load && !a.locked) delete model.attrs[key];
  }
}
/** Levels opens the prototype's example two grid levels above the ground. */
function initialWorkK(style: PresentationStyle, levelId: LevelId, model: GameModel): number {
  const level = LEVELS[levelId];
  const ground = level.cliffH ?? 0;
  return (style === 'levels' || style === 'engineering') && model.members.length ? Math.min(level.nz, ground + 2) : ground;
}
/** Pure game state and validated, undoable edits; renderer and solver are independent. */
export const useGameStore = create<GameState>((set, get) => {
  const saveModel = (levelId: LevelId, model: GameModel, mode: GameMode) => {
    if (mode === "forensics") {
      const stored = loadMode(levelId, mode);
      if (stored.status === "found" && !hasForensicsFixture(stored.model))
        return {
          ok: false as const,
          message: "Saved repair fixture is incompatible.",
        };
    }
    return save(levelId, model, mode);
  };
  let writer: ReturnType<typeof openSessionWriter> | undefined;
  // Keep the exact validated candidate for retry. Replaying the button press
  // here would run analysis, draw cards or record a final result a second time.
  let attempted: Session | null = null;
  let deferredTurn: TurnState | null = null;
  const turnView = (turn: TurnState) => ({ turn, model: projectTurnModel(turn),
    selectedCardId: null, chainStart: null, selected: null });
  const saveSession = (session: Session) => {
    attempted = session;
    const result = writer?.save(session) ?? "failed";
    if (result === "saved") set({ savedRevision: writer!.revision() });
    if (session.mode === "multiplayer") {
      if (result === "queued") set({ sessionSave: deferredTurn ? "committing" : "writing" });
      if (result === "failed") set({ sessionSave: "failed", persistenceError: SESSION_UNSAVED });
    }
    return result;
  };
  function saveBlocked() {
    if (get().sessionConflict) return SESSION_CONFLICT;
    if (get().sessionSave === "invalid") return "Recover the saved session before playing.";
    if (get().sessionSave === "failed") return SESSION_UNSAVED;
    return deferredTurn ? "Saving the current turn." : null;
  }
  const turnTransition = (
    result: ReturnType<typeof stageElement>,
  ): string | null => {
    const blocked = saveBlocked();
    if (blocked) return blocked;
    // The turn criteria freeze edits while a completed turn is analysed.
    if (get().turnAnalysing) return "The turn is being analysed. Wait for the result.";
    if (!result.ok) return result.reason;
    const s = get(),
      turn = result.state;
    if (turn.board !== s.turn?.board) deferredTurn = turn;
    const saved = saveSession({ mode: s.mode, style: s.style, turn });
    if (saved === "conflict") return SESSION_CONFLICT;
    if (saved === "failed") return SESSION_UNSAVED;
    if (deferredTurn && saved === "queued") return null;
    deferredTurn = null;
    set({ ...turnView(turn), persistenceError: null });
    return null;
  };
  const commit = (model: GameModel) =>
    set((s) => {
      const persisted = saveModel(s.levelId, model, s.mode);
      return {
        model,
        persistenceError: persisted.ok
          ? null
          : "Changes could not be saved. Existing stored data was preserved.",
        history: [...s.history.slice(-199), clone(s.model)],
        future: [],
      };
    });
  const startLevel = savedLevel();
  const initial = loadWithStatus(startLevel);
  let session: Session = {
    mode: "challenge",
    style: "engineering",
    turn: null,
  };
  let sessionError: string | null = null;
  try {
    writer = openSessionWriter(localStorage, sessionLocks(), (status, lastSaved, target) => {
      if (get()?.importPrivateMatch) return; // Secondary workspace writes never own the release match.
      if (status === "conflict") {
        // Never reveal the other tab's state. A reload reconstructs the newer
        // revision and goes through the regular private handoff.
        const turn = lastSaved?.turn ?? null;
        deferredTurn = null;
        attempted = null;
        set({ sessionConflict: true, sessionSave: "idle", persistenceError: SESSION_CONFLICT, turn,
          ...(get().mode === "multiplayer" && turn ? { model: projectTurnModel(turn) } : {}),
          selected: null, chainStart: null, selectedCardId: null });
      } else if (target === attempted && target) {
        // An earlier queued draft cannot acknowledge a later commit.
        if (status === "failed") set({ sessionSave: target.mode === "multiplayer" ? "failed" : "idle", persistenceError: SESSION_UNSAVED });
        if (status === "saved") {
          const accepted = deferredTurn;
          attempted = null;
          deferredTurn = null;
          set({ sessionSave: "idle", savedRevision: writer?.revision() ?? null, persistenceError: null, ...(accepted ? turnView(accepted) : {}) });
        }
      } else if (status === "saved") {
        set({ savedRevision: writer?.revision() ?? null });
      }
    });
    const loaded = writer.initial;
    if (loaded.status === "found") session = loaded.session;
    else if (loaded.status === "invalid")
      sessionError = loaded.reason
        ? `Saved match could not be restored. ${loaded.reason} Existing stored data was preserved.`
        : "Session could not be read; existing stored data was preserved.";
    if (typeof window !== "undefined") {
      const changed = (event: StorageEvent) => {
        if (event.storageArea === localStorage && (event.key === SESSION_KEY || event.key === null)) writer?.current();
      };
      window.addEventListener("storage", changed);
      import.meta.hot?.dispose(() => window.removeEventListener("storage", changed));
    }
  } catch {
    /* Storage is optional. */
  }
  const setup = modeSetup(session.mode);
  const other =
    session.mode === "challenge" || session.mode === "multiplayer"
      ? null
      : loadMode(setup.levelId, session.mode);
  const validOther =
    other?.status === "found" &&
    (session.mode !== "forensics" || hasForensicsFixture(other.model));
  const levelId = session.mode === "challenge" ? startLevel : setup.levelId;
  const initialModelValue =
    session.mode === "multiplayer" && session.turn
      ? projectTurnModel(session.turn)
      : session.mode === "challenge"
        ? initial.model
        : validOther && other?.status === "found"
          ? other.model
          : setup.model;
  return {
    levelId,
    model: initialModelValue,
    sessionConflict: false,
    sessionSave: sessionError ? "invalid" : "idle",
    savedRevision: writer?.revision() ?? null,
    hasSessionBackup: Boolean(sessionError && writer?.hasBackup()),
    privateRecoveryBytes: () => {
      if (get().sessionSave === "invalid") return writer?.original() ?? null;
      if (attempted && writer) return writer.serialize(attempted);
      if (attempted) return JSON.stringify({ version: 1, mode: attempted.mode, style: attempted.style,
        turn: attempted.turn && { version: attempted.turn.version, seed: attempted.turn.seed,
          catalogue: attempted.turn.catalogue, ...(attempted.turn.engine && { engine: attempted.turn.engine }),
          events: attempted.turn.events } });
      return null;
    },
    retrySessionSave: () => {
      if (get().sessionSave !== "failed" || !attempted) return;
      const turn = attempted.turn;
      if (saveSession(attempted) === "saved") {
        deferredTurn = null;
        attempted = null;
        set({ sessionSave: "idle", persistenceError: null, ...(turn ? turnView(turn) : {}) });
      }
    },
    recoverSession: async (choice, hasExternalCopy = false) => {
      if (!writer || get().sessionSave !== "invalid") return "failed";
      const target = choice === "backup" ? "backup" :
        { mode: "multiplayer" as const, style: "grow-dusk" as const, turn: createTurnGame(1, SCORED_CATALOGUE) };
      const result = await writer.recover(target, hasExternalCopy);
      if (result === "saved") return "saved";
      if (result === "needs-copy") {
        set({ persistenceError: "Local storage could not keep a copy of the damaged session. Download the original to continue." });
        return result;
      }
      if (result !== "conflict") set({ persistenceError: "Recovery could not complete. The original bytes are still available for download." });
      return "failed";
    },
    persistenceError:
      sessionError ??
      (other?.status === "error" || (other?.status === "found" && !validOther)
        ? "Saved state could not be read; existing data was preserved."
        : initial.error),
    swapTarget: "ipe",
    libraryLoadRevision: 0,
    setSwapTarget: (swapTarget) => set({ swapTarget }),
    history: [],
    future: [],
    mode: session.mode,
    style: session.style,
    turn: session.turn,
    selectedCardId: null,
    setConnectionProfile: (selectedConnectionProfile) => set({ selectedConnectionProfile }),
    loadBrush: { magnitude: 50, direction: "-Z" },
    setLoadBrush: (magnitude, direction) => {
      if (
        !Number.isFinite(magnitude) ||
        magnitude <= 0 ||
        !["-Z", "+Z", "+X", "-X", "+Y", "-Y"].includes(direction)
      )
        return;
      set({ loadBrush: { magnitude, direction } });
    },
    selectCard: (id) =>
      set((s) => ({
        selectedConnectionProfile: undefined,
        selectedCardId:
          id && s.turn && activeTurnHand(s.turn).some((c) => c.id === id)
            ? id
            : null,
        chainStart: null,
      })),
    playElement: (cardId, a, b) => {
      const s = get();
      return s.mode === "multiplayer" && s.turn
        ? turnTransition(stageElement(s.turn, cardId, a, b))
        : "No multiplayer game is active";
    },
    playLoad: (cardId, jointId) => {
      const s = get();
      return s.mode === "multiplayer" && s.turn
        ? turnTransition(stageLoad(s.turn, cardId, jointId))
        : "No multiplayer game is active";
    },
    playConnection: (cardId, memberId, end, jointId, profile) => {
      const s = get();
      return s.mode === "multiplayer" && s.turn
        ? turnTransition(
            stageConnection(s.turn, cardId, memberId, end, jointId, profile ?? s.selectedConnectionProfile),
          )
        : "No multiplayer game is active";
    },
    cancelDraft: () => {
      const s = get();
      return s.mode === "multiplayer" && s.turn
        ? turnTransition(cancelTurnDraft(s.turn))
        : "No multiplayer game is active";
    },
    turnAnalysing: false,
    turnSolver: null,
    endTurn: async () => {
      const s = get();
      const blocked = saveBlocked();
      if (blocked) return blocked;
      if (s.mode !== "multiplayer" || !s.turn) return "No multiplayer game is active";
      if (s.turn.finished) return "This turn has already ended.";
      if (s.turnAnalysing) return "The turn is already being analysed.";
      // Analyse exactly the turn that was ended. Staging is frozen while the
      // solver runs, and the commit is refused if the table changed anyway
      // (a new match, a mode switch), so a slow answer is never applied to a
      // different turn.
      const ended = s.turn;
      let prepared: { status: ReturnType<typeof assessTurn>; analysis: ReturnType<typeof analyzeCompletedTurn>["analysis"] | undefined; spring: boolean };
      try {
        // Axial springs are outside the applied-load evidence formulation.
        prepared = [...ended.board.members, ...ended.draft.members].some((m) => m.type === "spring")
          ? { status: assessTurn(ended), analysis: undefined, spring: true }
          : { ...analyzeCompletedTurn(ended), spring: false };
      } catch {
        return "Could not prepare the turn analysis. The draft is still open.";
      }
      // Cross-check with the selected structural solver. It does not change
      // the scored verdict; its account is recorded, and a disagreement is
      // stated, so the two can be compared turn by turn.
      let reason: string | undefined;
      if (!prepared.spring) {
        set({ turnAnalysing: true });
        try {
          const solver = s.turnSolver ?? solverForSettings(getSettings());
          const check = await assessTurnWithSolver(ended, solver, prepared.status);
          if (check.solver !== "voxel")
            reason = check.status === prepared.status
              ? `Structural check agrees. ${check.reason}`
              : `Structural check disagrees with the scored analysis (${prepared.status}). ${check.reason}`;
        } finally {
          set({ turnAnalysing: false });
        }
        if (get().turn !== ended) return "The table changed during analysis, so the turn was not committed.";
      }
      return turnTransition(endTurn(ended, ended.turn, prepared.status, prepared.analysis, reason));
    },
    newMatch: (catalogue) => {
      const s = get();
      if (s.mode !== "multiplayer" || !s.turn?.finished)
        return "Finish the current match before starting another.";
      return turnTransition({
        ok: true,
        state: createTurnGame(s.turn.seed + 1, catalogue ?? (isScoredCatalogue(s.turn.catalogue) ? s.turn.catalogue : SCORED_CATALOGUE)),
      });
    },
    setMode: (mode, catalogue = SCORED_CATALOGUE) => {
      if (mode === get().mode) return;
      if (saveBlocked()) return;
      const prior = get();
      if (mode === "challenge") {
        const saved = saveSession({
          mode,
          style: prior.style,
          turn: prior.turn,
        });
        if (saved === "conflict") return;
        set({ mode });
        get().setLevel(savedLevel());
        if (saved === "failed")
          set({
            persistenceError:
              "Session could not be saved; existing stored data was preserved.",
          });
        return;
      }
      const setup = modeSetup(mode),
        loaded = loadMode(setup.levelId, mode);
      const validLoaded =
        loaded.status === "found" &&
        (mode !== "forensics" || hasForensicsFixture(loaded.model));
      const turn =
        mode === "multiplayer" ? (prior.turn ?? createTurnGame(1, catalogue)) : prior.turn;
      const saved = saveSession({ mode, style: prior.style, turn });
      if (saved === "conflict") return;
      set({
        mode,
        turn,
        selectedCardId: null,
        levelId: setup.levelId,
        model:
          mode === "multiplayer" && turn
            ? projectTurnModel(turn)
            : validLoaded && loaded.status === "found"
              ? loaded.model
              : setup.model,
        persistenceError:
          saved === "failed" ||
          loaded.status === "error" ||
          (loaded.status === "found" && !validLoaded)
            ? "Saved state could not be read or saved; existing data was preserved."
            : null,
        history: [],
        future: [],
        workK: initialWorkK(prior.style, setup.levelId, mode === 'multiplayer' && turn ? projectTurnModel(turn) : validLoaded && loaded.status === 'found' ? loaded.model : setup.model),
        chainStart: null,
        selected: null,
      });
    },
    setStyle: (style) => {
      if (saveBlocked()) return;
      const s = get(),
        saved = saveSession({ mode: s.mode, style, turn: s.turn });
      if (saved === "conflict") return;
      set({
        style,
        ...((style === 'levels' || style === 'engineering') && s.style !== 'levels' && s.style !== 'engineering' ? { workK: initialWorkK(style, s.levelId, s.model) } : {}),
        chainStart: null,
        selected: null,
        ...(saved !== "failed"
          ? {}
          : {
              persistenceError: sessionError ??
                "Session could not be saved; existing stored data was preserved.",
            }),
      });
    },
    loadLibraryModel: (source) => {
      const model = createGameSave("library", source).model;
      // Challenge persistence provides a dedicated library slot; retain the live
      // turn state and all creative/repair saves when leaving those modes.
      if (get().mode !== "challenge") get().setMode("challenge");
      if (get().levelId !== "library") get().setLevel("library");
      commit(model);
      set(s => ({ chainStart: null, selected: null, workK: 0, libraryLoadRevision: s.libraryLoadRevision + 1 }));
    },
    exportModel: () => createGameSave(get().levelId, get().model),
    importModel: (value) => {
      if (get().mode === "multiplayer")
        return "Model import is unavailable during a multiplayer game";
      if (get().mode === "forensics")
        return "Model import is unavailable during a repair exercise";
      try {
        const model = readGameSave(value, get().levelId).save.model;
        const s = get(),
          level = LEVELS[s.levelId];
        if (
          [
            ...model.members.flatMap((m) => [m.a, m.b]),
            ...Object.keys(model.attrs),
          ].some((key) => !nodeValid(level, parseNodeKey(key)))
        )
          return "Imported geometry is outside this level";
        const setupAttrs =
          modeSetup(s.mode).levelId === s.levelId
            ? modeSetup(s.mode).model.attrs
            : initialModel(level).attrs;
        for (const [key, attrs] of Object.entries(setupAttrs)) {
          const imported = model.attrs[key];
          if (
            attrs.locked &&
            (!imported?.locked ||
              imported.found !== attrs.found ||
              imported.load !== attrs.load ||
              imported.target !== attrs.target)
          )
            return "Imported model must preserve the level setup";
        }
        for (const [key, attrs] of Object.entries(model.attrs)) {
          if (attrs.locked && !setupAttrs[key]?.locked)
            return "Imported model contains an unknown locked fixture";
        }
        commit(model);
        set({ chainStart: null, selected: null });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    cycleBrace: (face) => {
      const s = get();
      if (s.mode === "multiplayer" || s.mode === "forensics")
        return "Panel braces cannot be cycled in this mode.";
      const result = cycleBayBrace(LEVELS[s.levelId], s.model, face);
      if (!result.ok) return result.reason;
      commit(result.model);
      set({ selected: null });
      return null;
    },
    addBay: (origin, size, type) => {
      if (get().mode === "multiplayer")
        return "Bays cannot be placed during a multiplayer turn";
      const s = get(),
        model = clone(s.model);
      const issue = bayIssue(LEVELS[s.levelId], model, origin, size, type);
      if (issue) return issue;
      for (const [a, b] of missingBayEdges(model, origin, size))
        model.members.push({
          id: model.nextId++,
          a: nodeKey(...a),
          b: nodeKey(...b),
          type,
        });
      commit(model);
      return null;
    },
    redo: () =>
      set((s) => {
        if (s.mode === "multiplayer" || !s.future.length) return {};
        const model = s.future[s.future.length - 1];
        const persisted = saveModel(s.levelId, model, s.mode);
        return {
          model,
          history: [...s.history.slice(-199), clone(s.model)],
          future: s.future.slice(0, -1),
          persistenceError: persisted.ok
            ? null
            : "Changes could not be saved. Existing stored data was preserved.",
          chainStart: null,
          selected: null,
        };
      }),
    tool: "shs",
    workK: initialWorkK(session.style, levelId, initialModelValue),
    chainStart: null,
    selected: null,
    setLevel: (levelId) => {
      if (get().mode !== "challenge") return;
      saveLevel(levelId);
      const loaded = loadWithStatus(levelId);
      set((s) => ({
        levelId,
        model: loaded.model,
        persistenceError: loaded.error,
        history: [],
        future: [],
        workK: initialWorkK(s.style, levelId, loaded.model),
        chainStart: null,
        selected: null,
        tool:
          s.tool === "load" && LEVELS[levelId].type !== "sandbox"
            ? "shs"
            : s.tool,
      }));
    },
    reset: () => {
      const s = get();
      if (s.mode === "multiplayer") return;
      if (s.mode === "forensics") {
        commit(modeSetup("forensics").model);
        set({ chainStart: null, selected: null });
        return;
      }
      if (!s.model.members.length && !Object.keys(s.model.attrs).length) return;
      const attrs: GameModel["attrs"] = {};
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
      if (get().mode === "multiplayer" || get().mode === "forensics")
        return false;
      const model = exampleModel(get().levelId);
      if (!model) return false;
      commit(model);
      set({ chainStart: null, selected: null });
      return true;
    },
    newLayout: () => {
      const s = get();
      if (s.mode === "multiplayer" || s.mode === "forensics") return false;
      if (!LEVELS[s.levelId].random) return false;
      commit(initialModel(LEVELS[s.levelId]));
      set({ chainStart: null, selected: null });
      return true;
    },
    // A design is valid only for the exact model from which it was computed.
    applyAutoDesign: (model, sourceModel) => {
      if (
        get().mode === "multiplayer" ||
        get().mode === "forensics" ||
        get().model !== sourceModel
      )
        return false;
      commit(clone(model));
      return true;
    },
    undo: () =>
      set((s) => {
        if (s.mode === "multiplayer" || !s.history.length) return {};
        const model = s.history[s.history.length - 1];
        const persisted = saveModel(s.levelId, model, s.mode);
        return {
          model,
          persistenceError: persisted.ok
            ? null
            : "Changes could not be saved. Existing stored data was preserved.",
          history: s.history.slice(0, -1),
          future: [...s.future.slice(-199), clone(s.model)],
          chainStart: null,
          selected: null,
        };
      }),
    setTool: (tool) => set({ tool, chainStart: null }),
    placeFoundation: (point) => {
      const state = get();
      if (state.mode !== "creative") return "Foundation placement is available in Creative.";
      const key = nodeKey(...point);
      if (!state.model.attrs[key]?.found) {
        const issue = state.toggleAttr(point, "found");
        if (issue) return issue;
      }
      // Clicking a placed support reopens its restraints without changing them.
      set({ selected: { type: "node", key } });
      return null;
    },
    setWorkK: (k) =>
      set((s) => ({
        workK: Math.max(0, Math.min(LEVELS[s.levelId].nz, Math.round(k))),
      })),
    setChainStart: (chainStart) => set({ chainStart }),
    setSelected: (selected) => set({ selected }),
    addMember: (a, b, type) => {
      const s = get();
      if (s.mode === "multiplayer") {
        if (!s.turn || !s.selectedCardId) return "Select an element card first";
        const card = activeTurnHand(s.turn).find(
          (c) => c.id === s.selectedCardId,
        );
        if (!card || card.kind !== "element")
          return "Select an element card first";
        return turnTransition(
          stageElement(s.turn, card.id, nodeKey(...a), nodeKey(...b)),
        );
      }
      const issue = memberIssue(LEVELS[s.levelId], s.model, a, b, type);
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
      if (s.mode === "multiplayer") return;
      if (
        s.mode === "forensics" &&
        modeSetup("forensics").model.members.some((m) => m.id === id)
      )
        return;
      if (!s.model.members.some((m) => m.id === id)) return;
      const model = clone(s.model);
      model.members = model.members.filter((m) => m.id !== id);
      cleanup(model);
      commit(model);
      if (s.selected?.type === "member" && s.selected.id === id)
        set({ selected: null });
    },
    swapMember: (id, type) => {
      const s = get(),
        m = s.model.members.find((m) => m.id === id);
      if (s.mode === "multiplayer")
        return "Members cannot be changed during a multiplayer turn";
      if (
        s.mode === "forensics" &&
        modeSetup("forensics").model.members.some((member) => member.id === id)
      )
        return "The repair fixture cannot be changed";
      if (!m) return "Member not found";
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
      if (s.mode === "multiplayer") return 0;
      let count = 0;
      for (const m of model.members)
        if (
          !(
            s.mode === "forensics" &&
            modeSetup("forensics").model.members.some(
              (fixture) => fixture.id === m.id,
            )
          ) &&
          m.type === from &&
          !swapIssue(LEVELS[s.levelId], model, m, to)
        ) {
          m.type = to;
          count++;
        }
      if (count) commit(model);
      return count;
    },
    toggleAttr: (p, type) => {
      const s = get();
      if (s.mode === "multiplayer") {
        if (type !== "load" || !s.turn || !s.selectedCardId)
          return "Select a load card to place a load";
        const card = activeTurnHand(s.turn).find(
          (c) => c.id === s.selectedCardId,
        );
        if (!card || card.kind !== "load") return "Select a load card first";
        return turnTransition(stageLoad(s.turn, card.id, nodeKey(...p)));
      }
      if (
        s.mode === "forensics" &&
        modeSetup("forensics").model.attrs[nodeKey(...p)]
      )
        return "The repair fixture cannot be changed";
      const issue = nodeItemIssue(LEVELS[s.levelId], s.model, p, type);
      if (issue) return issue;
      const model = clone(s.model),
        key = nodeKey(...p),
        a = model.attrs[key] ?? (model.attrs[key] = {});
      if (type === "load") {
        a.load = a.load
          ? undefined
          : s.mode === "creative"
            ? s.loadBrush.magnitude
            : 50;
        if (a.load && s.mode === "creative")
          a.loadDirection = s.loadBrush.direction;
      } else {
        a[type] = !a[type];
        if (type === "found") delete a.restraint;
      }
      cleanup(model);
      commit(model);
      return null;
    },
    setNodeLoad: (key, magnitude) => {
      const s = get(),
        attrs = s.model.attrs[key];
      if (s.mode === "multiplayer")
        return "Loads cannot be edited during a multiplayer turn";
      if (!attrs?.load || attrs.locked) return "Choose an editable load";
      if (!Number.isFinite(magnitude) || magnitude <= 0)
        return "Load magnitude must be positive and finite";
      if (attrs.load === magnitude) return null;
      const model = clone(s.model);
      model.attrs[key].load = magnitude;
      commit(model);
      return null;
    },
    setNodeRestraint: (key, restraint) => {
      const s = get(),
        attrs = s.model.attrs[key];
      if (s.mode !== "creative")
        return "Custom supports are available in creative mode only";
      if (
        !Array.isArray(restraint) ||
        restraint.length !== 6 ||
        !restraint.every((value) => typeof value === "boolean")
      )
        return "A support requires six boolean restraints";
      if (!nodeValid(LEVELS[s.levelId], parseNodeKey(key)))
        return "Invalid position";
      if (attrs?.locked) return "This support is locked";
      const model = clone(s.model),
        next = model.attrs[key] ?? (model.attrs[key] = {});
      next.found = restraint.some(Boolean);
      next.restraint = [...restraint];
      cleanup(model);
      commit(model);
      return null;
    },
    setNodeLoadDirection: (key, direction) => {
      const s = get(),
        attrs = s.model.attrs[key];
      if (s.mode !== "creative")
        return "Directional loads are available in creative mode only";
      if (!attrs?.load || attrs.locked) return "Choose an editable load";
      if (!["-Z", "+Z", "+X", "-X", "+Y", "-Y"].includes(direction))
        return "Invalid load direction";
      const model = clone(s.model);
      model.attrs[key].loadDirection = direction;
      commit(model);
      return null;
    },
    removeNodeAttrs: (key) => {
      const s = get(),
        a = s.model.attrs[key];
      if (s.mode === "multiplayer") return;
      if (s.mode === "forensics" && modeSetup("forensics").model.attrs[key])
        return;
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
