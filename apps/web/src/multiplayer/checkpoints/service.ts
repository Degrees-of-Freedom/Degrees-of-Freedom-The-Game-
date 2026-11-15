/**
 * The checkpoint service: replay of the pending turns inside one checkpoint,
 * attribution of issues to the turn that caused them, minimum local
 * correction, and the final score.
 *
 * Replay semantics:
 * - The baseline is the live model at the last verified checkpoint (or the
 *   setup) with all earlier corrections in force. It is solved once.
 * - Each pending turn is then judged in order. Its live model, with the
 *   corrections found so far, is solved and compared with the corrected state
 *   of the turn before. Verified new or worsened issues cost that turn's
 *   player one point, however many issues there are. The player who happened
 *   to trigger the checkpoint is charged only for their own turn.
 * - If the turn left issues, the correction search runs and its restraints
 *   join the correction layer for all later turns. The corrected state is the
 *   baseline of the next turn, so a later player is not blamed for it.
 * - The models analysed are the retrospectively corrected branch. The live
 *   models are read through the adapter and never modified; later moves are
 *   never dropped or relocated. A correction whose target is missing from a
 *   later model is reported, not forced.
 * - A turn is settled as a whole or not at all. If work stops inside a turn,
 *   that turn and all later ones stay pending and nothing is recorded for
 *   them.
 */

import type { AnalysisOptions, DetailedAnalysisResult, Vector3 } from '@dof/solver-contract';
import { correct } from './correction';
import { attribute, hasIssues, issueSignature, readIssues, type StepIssues } from './issues';
import { correctionInvariantViolations, restraintId, safetyEntryId, toAnalysisModel, type Translation } from './model';
import {
  CHECKPOINT_SERVICE_VERSION,
  type CheckpointEvent, type CheckpointLimits, type CheckpointModel, type CheckpointRequest, type CheckpointResult,
  type CheckpointService, type CheckpointServiceConfig, type CheckpointTolerances, type CurrentState, type FinalScore,
  type OrderedTurn, type PenaltyRecord, type ReplayStep, type SafetyRestraint, type SafetyRestraintReaction, type UnresolvedScope,
} from './types';

export const DEFAULT_LIMITS: CheckpointLimits = { maxSolves: 400, maxRestraintsPerTurn: 12 };
export const DEFAULT_TOLERANCES: CheckpointTolerances = { overload: 1e-6, worsened: 1e-3, equilibrium: 1e-6 };

/** Thrown inside a run when the solve budget is spent. */
class WorkLimit extends Error {}

interface Solved {
  model: CheckpointModel;
  translation: Translation;
  result: DetailedAnalysisResult;
  failed: boolean;
  issues: StepIssues;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function createCheckpointService(config: CheckpointServiceConfig): CheckpointService {
  const limits = { ...DEFAULT_LIMITS, ...config.limits };
  const tolerances = { ...DEFAULT_TOLERANCES, ...config.tolerances };
  const options: AnalysisOptions = config.options ?? {};
  const rawDown = config.down ?? [0, 0, -1];
  const downLength = Math.hypot(...rawDown);
  if (!(downLength > 0)) throw new RangeError('`down` must be a non-zero vector.');
  const down: Vector3 = [rawDown[0] / downLength, rawDown[1] / downLength, rawDown[2] / downLength];

  interface Entry { fingerprint: string; controller: AbortController; promise: Promise<CheckpointResult> }
  const running = new Map<string, Entry>();
  const completed = new Map<string, { fingerprint: string; result: CheckpointResult }>();

  async function execute(request: CheckpointRequest, signal: AbortSignal): Promise<CheckpointResult> {
    const { checkpointId, window } = request;
    const steps: ReplayStep[] = [], penalties: PenaltyRecord[] = [], added: SafetyRestraint[] = [];
    const unresolved: UnresolvedScope[] = [];
    let solverCalls = 0, solverVersion: string | null = null;
    let settled = window.afterTurn, settledRevision = window.baselineRevision;
    let state: Solved | null = null;
    let corrections = [...new Map(request.corrections.map(c => [c.id, c])).values()];

    const flag = (turnId: string | null, scope: Pick<UnresolvedScope, 'code' | 'memberIds' | 'nodeIds' | 'detail'>) =>
      unresolved.push({ eventId: `${checkpointId}:unresolved:${unresolved.length + 1}`, turnId, ...scope });

    async function evaluate(model: CheckpointModel, inForce: readonly SafetyRestraint[]): Promise<Solved> {
      signal.throwIfAborted();
      if (solverCalls >= limits.maxSolves) throw new WorkLimit();
      const translation = toAnalysisModel(model, inForce);
      if (translation.applied.length) {
        const violations = correctionInvariantViolations(toAnalysisModel(model, []).model, translation.model);
        if (violations.length) throw new Error(`A correction changed the original model: ${violations.join('; ')}.`);
      }
      solverCalls++;
      const result = await config.solver.analyzeDetailed(translation.model, options, signal);
      signal.throwIfAborted();
      solverVersion = result.analysis.solverVersion;
      const ends = new Map(model.members.map(m => [m.id, [m.start.nodeId, m.end.nodeId]]));
      return { model, translation, result, failed: result.analysis.status !== 'ok', issues: readIssues(result, tolerances, id => ends.get(id) ?? []) };
    }

    const solverFailure = (solved: Solved) =>
      `The solver did not analyse the model: ${solved.result.analysis.diagnostics.map(d => d.message).join(' ') || solved.result.analysis.reasonCodes.join(', ') || 'no reason given'}`;

    /** Report corrections that could not be placed in a model, once each. */
    const reported = new Set<string>();
    const flagMissing = (solved: Solved, turnId: string | null) => {
      for (const correction of solved.translation.missing) {
        if (reported.has(correction.id)) continue;
        reported.add(correction.id);
        const target = correction.target;
        flag(turnId, {
          code: 'correction-target-missing',
          memberIds: target.kind === 'rotation-end' ? [target.memberId] : [],
          nodeIds: target.kind === 'rotation-end' ? [] : [target.nodeId],
          detail: `Safety restraint ${correction.id} has no target in revision ${solved.model.revision}; it is not applied there and no player move was changed.`,
        });
      }
    };

    const finish = (status: CheckpointResult['status'], turns: readonly OrderedTurn[]): CheckpointResult => {
      const cancelled = status === 'cancelled';
      const current = state && !cancelled ? describe(state, settled, settledRevision) : null;
      const allPenalties = cancelled ? [] : penalties;
      const final = request.reason === 'final' && !cancelled ? score(request, status === 'completed' ? current : null, allPenalties, checkpointId) : null;
      const verified = status === 'completed' && config.authoritative;
      const event = (type: CheckpointEvent['type'], eventId: string, turnId: string | null, actorId: string | null, revision: string | null): CheckpointEvent =>
        ({ eventId, type, checkpointId, requestId: request.requestId, turnId, actorId, revision });
      const newCorrections = cancelled ? [] : added;
      const events: CheckpointEvent[] = cancelled ? [] : [
        ...allPenalties.map(p => event('checkpoint.penalty', p.eventId, p.turnId, p.playerId, p.revision)),
        ...newCorrections.map(c => event('checkpoint.correction', c.eventId, c.originTurnId, c.originPlayerId, c.revision)),
        ...unresolved.map(u => event('checkpoint.unresolved', u.eventId, u.turnId, null, null)),
        ...(status === 'completed' ? [event('checkpoint.completed', `${checkpointId}:completed`, null, null, settledRevision)] : []),
        ...(final && verified ? [event('match.finalized', final.eventId, null, null, settledRevision)] : []),
      ];
      return {
        format: 'dof-checkpoint-result', schemaVersion: 1,
        requestId: request.requestId, matchId: request.matchId, checkpointId,
        reason: request.reason, dueByInterval: request.dueByInterval, window,
        status, authoritative: config.authoritative, verified,
        provenance: { serviceVersion: CHECKPOINT_SERVICE_VERSION, rulesVersion: request.rulesVersion, solverId: config.solver.id, solverVersion, options },
        settledThroughTurn: cancelled ? window.afterTurn : settled,
        unsettledTurnIds: turns.filter(t => cancelled || t.turnNumber > settled).map(t => t.turnId),
        steps, penalties: allPenalties, corrections: newCorrections,
        activeCorrections: cancelled ? [...request.corrections] : corrections,
        unresolved: cancelled ? [] : unresolved,
        current, final, events, solverCalls,
      };
    };

    let turns: readonly OrderedTurn[] = [];
    try {
      signal.throwIfAborted();
      turns = await config.turns.turnsInWindow(window.afterTurn, window.throughTurn, signal);
      signal.throwIfAborted();
      const inOrder = turns.length === window.throughTurn - window.afterTurn && turns.every((turn, index) => turn.turnNumber === window.afterTurn + index + 1);
      if (!inOrder) {
        flag(null, { code: 'turn-window-mismatch', memberIds: [], nodeIds: [], detail: `Expected turns ${window.afterTurn + 1} to ${window.throughTurn} in order; received ${turns.map(t => t.turnNumber).join(', ') || 'none'}.` });
        return finish('failed', turns);
      }

      const baseline = await evaluate(await config.models.modelAt(window.baselineRevision, signal), corrections);
      if (baseline.failed) {
        flag(null, { code: 'solver-failed', memberIds: [], nodeIds: [], detail: solverFailure(baseline) });
        return finish('failed', turns);
      }
      state = baseline;
      flagMissing(baseline, null);

      const charged = new Set(request.penalties.map(p => p.turnId));
      for (const turn of turns) {
        signal.throwIfAborted();
        const step: ReplayStep = {
          turnId: turn.turnId, turnNumber: turn.turnNumber, playerId: turn.playerId, revision: turn.revision,
          modelId: null, evidence: 'unchanged-model', issues: [], penaltyEventId: null,
          penaltyAlreadyRecorded: charged.has(turn.turnId), addedRestraintIds: [],
        };
        if (turn.revision !== settledRevision) {
          const before: Solved = state;
          const solved = await evaluate(await config.models.modelAt(turn.revision, signal), corrections);
          if (solved.failed) {
            flag(turn.turnId, { code: 'solver-failed', memberIds: [], nodeIds: [], detail: solverFailure(solved) });
            break;
          }
          const attribution = attribute(before.issues, solved.issues, tolerances);
          let after = solved, restraints: SafetyRestraint[] = [];
          const scopes: Pick<UnresolvedScope, 'code' | 'memberIds' | 'nodeIds' | 'detail'>[] = [];
          // Correct only when this turn changed the picture; an old unresolved
          // issue is not searched again on every later turn.
          if (hasIssues(solved.issues) && issueSignature(solved.issues) !== issueSignature(before.issues)) {
            const outcome = await correct(solved, {
              model: solved.model, corrections, limits, down,
              evaluate: inForce => evaluate(solved.model, inForce),
              make: (target, reason) => {
                const id = restraintId(target);
                return {
                  id, eventId: `${checkpointId}:correction:${id}`, target,
                  frame: target.kind === 'rotation-end' ? 'member-local' : 'global',
                  reason, originTurnId: turn.turnId, originPlayerId: turn.playerId, checkpointId, revision: turn.revision, permanent: true,
                };
              },
            });
            ({ solved: after, added: restraints } = outcome);
            scopes.push(...outcome.unresolved);
          }
          // The turn is settled: record everything about it together.
          flagMissing(solved, turn.turnId);
          for (const scope of scopes) flag(turn.turnId, scope);
          for (const scope of attribution.unknown) {
            const balance = solved.issues.components.some(c => c.equilibriumFailed && c.component.memberIds.some(id => scope.memberIds.includes(id)));
            flag(turn.turnId, { code: balance ? 'equilibrium-not-verified' : 'unknown-component', ...scope });
          }
          step.modelId = solved.translation.modelId;
          step.issues = attribution.issues;
          step.evidence = attribution.issues.length || !attribution.unknown.length ? 'verified' : 'unknown';
          step.addedRestraintIds = restraints.map(c => c.id);
          if (attribution.issues.length && !step.penaltyAlreadyRecorded) {
            const penalty: PenaltyRecord = {
              eventId: `${checkpointId}:penalty:${turn.turnId}`, checkpointId,
              turnId: turn.turnId, turnNumber: turn.turnNumber, playerId: turn.playerId, points: 1,
              issues: attribution.issues, revision: turn.revision, modelId: solved.translation.modelId,
            };
            penalties.push(penalty);
            step.penaltyEventId = penalty.eventId;
          }
          corrections = [...corrections, ...restraints];
          added.push(...restraints);
          state = after;
        }
        steps.push(step);
        settled = turn.turnNumber;
        settledRevision = turn.revision;
      }
      return finish(settled === window.throughTurn ? 'completed' : 'partial', turns);
    } catch (error) {
      if (signal.aborted) return finish('cancelled', turns);
      if (error instanceof WorkLimit) {
        flag(null, { code: 'work-limit', memberIds: [], nodeIds: [], detail: `The checkpoint reached its limit of ${limits.maxSolves} solves. Later turns stay pending.` });
        return finish(state ? 'partial' : 'failed', turns);
      }
      flag(null, { code: 'solver-failed', memberIds: [], nodeIds: [], detail: error instanceof Error ? error.message : 'Unknown failure.' });
      return finish(state ? 'partial' : 'failed', turns);
    }
  }

  /** Reactions, components and gravity of the state the checkpoint ends on. */
  function describe(solved: Solved, turnNumber: number, revision: string): CurrentState {
    const { result, model, translation, issues } = solved;
    const ok = (componentId: string | null) => issues.components.some(c => c.component.id === componentId && c.state === 'ok');
    const founded = new Set(model.foundations.map(f => f.nodeId));
    const components = issues.components.map(({ component, state }) => ({
      id: component.id, status: component.status, verified: state === 'ok', reasonCodes: component.reasonCodes,
      memberIds: component.memberIds, nodeIds: component.nodeIds, gravity: dot(component.appliedForce, down),
    }));
    const safetyReactions = translation.applied.map((correction): SafetyRestraintReaction => {
      const target = correction.target;
      const unit = target.kind === 'translation-joint' ? 'N' : 'N·m';
      let value: number | null = null;
      if (target.kind === 'rotation-end') {
        const member = result.members[target.memberId];
        if (member?.forces && ok(member.componentId)) value = member.forces[target.end][3 + target.axis];
      } else if (!founded.has(target.nodeId)) {
        const entry = result.foundations[safetyEntryId(target.nodeId)];
        if (entry?.valid && entry.reaction && ok(entry.componentId)) value = entry.reaction[(target.kind === 'rotation-joint' ? 3 : 0) + target.axis];
      }
      return { restraintId: correction.id, value, unit, validity: value === null ? 'unavailable' : 'verified', scored: false };
    });
    return {
      revision, turnNumber, modelId: translation.modelId, lineage: 'retrospectively-corrected',
      components,
      foundations: model.foundations.map(({ id, ownerId }) => {
        const entry = result.foundations[id];
        const verified = !!entry?.valid && !!entry.reaction && ok(entry.componentId);
        return { foundationId: id, ownerId, componentId: entry?.componentId ?? null, reaction: verified ? [...entry.reaction!] : null, verified };
      }),
      safetyReactions,
      totalGravity: components.reduce((sum, c) => sum + c.gravity, 0),
    };
  }

  /**
   * Final score: each player's share of the total gravity carried by their
   * own foundation, in percent, minus one point per recorded penalty. Safety
   * restraint reactions belong to no player, and W is always the total.
   */
  function score(request: CheckpointRequest, current: CurrentState | null, fresh: readonly PenaltyRecord[], checkpointId: string): FinalScore {
    const chargedTurns = new Map([...request.penalties, ...fresh].map(p => [p.turnId, p.playerId]));
    const points = (playerId: string) => [...chargedTurns.values()].filter(id => id === playerId).length;
    const verifiedCount = current?.components.filter(c => c.verified).length ?? 0;
    const available = !!current && verifiedCount > 0 && current.totalGravity > 1e-9;
    return {
      eventId: `${checkpointId}:finalized`,
      validity: !available ? 'unavailable' : verifiedCount === current.components.length ? 'verified' : 'verified-components-only',
      totalGravity: current?.totalGravity ?? null,
      players: request.playerIds.map((playerId) => {
        const penaltyPoints = points(playerId);
        if (!available) return { playerId, attraction: null, sharePercent: null, penaltyPoints, score: null };
        const attraction = current.foundations.filter(f => f.ownerId === playerId && f.verified).reduce((sum, f) => sum - dot(f.reaction!, down), 0);
        const sharePercent = 100 * attraction / current.totalGravity;
        return { playerId, attraction, sharePercent, penaltyPoints, score: sharePercent - penaltyPoints };
      }),
    };
  }

  return {
    run(request, init = {}) {
      const fingerprint = JSON.stringify(request);
      const done = completed.get(request.checkpointId);
      if (done?.fingerprint === fingerprint) return Promise.resolve(done.result);
      const active = running.get(request.checkpointId);
      if (active?.fingerprint === fingerprint) {
        init.signal?.addEventListener('abort', () => active.controller.abort(), { once: true });
        if (init.signal?.aborted) active.controller.abort();
        return active.promise;
      }
      // A different request for the same checkpoint supersedes the old run.
      active?.controller.abort();
      const controller = new AbortController();
      if (init.signal?.aborted) controller.abort();
      init.signal?.addEventListener('abort', () => controller.abort(), { once: true });
      const entry: Entry = {
        fingerprint, controller,
        promise: execute(request, controller.signal).then((result) => {
          if (running.get(request.checkpointId) === entry) running.delete(request.checkpointId);
          if (result.status === 'completed') completed.set(request.checkpointId, { fingerprint, result });
          return result;
        }),
      };
      running.set(request.checkpointId, entry);
      return entry.promise;
    },
    cancel(checkpointId) {
      for (const [id, entry] of running) if (checkpointId === undefined || id === checkpointId) entry.controller.abort();
    },
  };
}
