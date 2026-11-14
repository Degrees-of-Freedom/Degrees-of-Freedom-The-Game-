import { nodeKey, parseNodeKey, type GameModel, type Member, type MemberType } from './model';

export type TurnCard =
  | { id: string; kind: 'element'; label: string; type: MemberType; maxSteps: number }
  | { id: string; kind: 'load'; label: string; magnitude: number }
  | { id: string; kind: 'connection'; label: string; profile: 'fixed' | 'ball' };

export const CONNECTION_PROFILES = {
  fixed: ['locked', 'locked', 'locked', 'locked', 'locked', 'locked'],
  ball: ['locked', 'locked', 'locked', 'free', 'free', 'free'],
} as const;

export const KIT_PLAYTEST = {
  version: 1, players: 2, rounds: 8, boardMax: [6, 6, 6],
  description: 'Two players, eight rounds, unplayed cards stay in hand.',
} as const;

type TurnMember = Member & { owner: string; cardId?: string };
type Joint = { id: string; foundationOwner?: string };
type Load = { cardId: string; jointId: string; magnitude: number; owner: string };
type Connection = {
  cardId?: string; memberId: number; end: 'a' | 'b'; jointId: string;
  profile: 'fixed' | 'ball'; owner: string;
};
type Placements = { members: TurnMember[]; loads: Load[]; connections: Connection[] };
type Board = Placements & { joints: Joint[] };
type TurnPlayer = { id: string; score: number; hand: TurnCard[] };
type Event =
  | { kind: 'element'; cardId: string; a: string; b: string }
  | { kind: 'load'; cardId: string; jointId: string }
  | { kind: 'connection'; cardId: string; memberId: number; end: 'a' | 'b'; jointId?: string }
  | { kind: 'cancel' }
  | { kind: 'end'; turn: number };

export type TurnReport = {
  turn: number; playerId: string; status: 'unresolved'; reason: string; penalty: 0;
};

export interface TurnState {
  version: typeof KIT_PLAYTEST.version;
  seed: number;
  turn: number;
  playerIndex: number;
  players: TurnPlayer[];
  decks: [TurnCard[], TurnCard[]];
  nextId: number;
  draft: Placements;
  board: Board;
  reports: TurnReport[];
  events: Event[];
  finished: boolean;
}

type Transition = { ok: true; state: TurnState } | { ok: false; reason: string };

const emptyDraft = (): Placements => ({ members: [], loads: [], connections: [] });
const fail = (reason: string): Transition => ({ ok: false, reason });

function shuffle(cards: TurnCard[], seed: number): TurnCard[] {
  let random = seed >>> 0;
  for (let i = cards.length - 1; i > 0; i--) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const j = random % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function createDecks(seed: number): TurnState['decks'] {
  const deck1: TurnCard[] = [], deck2: TurnCard[] = [];
  const types: MemberType[] = ['shs', 'glulam', 'ipe', 'heb', 'cable'];
  const count = KIT_PLAYTEST.players * KIT_PLAYTEST.rounds * 2;
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const maxSteps = 1 + i % 4;
    const magnitude = [5, 10, 20, 50][i % 4];
    const profile = i % 2 === 0 ? 'fixed' : 'ball';
    deck1.push({ id: 'element-' + i, kind: 'element', type, maxSteps, label: type.toUpperCase() + ' · up to ' + maxSteps });
    deck1.push({ id: 'load-' + i, kind: 'load', magnitude, label: magnitude + ' kN down' });
    deck2.push({ id: 'connection-' + i, kind: 'connection', profile, label: profile === 'fixed' ? 'Fixed / moment' : 'Ball joint' });
  }
  return [shuffle(deck1, seed), shuffle(deck2, seed ^ 0x9e3779b9)];
}

function draw(state: TurnState): TurnState {
  const received = [...state.decks[0].slice(0, 2), ...state.decks[1].slice(0, 2)];
  return {
    ...state,
    decks: [state.decks[0].slice(2), state.decks[1].slice(2)],
    players: state.players.map((player, i) => i === state.playerIndex ? { ...player, hand: [...player.hand, ...received] } : player),
  };
}

export function createTurnGame(seed = 1): TurnState {
  const players = [{ id: 'player-1', score: 0, hand: [] }, { id: 'player-2', score: 0, hand: [] }];
  const board: Board = { ...emptyDraft(), joints: [] };
  players.forEach((player, i) => {
    const a = nodeKey(1 + i * 4, 3, 0), b = nodeKey(1 + i * 4, 3, 1), id = i + 1;
    board.members.push({ id, a, b, type: 'shs', owner: player.id });
    board.joints.push({ id: a, foundationOwner: player.id }, { id: b });
    board.connections.push(
      { memberId: id, end: 'a', jointId: a, profile: 'fixed', owner: player.id },
      { memberId: id, end: 'b', jointId: b, profile: 'fixed', owner: player.id },
    );
  });
  seed >>>= 0;
  return draw({
    version: KIT_PLAYTEST.version, seed, turn: 1, playerIndex: 0, players,
    decks: createDecks(seed), nextId: 3, draft: emptyDraft(), board, reports: [], events: [], finished: false,
  });
}

const activePlayer = (state: TurnState) => state.players[state.playerIndex];

function draftIds(state: TurnState): Set<string | undefined> {
  return new Set([...state.draft.members, ...state.draft.loads, ...state.draft.connections].map(({ cardId }) => cardId));
}

export function activeTurnHand(state: TurnState): TurnCard[] {
  return state.finished ? [] : activePlayer(state).hand.filter(({ id }) => !draftIds(state).has(id));
}

function stage(state: TurnState, draft: Placements, event: Event, nextId = state.nextId): Transition {
  return { ok: true, state: { ...state, draft, nextId, events: [...state.events, event] } };
}

function validPoint(key: string): boolean {
  const point = parseNodeKey(key);
  return point.length === 3 && nodeKey(...point) === key && point.every((value, axis) =>
    Number.isInteger(value) && value >= 0 && value <= KIT_PLAYTEST.boardMax[axis]);
}

export function stageElement(state: TurnState, cardId: string, a: string, b: string): Transition {
  const card = activeTurnHand(state).find(({ id }) => id === cardId);
  if (card?.kind !== 'element') return fail('Choose an element card from your hand.');
  if (state.draft.members.length >= 1) return fail('One element may be played per turn.');
  if (!validPoint(a) || !validPoint(b) || a === b) return fail('Choose two distinct points on the board.');
  const start = parseNodeKey(a), end = parseNodeKey(b);
  const lengths = end.map((value, axis) => Math.abs(value - start[axis])).filter(Boolean);
  if (lengths.some((value) => value > card.maxSteps || value !== lengths[0])) {
    return fail('Choose a lattice direction within the card’s length limit.');
  }
  if (state.board.members.some((member) => (member.a === a && member.b === b) || (member.a === b && member.b === a))) {
    return fail('A member already occupies these endpoints.');
  }
  const member: TurnMember = { id: state.nextId, a, b, type: card.type, owner: activePlayer(state).id, cardId };
  return stage(state, { ...state.draft, members: [member] }, { kind: 'element', cardId, a, b }, state.nextId + 1);
}

export function turnJoints(state: TurnState): Joint[] {
  const joints = new Map(state.board.joints.map((joint) => [joint.id, joint]));
  for (const { jointId } of state.draft.connections) {
    if (!joints.has(jointId)) joints.set(jointId, { id: jointId });
  }
  return [...joints.values()];
}

export function stageLoad(state: TurnState, cardId: string, jointId: string): Transition {
  const card = activeTurnHand(state).find(({ id }) => id === cardId);
  if (card?.kind !== 'load') return fail('Choose a load card from your hand.');
  if (state.draft.loads.length >= 1) return fail('One load may be played per turn.');
  if (!turnJoints(state).some(({ id }) => id === jointId)) return fail('Choose an existing or staged shared joint.');
  const load: Load = { cardId, jointId, magnitude: card.magnitude, owner: activePlayer(state).id };
  return stage(state, { ...state.draft, loads: [load] }, { kind: 'load', cardId, jointId });
}

export function stageConnection(state: TurnState, cardId: string, memberId: number, end: 'a' | 'b', jointId?: string): Transition {
  const card = activeTurnHand(state).find(({ id }) => id === cardId);
  if (card?.kind !== 'connection') return fail('Choose a connection card from your hand.');
  if (state.draft.connections.length >= 2) return fail('Two connections may be played per turn.');
  const member = [...state.board.members, ...state.draft.members].find(({ id }) => id === memberId);
  if (!member || (end !== 'a' && end !== 'b')) return fail('Choose one end of an existing or staged member.');
  if ([...state.board.connections, ...state.draft.connections].some((item) => item.memberId === memberId && item.end === end)) {
    return fail('This end already has an immutable connection.');
  }
  const target = jointId ?? member[end];
  if (target !== member[end]) return fail('Choose a joint at the member end.');
  const connection: Connection = { cardId, memberId, end, jointId: target, profile: card.profile, owner: activePlayer(state).id };
  return stage(state, { ...state.draft, connections: [...state.draft.connections, connection] }, { kind: 'connection', cardId, memberId, end, jointId });
}

export function cancelTurnDraft(state: TurnState): Transition {
  if (state.finished) return fail('The playtest match is complete.');
  return stage(state, emptyDraft(), { kind: 'cancel' }, state.nextId - state.draft.members.length);
}

export function endTurn(state: TurnState, expectedTurn = state.turn): Transition {
  if (state.finished || expectedTurn !== state.turn) return fail('This turn has already ended.');
  const player = activePlayer(state), spent = draftIds(state);
  const report: TurnReport = {
    turn: state.turn, playerId: player.id, status: 'unresolved',
    reason: 'The solver cannot verify explicit member-end connections.', penalty: 0,
  };
  const finished = state.turn === KIT_PLAYTEST.players * KIT_PLAYTEST.rounds;
  const committed: TurnState = {
    ...state,
    finished,
    turn: finished ? state.turn : state.turn + 1,
    playerIndex: finished ? state.playerIndex : (state.playerIndex + 1) % state.players.length,
    players: state.players.map((entry) => entry === player ? { ...entry, hand: entry.hand.filter(({ id }) => !spent.has(id)) } : entry),
    board: {
      members: [...state.board.members, ...state.draft.members],
      connections: [...state.board.connections, ...state.draft.connections],
      loads: [...state.board.loads, ...state.draft.loads],
      joints: turnJoints(state),
    },
    draft: emptyDraft(),
    reports: [...state.reports, report],
    events: [...state.events, { kind: 'end', turn: state.turn }],
  };
  return { ok: true, state: finished ? committed : draw(committed) };
}

/** The voxel shape is a render projection. Per-end connector laws live in TurnState. */
export function projectTurnModel(state: TurnState): GameModel {
  const attrs: GameModel['attrs'] = {};
  for (const joint of turnJoints(state)) {
    attrs[joint.id] = joint.foundationOwner ? { found: true, locked: true } : { joint: true };
  }
  for (const load of [...state.board.loads, ...state.draft.loads]) {
    attrs[load.jointId] = { ...attrs[load.jointId], load: (attrs[load.jointId]?.load ?? 0) + load.magnitude };
  }
  return { attrs, members: [...state.board.members, ...state.draft.members], nextId: state.nextId };
}

/** Replay validated user actions so persisted deck order, ownership and scores cannot drift. */
export function parseTurnState(raw: unknown): TurnState | null {
  if (!record(raw) || raw.version !== KIT_PLAYTEST.version || typeof raw.seed !== 'number' ||
    !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 0xffffffff || !Array.isArray(raw.events)) return null;
  let state = createTurnGame(raw.seed);
  for (const event of raw.events) {
    const result = replayEvent(state, event);
    if (!result?.ok) return null;
    state = result.state;
  }
  return state;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function replayEvent(state: TurnState, event: unknown): Transition | null {
  if (!record(event)) return null;
  if (event.kind === 'cancel') return cancelTurnDraft(state);
  if (event.kind === 'end' && typeof event.turn === 'number') return endTurn(state, event.turn);
  if (typeof event.cardId !== 'string') return null;
  if (event.kind === 'element' && typeof event.a === 'string' && typeof event.b === 'string') {
    return stageElement(state, event.cardId, event.a, event.b);
  }
  if (event.kind === 'load' && typeof event.jointId === 'string') return stageLoad(state, event.cardId, event.jointId);
  if (event.kind === 'connection' && typeof event.memberId === 'number' &&
    (event.end === 'a' || event.end === 'b') && (event.jointId === undefined || typeof event.jointId === 'string')) {
    return stageConnection(state, event.cardId, event.memberId, event.end, event.jointId);
  }
  return null;
}
