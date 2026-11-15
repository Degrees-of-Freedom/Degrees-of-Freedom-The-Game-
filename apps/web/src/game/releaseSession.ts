import { RELEASE_CATALOGUE } from "./cardCatalogue";
import { openMatchDatabase, StaleMatch, type MatchDatabase } from "./releaseDatabase";
import { InvalidMatch, runMatchJob } from "./matchJobs";
import { matchRecord, type MatchRecord, type MatchPhase } from "./releaseSave";
import { useGameStore } from "./store";
import { createReleaseGame, cancelTurnDraft, undoLastPlacement, chooseTurnDraw, editDraftMember, changeCheckpointInterval, checkpointDueForTurn, endTurn, projectTurnModel, stageConnection, stageElement, stageLoad, type TurnState } from "./turns";

type Transition = ReturnType<typeof endTurn>;
const state = useGameStore.getState;
const update = useGameStore.setState;
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const message = (error: unknown) => error instanceof Error ? error.message : "Local match storage is unavailable.";

/** Activation belongs to the release route. Secondary modes retain their own saved
 * workspace. Restore the original store actions when leaving this match. */
export async function enterRelease(signal: AbortSignal, seed?: number) {
  const db = await openMatchDatabase();
  if (signal.aborted) { db.close(); signal.throwIfAborted(); }
  const head = await db.read("head").catch(error => { db.close(); throw error; });
  if (signal.aborted) { db.close(); signal.throwIfAborted(); }
  const session = new ReleaseSession(db, head, signal);
  await session.open(seed);
}

class ReleaseSession {
  private record: MatchRecord | null = null;
  private pending: { record: MatchRecord; bytes: string } | null = null;
  private channel?: BroadcastChannel;
  private busy = false;
  private recovery: MatchRecord | null = null;
  private damaged = false;
  private previousStore = state();
  private stopChecking = () => {};
  constructor(private db: MatchDatabase, private head: string | null, private signal: AbortSignal) {
    signal.addEventListener("abort", () => {
      this.stopChecking();
      this.channel?.close();
      db.close();
      update(this.previousStore, true);
    }, { once: true });
  }

  async open(seed?: number) {
    let reason: string | null = null;
    if (this.head !== null) {
      try { this.record = await this.validate(this.head); }
      catch (error) {
        if (!(error instanceof InvalidMatch)) throw error;
        this.damaged = true;
        reason = message(error);
        const backup = await this.db.read("previous");
        if (backup !== null) {
          try { this.recovery = await this.validate(backup); }
          catch { /* Head and recovery bytes remain intact. */ }
        }
      }
    }
    this.signal.throwIfAborted();
    const turn = this.record?.turn ?? createReleaseGame(seed ?? randomSeed());
    const stage = (transition: Transition) => {
      const blocked = this.blocked();
      if (blocked) return blocked;
      if (!transition.ok) return transition.reason;
      if (transition.state !== state().turn) this.queue(transition.state, "planning");
      return null;
    };
    update({
      mode: "multiplayer", style: "grow-dusk", levelId: "environment", turnAnalysing: false,
      ...this.view(turn), history: [], future: [], workK: 0,
      sessionConflict: false, sessionSave: this.damaged ? "invalid" : "idle",
      persistenceError: reason, savedRevision: this.record?.revision ?? null,
      hasSessionBackup: this.recovery !== null,
      playElement: (card, a, b) => stage(stageElement(state().turn!, card, a, b)),
      playConnection: (card, member, end, joint, profile) => stage(stageConnection(state().turn!, card, member, end, joint, profile ?? state().selectedConnectionProfile)),
      playLoad: (card, joint) => stage(stageLoad(state().turn!, card, joint)),
      cancelDraft: () => stage(cancelTurnDraft(state().turn!)),
      undoPlacement: () => stage(undoLastPlacement(state().turn!)),
      drawCard: source => stage(chooseTurnDraw(state().turn!, source)),
      editPlacement: (memberId, a, b) => stage(editDraftMember(state().turn!, memberId, a, b)),
      setAnalysisInterval: interval => stage(changeCheckpointInterval(state().turn!, interval)),
      endTurn: async () => {
        const blocked = this.blocked();
        if (blocked) return blocked;
        if (!this.record || this.record.turn.finished) return "This match has ended.";
        this.queue(this.record.turn, "assessing");
        return null;
      },
      newMatch: () => {
        const blocked = this.blocked();
        if (blocked) return blocked;
        this.queue(createReleaseGame(randomSeed()), "planning", crypto.randomUUID());
        return null;
      },
      retrySessionSave: () => { if (!this.busy && !state().sessionConflict) void this.flush(); },
      privateRecoveryBytes: () => this.damaged ? this.head : this.pending?.bytes ?? this.head,
      pendingPrivateBytes: () => this.pending?.bytes ?? null,
      recoverSession: async (choice, copied = false) => {
        if (this.busy || !this.damaged || state().sessionConflict) return "failed";
        if (!copied) return "needs-copy";
        if (this.pending) {
          await this.flush();
          return this.damaged ? "failed" : "saved";
        }
        const previous = this.recovery;
        if (choice === "backup" && !previous) return "failed";
        this.record = previous;
        const next = choice === "backup" ? previous!.turn : createReleaseGame(randomSeed());
        const phase = choice === "backup" ? previous!.phase : "planning";
        this.setCandidate(next, phase, choice === "backup" ? previous!.matchId : crypto.randomUUID());
        await this.flush();
        return this.damaged ? "failed" : "saved";
      },
      importPrivateMatch: async bytes => {
        const blocked = this.blocked();
        if (blocked) return blocked;
        this.busy = true;
        try {
          const imported = await this.validate(bytes);
          this.signal.throwIfAborted();
          this.setCandidate(imported.turn, imported.phase, imported.matchId);
        } catch (error) { return message(error); }
        finally { this.busy = false; }
        await this.flush();
        return state().persistenceError;
      },
    });
    this.listen();
    if (this.head === null) this.queue(turn, "planning");
    else if (this.record?.phase === "assessing") await this.flush();
  }

  private listen() {
    // The read inside replace() always decides a conflicting write. Broadcast and
    // focus checks also conceal an idle reader after another tab advances.
    const check = async () => {
      if (this.busy || this.signal.aborted) return;
      try {
        const head = await this.db.read("head");
        if (!this.busy && !this.signal.aborted && head !== this.head) this.conflict();
      } catch { /* A failed read is surfaced by the next save or reload. */ }
    };
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("dof-grow-dusk-commits");
      this.channel.onmessage = check;
    }
    window.addEventListener("focus", check);
    this.stopChecking = () => window.removeEventListener("focus", check);
    void check();
  }

  private validate(bytes: string) { return runMatchJob({ kind: "restore", bytes }, this.signal); }
  private blocked() {
    if (state().sessionConflict) return "Another tab changed this match. Reload to continue.";
    if (this.busy) return "Saving the current move.";
    if (this.damaged || this.pending || state().sessionSave === "failed") return "Recover the pending match first.";
    return null;
  }
  private view(turn: TurnState) {
    const selected = state().selected;
    const keepMember = turn.board === state().turn?.board && selected?.type === "member" &&
      [...turn.board.members, ...turn.draft.members].some(member => member.id === selected.id);
    return { turn, model: projectTurnModel(turn), selectedCardId: null, selectedConnectionProfile: undefined,
      selected: keepMember ? selected : null, chainStart: null };
  }
  private setCandidate(turn: TurnState, phase: MatchPhase, matchId?: string) {
    const record = matchRecord(turn, this.record, phase, matchId);
    this.pending = { record, bytes: JSON.stringify(record) };
  }
  private queue(turn: TurnState, phase: MatchPhase, matchId?: string) {
    this.setCandidate(turn, phase, matchId);
    void this.flush();
  }
  private conflict() {
    update({ sessionConflict: true, sessionSave: "idle", persistenceError: "Another tab saved this match. Reload to continue.", selectedCardId: null });
  }
  private async flush() {
    if (this.busy || this.signal.aborted) return;
    this.busy = true;
    try {
      // Persist the exact End intent before starting analysis. If interrupted,
      // reopening an assessing head resumes that turn with its original draw.
      do {
        const next = this.pending;
        if (next) {
          const hidesHand = next.record.phase !== "planning" || next.record.turn.board !== state().turn?.board;
          update({ sessionSave: hidesHand ? "committing" : "writing", persistenceError: null });
          await this.db.replace(this.head, next.bytes, this.damaged);
          this.signal.throwIfAborted();
          this.record = next.record;
          this.head = next.bytes;
          this.pending = null;
          this.damaged = false;
          this.channel?.postMessage(next.record.commitId);
        }
        if (this.record?.phase === "assessing") {
          update({ sessionSave: "committing", savedRevision: this.record.revision, turnAnalysing: !this.record.turn.rulesRevision || checkpointDueForTurn(this.record.turn) });
          const turn = await runMatchJob({ kind: "end", turn: this.record.turn }, this.signal);
          this.signal.throwIfAborted();
          this.setCandidate(turn, turn.finished ? "final" : "planning");
        }
      } while (this.pending);
      if (this.record) update({ ...this.view(this.record.turn), savedRevision: this.record.revision, sessionSave: "idle", turnAnalysing: false, persistenceError: null });
    } catch (error) {
      if (this.signal.aborted) return;
      if (error instanceof StaleMatch) this.conflict();
      else update({ sessionSave: this.damaged ? "invalid" : "failed", turnAnalysing: false, persistenceError: message(error) });
    } finally { this.busy = false; }
  }
}
