import { activeTurnHand, createTurnGame, endTurn, stageConnection, stageElement, stageLoad, type TurnState } from './turns';
import { nodeKey, parseNodeKey } from './model';

export type Candidate = { label: string; state: TurnState; features: number[]; reward: number };
export type Model = { weights: number[]; examples: number };
export type Skill = 'beginner' | 'intermediate' | 'advanced';
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

/** Generate a bounded set of legal connected plays using the turn engine. */
export function candidates(state: TurnState): Candidate[] {
  if (state.finished || state.draft.members.length || state.draft.loads.length || state.draft.connections.length) return [];
  const player = state.players[state.playerIndex].id;
  const result: Candidate[] = [];
  for (const card of activeTurnHand(state)) {
    if (card.kind !== 'element') continue;
    for (const joint of state.board.joints.filter(j => !j.foundationOwner)) {
      const [x, y, z] = parseNodeKey(joint.id);
      for (const [dx, dy, dz] of [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 1], [-1, 0, 1]]) {
        const target = nodeKey(x + dx, y + dy, z + dz);
        const placed = stageElement(state, card.id, joint.id, target);
        if (!placed.ok) continue;
        let next = placed.state;
        const member = next.draft.members[0];
        for (const end of ['a', 'b'] as const) {
          const available = activeTurnHand(next).find(c => c.kind === 'connection' && c.profile === 'fixed');
          if (!available) break;
          const attached = stageConnection(next, available.id, member.id, end);
          if (attached.ok) next = attached.state;
        }
        const load = activeTurnHand(next).find(c => c.kind === 'load');
        if (load && next.draft.connections.some(c => c.end === 'b')) {
          const placedLoad = stageLoad(next, load.id, target);
          if (placedLoad.ok) next = placedLoad.state;
        }
        const own = state.board.members.some(m => m.owner === player && (m.a === joint.id || m.b === joint.id)) ? 1 : 0;
        const features = [1, next.draft.connections.length / 2, dz, dx !== 0 && dz !== 0 ? 1 : 0, own, next.draft.loads.length];
        // Teaching proxy only: this is neither solver output nor final game scoring.
        const reward = 0.3 + 2 * features[1] + 0.5 * dz + 0.6 * features[3] + 0.4 * own + 0.3 * features[5];
        result.push({ label: `${card.label}: ${joint.id} → ${target}`, state: next, features, reward });
      }
    }
  }
  return result;
}
export function newModel(): Model { return { weights: [0, 0, 0, 0, 0, 0], examples: 0 }; }
export function train(model: Model, episodes: number, seed = 1): Model {
  const weights = [...model.weights];
  let examples = model.examples;
  for (let episode = 0; episode < episodes; episode++) {
    let state = createTurnGame(seed + episode);
    while (!state.finished) {
      const options = candidates(state);
      if (options.length) {
        // Reproducible exploration supplies examples beyond the greedy policy.
        const choice = options[(episode * 17 + state.turn * 7) % options.length];
        const error = choice.reward - dot(weights, choice.features);
        choice.features.forEach((feature, i) => { weights[i] += 0.04 * error * feature; });
        examples++;
        state = choice.state;
      }
      const ended = endTurn(state);
      if (!ended.ok) throw new Error(ended.reason);
      state = ended.state;
    }
  }
  return { weights, examples };
}
export function selectCandidate(options: Candidate[], model: Model, skill: Skill, random = Math.random): Candidate | undefined {
  if (!options.length) return undefined;
  const epsilon = { beginner: 0.8, intermediate: 0.35, advanced: 0.05 }[skill];
  if (random() < epsilon) return options[Math.floor(random() * options.length)];
  return options.reduce((best, option) => dot(model.weights, option.features) > dot(model.weights, best.features) ? option : best);
}
export function finishDemoTurn(state: TurnState): TurnState {
  const result = endTurn(state);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
