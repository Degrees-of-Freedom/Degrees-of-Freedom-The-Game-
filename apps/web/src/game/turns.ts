import { structuralAnalysisResultSchema, type StructuralAnalysisResult } from '@dof/solver-contract';
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type Member,
} from "./model";
import { LEGACY_CATALOGUE, RELEASE_CATALOGUE, PLAY_REVISION, RELEASE_MANIFEST, connectionChoices, createReleaseDecks, isScoredCatalogue, printedCards, type CardDefinition, type CatalogueId } from "./cardCatalogue";
import { conflictingJointAxes, connectionFrame, CONNECTION_PROFILES, type ConnectionProfile } from "./jointFreedom";
import { findMaterialClash } from "./materialClashes";
import { analysisLoadJoint, findPort, loadTargets, systemTarget, targetCoordinate, turnJoints } from "./turnPorts";
import { analyzeTurn } from "./turnAnalysis";
import { resolveMemberLaw, S } from "../solver/voxelSections";
import { correctTurnIssues, LEGACY_REPAIR_POLICY, NODE_REPAIR_POLICY, REPAIR_POLICY, type CorrectionReceipt, type RepairPolicy, type SystemProvenance } from "./turnRepair";
import type { JointCorrection } from './jointCorrections';
import { correctJointReleases } from './nodeRepair';
import { assessTurnOutcome, matchesIssueEvidence, type IssueAssessment } from "./turnIssues";
import { decidePenalty, type PenaltyDecision } from "./turnPenalty";
import { awardFinalScore, finalReceipt, recoverFinalScore, type FinalScore } from "./finalScore";
import { changeTurnCheckpointInterval, createTurnCheckpoints, queueTurnCheckpoint, resolveTurnCheckpoint,
  type TurnCheckpoints, type TurnCheckpointReceipt } from './turnCheckpoints';
export { checkpointDueForTurn, nextAnalysisInTurns } from './turnCheckpoints';
export { turnJoints } from "./turnPorts";
export { CONNECTION_PROFILES } from "./jointFreedom";

export type TurnCard = CardDefinition & { id: string };

export const KIT_PLAYTEST = {
  version: 1,
  players: 2,
  rounds: 8,
  boardMax: [6, 6, 6],
  description: "Two players, eight rounds, unplayed cards stay in hand.",
} as const;

type TurnMember = Member & {
  owner: string; cardId?: string;
  system?: SystemProvenance;
  /** Selection provenance only. A separate connector must activate this attachment. */
  endTargets?: Partial<Record<"a" | "b", string>>;
};
type Joint = { id: string; foundationOwner?: string; point?: string; system?: SystemProvenance };
type Load = {
  cardId: string;
  jointId: string;
  magnitude: number;
  owner: string;
};
type Connection = {
  cardId?: string;
  system?: SystemProvenance;
  memberId: number;
  end: "a" | "b";
  jointId: string;
  profile: ConnectionProfile;
  owner: string;
};
type Placements = {
  members: TurnMember[];
  loads: Load[];
  connections: Connection[];
};
type Board = Placements & { joints: Joint[]; jointCorrections?: JointCorrection[] };
type TurnPlayer = { id: string; score: number; hand: TurnCard[] };
type Event =
  | { kind: "draw"; source: DrawSource; cardId: string }
  | { kind: "interval"; interval: number }
  | { kind: "element"; cardId: string; a: string; b: string }
  | { kind: "load"; cardId: string; jointId: string }
  | {
      kind: "connection";
      cardId: string;
      memberId: number;
      end: "a" | "b";
      jointId?: string;
      profile?: ConnectionProfile;
    }
  | { kind: "end"; turn: number; status?: TurnReport["status"]; analysis?: StructuralAnalysisResult; final?: FinalScore; issues?: IssueAssessment; penaltyDecision?: PenaltyDecision; repairPolicy?: RepairPolicy; correction?: CorrectionReceipt; checkpoint?:TurnCheckpointReceipt; reason?: string };

export type TurnReport = {
  turn: number;
  playerId: string;
  status: "pending" | "stable" | "unstable" | "partial" | "unresolved";
  reason: string;
  penalty: 0 | -1;
  analysis?: StructuralAnalysisResult;
  issues?: IssueAssessment;
  penaltyDecision?: PenaltyDecision;
  correction?: CorrectionReceipt;
};

export interface TurnState {
  version: typeof KIT_PLAYTEST.version;
  catalogue: CatalogueId;
  rulesRevision?: typeof PLAY_REVISION;
  seed: number;
  turn: number;
  playerIndex: number;
  players: TurnPlayer[];
  decks: [TurnCard[], TurnCard[]] | [TurnCard[], TurnCard[], TurnCard[]];
  /** Private, replay-checked receipts. The opening draw is turn one's ordinary draw. */
  draws?: { turn: number; playerId: string; pieces: string[]; connectors: string[]; loads?: string[]; remaining: number[] }[];
  nextId: number;
  draft: Placements;
  board: Board;
  reports: TurnReport[];
  events: Event[];
  finished: boolean;
  finalScore?: FinalScore;
  checkpoints?: TurnCheckpoints;
}

export function boardLimits(state: Pick<TurnState, "catalogue">) {
  return state.catalogue === RELEASE_CATALOGUE ? RELEASE_MANIFEST.boardMax : KIT_PLAYTEST.boardMax;
}

type Transition =
  | { ok: true; state: TurnState }
  | { ok: false; reason: string };

const emptyDraft = (): Placements => ({
  members: [],
  loads: [],
  connections: [],
});
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

function createDecks(seed: number, catalogue: CatalogueId, revision?: typeof PLAY_REVISION): TurnState["decks"] {
  if (catalogue === RELEASE_CATALOGUE) {
    if (revision === PLAY_REVISION) {
      const decks = createReleaseDecks(revision).map((cards, index) => shuffle(cards, seed ^ (index * 0x9e3779b9)));
      const members = decks[0];
      for (let slot = 0; slot < 8; slot++) {
        const index = members.findIndex((card, i) => i >= slot && card.kind === 'element' && card.type === 'heb');
        [members[slot], members[index]] = [members[index], members[slot]];
      }
      return decks as [TurnCard[], TurnCard[], TurnCard[]];
    }
    const [pieces, connectors] = createReleaseDecks();
    if ([pieces, connectors].some(deck => deck.length < KIT_PLAYTEST.rounds * KIT_PLAYTEST.players * 2))
      throw new Error("The release deck cannot supply every regular draw.");
    return [shuffle(pieces, seed), shuffle(connectors, seed ^ 0x9e3779b9)];
  }
  const deck1: TurnCard[] = [],
    deck2: TurnCard[] = [];
  const count = KIT_PLAYTEST.players * KIT_PLAYTEST.rounds * 2;
  for (let i = 0; i < count; i++) {
    const cards = printedCards(i, catalogue);
    deck1.push(cards.element, cards.load);
    deck2.push(cards.connection);
  }
  return [shuffle(deck1, seed), shuffle(deck2, seed ^ 0x9e3779b9)];
}

function draw(state: TurnState): TurnState {
  const pieces = state.decks[0].slice(0, 2), connectors = state.decks[1].slice(0, 2);
  const received = [...pieces, ...connectors];
  const decks: TurnState["decks"] = [state.decks[0].slice(2), state.decks[1].slice(2)];
  const release = state.catalogue === RELEASE_CATALOGUE;
  if (release && received.length !== 4) throw new Error("Private deck cannot supply the required turn draw.");
  return {
    ...state,
    decks,
    ...(release && {draws: [...(state.draws ?? []), {turn:state.turn, playerId:state.players[state.playerIndex].id,
      pieces:pieces.map(c => c.id), connectors:connectors.map(c => c.id), remaining:[decks[0].length,decks[1].length] as [number,number]}]}),
    players: state.players.map((player, i) =>
      i === state.playerIndex
        ? { ...player, hand: [...player.hand, ...received] }
        : player,
    ),
  };
}

export function createTurnGame(seed = 1, catalogue: CatalogueId = LEGACY_CATALOGUE, rulesRevision?: typeof PLAY_REVISION): TurnState {
  const players = [
    { id: "player-1", score: 0, hand: [] },
    { id: "player-2", score: 0, hand: [] },
  ];
  const board: Board = { ...emptyDraft(), joints: [] };
  players.forEach((player, i) => {
    const [x, y] = catalogue === RELEASE_CATALOGUE ? RELEASE_MANIFEST.setup[i] : [1 + i * 4, 3];
    const a = nodeKey(x, y, 0),
      b = nodeKey(x, y, 1),
      id = i + 1;
    board.members.push({ id, a, b, type: catalogue === RELEASE_CATALOGUE ? "heb" : "shs", owner: player.id });
    board.joints.push({ id: a, foundationOwner: player.id }, { id: b });
    board.connections.push(
      {
        memberId: id,
        end: "a",
        jointId: a,
        profile: "fixed",
        owner: player.id,
      },
      {
        memberId: id,
        end: "b",
        jointId: b,
        profile: "fixed",
        owner: player.id,
      },
    );
  });
  seed >>>= 0;
  const initial: TurnState = {
    version: KIT_PLAYTEST.version,
    catalogue,
    ...(rulesRevision && {rulesRevision,checkpoints:createTurnCheckpoints()}),
    seed,
    turn: 1,
    playerIndex: 0,
    players,
    decks: createDecks(seed, catalogue, rulesRevision),
    nextId: 3,
    draft: emptyDraft(),
    board,
    reports: [],
    events: [],
    finished: false,
    ...(rulesRevision && {draws: []}),
  };
  return rulesRevision ? initial : draw(initial);
}

/** Normal Play uses the revised deck and node-fitting repair policy. Historical
 * createTurnGame/replay callers retain their original unversioned printings. */
export function createReleaseGame(seed = 1): TurnState {
  return createTurnGame(seed, RELEASE_CATALOGUE, PLAY_REVISION);
}

/** Persist an interval choice as an ordinary replayable settings event.
 * Changing it does not assess a pending turn or alter original card actions. */
export function changeCheckpointInterval(state: TurnState, interval: number): Transition {
  if (state.rulesRevision !== PLAY_REVISION || !state.checkpoints || state.finished)
    return fail('This match does not permit checkpoint interval changes.');
  try {
    const checkpoints = changeTurnCheckpointInterval(state.checkpoints,interval);
    return checkpoints === state.checkpoints ? {ok:true,state} : {ok:true,state:{...state,checkpoints,
      events:[...state.events,{kind:'interval',interval}]}};
  } catch (error) { return fail(error instanceof Error ? error.message : 'Invalid analysis interval.'); }
}

export type DrawSource = 'members' | 'connections' | 'loads';
export function remainingTurnDraws(state: TurnState) {
  if (state.rulesRevision !== PLAY_REVISION || state.finished) return 0;
  const draw = state.draws?.find(receipt => receipt.turn === state.turn);
  return 4 - (draw ? draw.pieces.length + draw.connectors.length + (draw.loads?.length ?? 0) : 0);
}

/** Each deliberate choice draws one actual card from one of the three finite
 * decks. Repeated/late draws are rejected, and cancellations never redraw. */
export function chooseTurnDraw(state: TurnState, source: DrawSource): Transition {
  if (state.rulesRevision !== PLAY_REVISION || state.finished || remainingTurnDraws(state) <= 0)
    return fail('This turn has no remaining draws.');
  const index = {members: 0, connections: 1, loads: 2}[source];
  const deck = state.decks[index];
  const card = deck?.[0];
  if (!card) return fail('That deck is empty. Choose another deck.');
  const decks = state.decks.map((cards, i) => i === index ? cards.slice(1) : cards) as TurnState['decks'];
  const previous = state.draws?.find(draw => draw.turn === state.turn);
  const receipt = previous ? {...previous, pieces: [...previous.pieces], connectors: [...previous.connectors], loads: [...(previous.loads ?? [])]} :
    {turn: state.turn, playerId: activePlayer(state).id, pieces: [], connectors: [], loads: [], remaining: []};
  const field = source === 'members' ? 'pieces' : source === 'connections' ? 'connectors' : 'loads';
  receipt[field].push(card.id);
  receipt.remaining = decks.map(cards => cards.length);
  return {ok: true, state: {...state, decks,
    players: state.players.map((player, i) => i === state.playerIndex ? {...player, hand: [...player.hand, card]} : player),
    draws: [...(state.draws ?? []).filter(draw => draw.turn !== state.turn), receipt],
    events: [...state.events, {kind: 'draw', source, cardId: card.id}]}};
}

const activePlayer = (state: TurnState) => state.players[state.playerIndex];

function draftIds(state: TurnState): Set<string | undefined> {
  return new Set(
    [
      ...state.draft.members,
      ...state.draft.loads,
      ...state.draft.connections,
    ].map(({ cardId }) => cardId),
  );
}

export function activeTurnHand(state: TurnState): TurnCard[] {
  if (state.finished) return [];
  const used = draftIds(state);
  const cards = activePlayer(state).hand.filter(({ id }) => !used.has(id));
  if (state.catalogue === RELEASE_CATALOGUE) {
    const order = {element: 0, load: 1, connection: 2};
    cards.sort((a,b) => order[a.kind] - order[b.kind]);
  }
  return cards;
}

function stage(
  state: TurnState,
  draft: Placements,
  event: Event,
  nextId = state.nextId,
): Transition {
  if (remainingTurnDraws(state)) return fail('Choose all four cards before placing anything.');
  return {
    ok: true,
    state: { ...state, draft, nextId, events: [...state.events, event] },
  };
}

function validPoint(state: TurnState, key: string): boolean {
  const point = parseNodeKey(key);
  return (
    point.length === 3 &&
    nodeKey(...point) === key &&
    point.every(
      (value, axis) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= boardLimits(state)[axis],
    )
  );
}

export function stageElement(
  state: TurnState,
  cardId: string,
  a: string,
  b: string,
): Transition {
  const card = activeTurnHand(state).find(({ id }) => id === cardId);
  if (card?.kind !== "element")
    return fail("Choose an element card from your hand.");
  if (state.rulesRevision !== PLAY_REVISION && state.draft.members.length >= 1)
    return fail("One element may be played per turn.");
  const parents = state.rulesRevision === PLAY_REVISION ? [...state.board.members, ...state.draft.members] : state.board.members;
  if (systemTarget(state, a) || systemTarget(state, b)) return fail("Neutral repair objects are inspection-only.");
  const portA = findPort(parents, a), portB = findPort(parents, b);
  if (portA?.available === false || portB?.available === false)
    return fail("This family’s interior attachment law is unavailable.");
  const pointA = portA ? nodeKey(...portA.point) : a;
  const pointB = portB ? nodeKey(...portB.point) : b;
  if ((!portA && !validPoint(state,a)) || (!portB && !validPoint(state,b)) || pointA === pointB)
    return fail("Choose two distinct points on the board.");
  const start = parseNodeKey(pointA),
    end = parseNodeKey(pointB);
  const lengths = end
    .map((value, axis) => Math.abs(value - start[axis]))
    .filter(Boolean);
  const length = Math.hypot(...lengths);
  if (state.catalogue === RELEASE_CATALOGUE && length > card.maxSteps)
    return fail(`Choose a span of at most ${card.maxSteps} grid units (${card.maxSteps * S} m).`);
  if (state.catalogue !== RELEASE_CATALOGUE && lengths.some((value) => value > card.maxSteps || value !== lengths[0])) {
    return fail("Choose a lattice direction within the card’s length limit.");
  }
  if (
    state.board.members.some(
      (member) =>
        (member.a === pointA && member.b === pointB) ||
        (member.a === pointB && member.b === pointA),
    )
  ) {
    return fail("A member already occupies these endpoints.");
  }
  const member: TurnMember = {
    id: state.nextId,
    a: pointA,
    b: pointB,
    ...(portA || portB ? { endTargets: { ...(portA && { a }), ...(portB && { b }) } } : {}),
    type: card.type,
    ...(card.springStiffnessNPerM !== undefined && {springStiffnessNPerM: card.springStiffnessNPerM}),
    ...(state.catalogue === RELEASE_CATALOGUE && card.type === "cable" && {restLengthM: S * length}),
    ...(card.type === "cable" && card.definitionId.startsWith("element/tension-cable-25/") && {
      restLengthM: resolveMemberLaw("cable", S * Math.hypot(...lengths)).restLength,
    }),
    ...(card.assembly && { assembly: card.assembly }),
    owner: activePlayer(state).id,
    cardId,
  };
  if (isScoredCatalogue(state.catalogue)) {
    const clash = findMaterialClash(member, parents);
    if (clash) return fail(clash);
  }
  return stage(
    state,
    { ...state.draft, members: [...state.draft.members, member] },
    { kind: "element", cardId, a, b },
    state.nextId + 1,
  );
}

export function stageLoad(
  state: TurnState,
  cardId: string,
  jointId: string,
): Transition {
  const card = activeTurnHand(state).find(({ id }) => id === cardId);
  if (card?.kind !== "load") return fail("Choose a load card from your hand.");
  if (state.rulesRevision !== PLAY_REVISION && state.draft.loads.length >= 1)
    return fail("One load may be played per turn.");
  if (systemTarget(state, jointId)) return fail("Neutral repair objects are inspection-only.");
  if (!loadTargets(state).some(({ id }) => id === jointId))
    return fail(state.catalogue === RELEASE_CATALOGUE
      ? "Choose an above-ground tip or quarter of a player-built member, away from setup and neutral joints."
      : "Choose an existing or staged shared joint.");
  const load: Load = {
    cardId,
    jointId,
    magnitude: card.magnitude,
    owner: activePlayer(state).id,
  };
  return stage(
    state,
    { ...state.draft, loads: [...state.draft.loads, load] },
    { kind: "load", cardId, jointId },
  );
}

/** First attachment owns the permission frame, independent of ground restraints. */
function jointProfileConflict(connections: readonly Connection[]): string | null {
  const established = new Map<string, Connection>();
  for (const candidate of connections) {
    const first = established.get(candidate.jointId);
    if (!first) {
      established.set(candidate.jointId, candidate);
      continue;
    }
    const axes = conflictingJointAxes(
      CONNECTION_PROFILES[first.profile],
      CONNECTION_PROFILES[candidate.profile],
      connectionFrame(first.profile),
      connectionFrame(candidate.profile),
    );
    if (axes.length) return (
      `Incompatible joint profiles at ${candidate.jointId}. Member ${first.memberId} end ${first.end.toUpperCase()} uses ${first.profile}. ` +
      `Member ${candidate.memberId} end ${candidate.end.toUpperCase()} with ${candidate.profile} conflicts on ${axes.join(", ")}. ` +
      "Choose a matching connector or another joint."
    );
  }
  return null;
}

export function stageConnection(
  state: TurnState,
  cardId: string,
  memberId: number,
  end: "a" | "b",
  jointId?: string,
  profile?: ConnectionProfile,
): Transition {
  const card = activeTurnHand(state).find(({ id }) => id === cardId);
  if (card?.kind !== "connection")
    return fail("Choose a connection card from your hand.");
  if (state.rulesRevision !== PLAY_REVISION && state.draft.connections.length >= 2)
    return fail("Two connections may be played per turn.");
  const member = [...state.board.members, ...state.draft.members].find(
    ({ id }) => id === memberId,
  );
  if (!member || (end !== "a" && end !== "b"))
    return fail("Choose one end of an existing or staged member.");
  if (member.system) return fail("Neutral repair objects are inspection-only.");
  const connections = [...state.board.connections, ...state.draft.connections];
  if (connections.some((item) => item.memberId === memberId && item.end === end)) {
    return fail("This end already has an immutable connection.");
  }
  const target = jointId ?? member.endTargets?.[end] ?? member[end];
  if (systemTarget(state, target)) return fail("Neutral repair objects are inspection-only.");
  const parents = [...state.board.members, ...state.draft.members];
  const port = findPort(parents, target);
  if (port && (!port.available || port.memberId === memberId))
    return fail("Choose a supported quarter port on a different parent.");
  if (targetCoordinate(parents, target) !== member[end] || (!port && !validPoint(state,target)))
    return fail("Choose a shared joint or original quarter port at the member end.");
  const choices = connectionChoices(card);
  const chosen = profile ?? (choices.length === 1 ? choices[0] : undefined);
  if (!chosen || !choices.includes(chosen))
    return fail("Choose the global rotation axes permitted by this connector.");
  const connection: Connection = {
    cardId,
    memberId,
    end,
    jointId: target,
    profile: chosen,
    owner: activePlayer(state).id,
  };
  const conflict = jointProfileConflict([...connections, connection]);
  if (conflict) return fail(conflict);
  const draft = { ...state.draft, connections: [...state.draft.connections, connection] };
  if (state.catalogue === RELEASE_CATALOGUE && draft.loads.some(load =>
      !loadTargets({...state, draft}).some(target => target.id === load.jointId)))
    return fail("This attachment would put the staged load on an excluded setup or neutral joint.");
  return stage(
    state,
    draft,
    { kind: "connection", cardId, memberId, end, jointId, ...(profile && {profile}) },
  );
}

export function cancelTurnDraft(state: TurnState): Transition {
  if (state.finished) return fail("The playtest match is complete.");
  const count = draftIds(state).size;
  if (!count) return { ok: true, state };
  return {
    ok: true,
    state: {
      ...state,
      draft: emptyDraft(),
      nextId: state.nextId - state.draft.members.length,
      events: state.events.slice(0, -count),
    },
  };
}

/** Undo the latest provisional action only. Committed history and the turn's
 * recorded draw stay unchanged, and replay reconstructs every earlier stage. */
export function undoLastPlacement(state: TurnState): Transition {
  if (state.finished) return fail('The match is complete.');
  const count = draftIds(state).size;
  if (!count) return fail('There is no provisional placement to undo.');
  const boundary = state.events.length - count;
  let rebuilt = {...state, draft: emptyDraft(), nextId: state.nextId - state.draft.members.length,
    events: state.events.slice(0, boundary)};
  for (const event of state.events.slice(boundary, -1)) {
    const result = replayEvent(rebuilt, event);
    if (!result?.ok) return fail('The draft could not be restored for undo.');
    rebuilt = result.state;
  }
  return {ok: true, state: rebuilt};
}

/** Replace an uncommitted member's endpoint event and replay its dependent
 * draft operations atomically. Invalid edits preserve the existing draft. */
export function editDraftMember(state: TurnState, memberId: number, a: string, b: string): Transition {
  const member = state.draft.members.find(candidate => candidate.id === memberId);
  if (!member || !member.cardId) return fail('Only a provisional member may be edited.');
  const count = draftIds(state).size;
  const boundary = state.events.length - count;
  let rebuilt = {...state, draft: emptyDraft(), nextId: state.nextId - state.draft.members.length,
    events: state.events.slice(0, boundary)};
  for (const event of state.events.slice(boundary)) {
    const updated = event.kind === 'element' && event.cardId === member.cardId ? {...event, a, b} : event;
    const result = replayEvent(rebuilt, updated);
    if (!result?.ok) return fail(result?.reason ?? 'The edited member conflicts with its draft attachments.');
    rebuilt = result.state;
  }
  return {ok: true, state: rebuilt};
}

export function endTurn(
  state: TurnState,
  expectedTurn = state.turn,
  status: TurnReport["status"] = "unresolved",
  analysis?: StructuralAnalysisResult,
  /** The analysis's own explanation; a generic one for the status otherwise. */
  reason?: string,
): Transition {
  return commitTurn(state, expectedTurn, status, undefined, analysis, reason);
}

/** Recheck the frozen player operations against the committed board, hand and
 * per-turn limits before any analysis can produce a receipt or spend a card. */
function validateReleaseDraft(state: TurnState): string | null {
  const count = state.draft.members.length + state.draft.connections.length + state.draft.loads.length;
  if (state.rulesRevision === PLAY_REVISION) {
    const start = state.events.map(event => event.kind).lastIndexOf('end') + 1;
    const current = state.events.slice(start);
    const placements = current.filter(event => event.kind === 'element' || event.kind === 'connection' || event.kind === 'load');
    const placementEvents = new Set<Event>(placements);
    if (placements.length !== count) return 'The draft does not match this turn’s staged actions.';
    // Draws and interval choices can be interleaved with placement. Their
    // authoritative state is already present; reconstruct only spent actions.
    let rebuilt = {...state,nextId:state.nextId-state.draft.members.length,draft:emptyDraft(),
      events:[...state.events.slice(0,start),...current.filter(event => !placementEvents.has(event))]};
    for (const event of placements) {
      const checked = replayEvent(rebuilt,event);
      if (!checked?.ok) return checked?.reason ?? 'Invalid staged action.';
      rebuilt = checked.state;
    }
    return matchesIssueEvidence(rebuilt.draft,state.draft) && rebuilt.nextId === state.nextId ? null :
      'The draft changed. Restore the last confirmed revision.';
  }
  if (state.rulesRevision !== PLAY_REVISION && count > 4) return "The draft exceeds the turn's card allowances.";
  const boundary = state.events.length - count;
  if (boundary < 0 || (boundary > 0 && state.events[boundary-1].kind !== "end" &&
      !(state.rulesRevision === PLAY_REVISION && state.events[boundary-1].kind === 'draw')))
    return "The draft does not match this turn’s staged actions.";
  let rebuilt = {...state, nextId: state.nextId - state.draft.members.length, draft: emptyDraft(), events: state.events.slice(0,boundary)};
  for (const event of state.events.slice(boundary)) {
    if (event.kind === "end") return "The draft includes an already completed turn.";
    const checked = replayEvent(rebuilt,event);
    if (!checked?.ok) return checked?.reason ?? "Invalid staged action.";
    rebuilt = checked.state;
  }
  return matchesIssueEvidence(rebuilt.draft,state.draft) && rebuilt.nextId === state.nextId ? null :
    "The draft changed. Restore the last confirmed revision.";
}

function commitTurn(
  state: TurnState,
  expectedTurn: number,
  status: TurnReport["status"] = "unresolved",
  replay?: { final: unknown; issues: unknown; penaltyDecision: unknown; repairPolicy: unknown; correction: unknown; checkpoint?:unknown },
  analysis?: StructuralAnalysisResult,
  /** Account of the turn to record and replay; a generic sentence for the status otherwise. */
  reason?: string,
): Transition {
  if (state.finished || expectedTurn !== state.turn)
    return fail("This turn has already ended.");
  if (remainingTurnDraws(state)) return fail('Choose all four cards before ending the turn.');
  if (state.catalogue === RELEASE_CATALOGUE) {
    const invalid = validateReleaseDraft(state);
    if (invalid) return fail(invalid);
  }
  if (isScoredCatalogue(state.catalogue)) {
    const occupied = [...state.board.members];
    for (const member of state.draft.members) {
      const clash = findMaterialClash(member, occupied);
      if (clash) return fail(clash);
      occupied.push(member);
    }
  }
  const connections = [...state.board.connections, ...state.draft.connections];
  const conflict = jointProfileConflict(connections);
  if (conflict) return fail(conflict);
  const player = activePlayer(state),
    spent = draftIds(state);
  if (state.rulesRevision === PLAY_REVISION) {
    if (analysis !== undefined || reason !== undefined) return fail('Checkpoint evidence must come from the recorded structure.');
    const board = {members:[...state.board.members,...state.draft.members],connections,
      loads:[...state.board.loads,...state.draft.loads],joints:turnJoints(state),
      ...(state.board.jointCorrections && {jointCorrections:state.board.jointCorrections})};
    const finished = state.turn === KIT_PLAYTEST.players * KIT_PLAYTEST.rounds;
    const queued = queueTurnCheckpoint(state,board,state.checkpoints,finished);
    const waiting: TurnState = {...state,board,draft:emptyDraft(),reports:[...state.reports,queued.report]};
    const resolved = queued.due ? resolveTurnCheckpoint(waiting,queued.checkpoints,finished) :
      {board,reports:waiting.reports,checkpoints:queued.checkpoints,receipt:undefined};
    const report = resolved.reports.find(entry => entry.turn === state.turn)!;
    const repairPolicy = report.issues ? NODE_REPAIR_POLICY : undefined;
    if (replay && (status !== report.status || !matchesIssueEvidence(report.issues,replay.issues) ||
      !matchesIssueEvidence(report.penaltyDecision,replay.penaltyDecision) || repairPolicy !== replay.repairPolicy ||
      !matchesIssueEvidence(report.correction,replay.correction) || !matchesIssueEvidence(resolved.receipt,replay.checkpoint)))
      return fail('The saved checkpoint attribution does not match its original turn window.');
    const endEvent: Extract<Event,{kind:'end'}> = {kind:'end',turn:state.turn,status:report.status,
      ...(report.issues && {issues:report.issues,penaltyDecision:report.penaltyDecision,repairPolicy}),
      ...(report.correction && {correction:report.correction}),...(resolved.receipt && {checkpoint:resolved.receipt})};
    let committed: TurnState = {...waiting,board:resolved.board,checkpoints:resolved.checkpoints,reports:resolved.reports,
      finished,turn:finished ? state.turn : state.turn+1,
      playerIndex:finished ? state.playerIndex : (state.playerIndex+1)%state.players.length,
      players:state.players.map(entry => entry === player ? {...entry,hand:entry.hand.filter(({id}) => !spent.has(id))} : entry),
      events:[...state.events,endEvent]};
    if (finished) {
      let result: ReturnType<typeof analyzeTurn> | null = null;
      try { result = analyzeTurn(committed,'card-gravity'); } catch { /* Unknown reactions stay unavailable. */ }
      const finalScore = awardFinalScore(committed,finalReceipt(committed,result));
      if (replay && !matchesIssueEvidence(finalScore,replay.final)) return fail('The saved final award does not match its checkpoint.');
      const scores = new Map(finalScore.awards.map(award => [award.playerId,award.finalScore]));
      committed = {...committed,finalScore,players:committed.players.map(entry => ({...entry,score:scores.get(entry.id)!})),
        events:[...state.events,{...endEvent,final:finalScore}]};
    } else if (replay?.final !== undefined) return fail('Unexpected final score before match completion.');
    return {ok:true,state:committed};
  }
  if (status === 'pending') return fail('This historical rules version requires an immediate assessed turn.');
  // Old scored receipts did not record an assessment. Keep their historical
  // evidence scope while replaying. A new assessed event must reproduce it.
  const previous = state.reports.at(-1);
  const release = state.catalogue === RELEASE_CATALOGUE;
  if (release && (reason !== undefined || analysis !== undefined))
    return fail("Release turn evidence must come from the assessed structure.");
  const expectedRepair = state.rulesRevision === PLAY_REVISION ? NODE_REPAIR_POLICY : REPAIR_POLICY;
  if (release && replay && (!replay.issues || !replay.penaltyDecision || replay.repairPolicy !== expectedRepair))
    return fail("Missing or unsupported release turn evidence.");
  const outcome = isScoredCatalogue(state.catalogue) && (!replay || replay.issues !== undefined)
    ? assessTurnOutcome(state, previous?.correction?.memory ?? previous?.issues?.memory) : undefined;
  const issues = outcome?.issues;
  if (release && outcome) {
    if (replay && status !== outcome.status) return fail("Saved stability does not match the assessed turn.");
    status = outcome.status;
  }
  if (replay?.issues !== undefined && !matchesIssueEvidence(issues, replay.issues))
    return fail("The saved issue assessment does not match the replayed structure.");
  // Earlier matches recorded issue comparisons before penalties were in force.
  // Keep their original awards even if those comparisons contain eligible changes.
  const penaltyDecision = issues && (!replay || replay.penaltyDecision !== undefined)
    ? decidePenalty(state, issues) : undefined;
  if (replay?.penaltyDecision !== undefined && !matchesIssueEvidence(penaltyDecision, replay.penaltyDecision))
    return fail("The saved penalty decision does not match the originating turn.");
  const frozen = { ...state, board: {
    members: [...state.board.members, ...state.draft.members], connections,
    loads: [...state.board.loads, ...state.draft.loads], joints: turnJoints(state),
    ...(state.board.jointCorrections && {jointCorrections:state.board.jointCorrections}),
  }, draft: emptyDraft() };
  const repairPolicy = replay ? replay.repairPolicy : penaltyDecision && expectedRepair;
  if (repairPolicy !== undefined && ((repairPolicy !== REPAIR_POLICY && repairPolicy !== LEGACY_REPAIR_POLICY && repairPolicy !== NODE_REPAIR_POLICY) || !penaltyDecision))
    return fail("Unsupported or incomplete saved correction policy.");
  const repair = issues && repairPolicy ? repairPolicy === NODE_REPAIR_POLICY
    ? correctJointReleases(frozen, issues, state.turn) : correctTurnIssues(frozen, issues, state.turn, repairPolicy) : undefined;
  if (replay && !matchesIssueEvidence(repair?.receipt, replay.correction))
    return fail("The saved corrective work does not match the originating turn and verified structure.");
  const endEvent: Extract<Event, { kind: "end" }> = {
    kind: "end", turn: state.turn, status, ...(analysis && { analysis }),
    ...(issues && { issues }), ...(penaltyDecision && { penaltyDecision }),
    ...(repairPolicy && { repairPolicy }),
    ...(repair && { correction: repair.receipt }),
    ...(reason !== undefined && { reason }),
  };
  const report: TurnReport = {
    turn: state.turn,
    playerId: player.id,
    status,
    reason: release ? {
      stable: "Verified component equilibrium.",
      unstable: "A physical instability was witnessed.",
      partial: "Only part of the structure has verified equilibrium.",
      unresolved: "Equilibrium could not be verified.",
    }[status] : reason ?? {
      stable: "The experimental applied-load solve converged.",
      unstable: "The experimental solve indicates a mechanism or excessive displacement.",
      partial: "Supported geometry was analyzed. Floating components are excluded from the numerical solve.",
      unresolved: "The experimental solve did not produce a result for this turn.",
    }[status],
    penalty: penaltyDecision?.event?.amount ?? 0,
    ...(analysis && { analysis }),
    ...(issues && { issues }),
    ...(penaltyDecision && { penaltyDecision }),
    ...(repair && { correction: repair.receipt }),
  };
  const finished = state.turn === KIT_PLAYTEST.players * KIT_PLAYTEST.rounds;
  const committed: TurnState = {
    ...(repair?.state ?? frozen),
    finished,
    turn: finished ? state.turn : state.turn + 1,
    playerIndex: finished
      ? state.playerIndex
      : (state.playerIndex + 1) % state.players.length,
    players: state.players.map((entry) =>
      entry === player
        ? { ...entry, hand: entry.hand.filter(({ id }) => !spent.has(id)) }
        : entry,
    ),
    reports: [...state.reports, report],
    events: [...state.events, endEvent],
  };
  if (finished && isScoredCatalogue(state.catalogue)) {
    let finalScore: FinalScore | null;
    if (replay && !release) {
      finalScore = recoverFinalScore(committed, replay.final);
      if (!finalScore) return fail("The final score receipt does not match the saved match.");
    } else {
      let analysis: ReturnType<typeof analyzeTurn> | null = null;
      try {
        analysis = analyzeTurn(committed, "card-gravity");
      } catch {
        // A failed solve leaves the full gravity denominator and historical penalties intact.
      }
      finalScore = awardFinalScore(committed, finalReceipt(committed, analysis));
      if (replay && !matchesIssueEvidence(finalScore, replay.final))
        return fail("The saved final award does not match the verified reactions and deductions.");
    }
    const scores = new Map(finalScore.awards.map(a => [a.playerId, a.finalScore]));
    return { ok: true, state: { ...committed, finalScore,
      players: committed.players.map(p => ({ ...p, score: scores.get(p.id)! })),
      events: [...state.events, { ...endEvent, final: finalScore }],
    } };
  }
  if (replay?.final !== undefined) return fail("Unexpected final score before scored-match completion.");
  return { ok: true, state: finished || state.rulesRevision === PLAY_REVISION ? committed : draw(committed) };
}

/** The voxel shape is a render projection. Per-end connector laws live in TurnState. */
export function projectTurnModel(state: TurnState): GameModel {
  const attrs: GameModel["attrs"] = {};
  const joints = turnJoints(state);
  for (const joint of joints) {
    const key = joint.point ?? joint.id;
    attrs[key] = joint.foundationOwner || attrs[key]?.found
      ? { found: true, locked: true }
      : { joint: true };
  }
  for (const load of [...state.board.loads, ...state.draft.loads]) {
    const target = analysisLoadJoint(state, load.jointId);
    const key = joints.find(j => j.id === target)?.point ?? target;
    attrs[key] = {
      ...attrs[key],
      load: (attrs[key]?.load ?? 0) + load.magnitude,
    };
  }
  const members = [...state.board.members, ...state.draft.members].map(
    ({ id, a, b, type, assembly, restLengthM, springStiffnessNPerM }) => ({ id, a, b, type, ...(assembly && { assembly }), ...(restLengthM !== undefined && { restLengthM }), ...(springStiffnessNPerM !== undefined && {springStiffnessNPerM}) }),
  );
  return { attrs, members, nextId: state.nextId };
}

/** Replay validated user actions so persisted deck order, ownership and scores cannot drift. */
export function parseTurnState(raw: unknown): TurnState | null {
  const result = replayTurnState(raw);
  return result.ok ? result.state : null;
}

/** Keep the failing event's public diagnosis available to the save-recovery UI. */
export function replayTurnState(raw: unknown): Transition {
  if (
    !record(raw) ||
    raw.version !== KIT_PLAYTEST.version ||
    typeof raw.seed !== "number" ||
    !Number.isInteger(raw.seed) ||
    raw.seed < 0 ||
    raw.seed > 0xffffffff ||
    !Array.isArray(raw.events) ||
    raw.events.length > (raw.rulesRevision === PLAY_REVISION ? 256 : KIT_PLAYTEST.players * KIT_PLAYTEST.rounds * 5)
  )
    return fail("Unrecognized match format or invalid replay header.");
  // Original version-one saves predate catalogue selection and keep their
  // deterministic five-family hands, including experimental cables.
  const catalogue = raw.catalogue === undefined ? LEGACY_CATALOGUE : raw.catalogue;
  if (catalogue !== LEGACY_CATALOGUE && !isScoredCatalogue(catalogue)) {
    return fail("Saved match requires an unsupported physical catalogue.");
  }
  if (raw.rulesRevision !== undefined && (raw.rulesRevision !== PLAY_REVISION || catalogue !== RELEASE_CATALOGUE))
    return fail('Saved match requires an unsupported rules revision.');
  let state = createTurnGame(raw.seed, catalogue, raw.rulesRevision as typeof PLAY_REVISION | undefined);
  for (const event of raw.events) {
    const result = replayEvent(state, event);
    if (!result) return fail("Unrecognized saved turn action.");
    if (!result.ok) return result;
    state = result.state;
  }
  if (catalogue === RELEASE_CATALOGUE) {
    // Compact event-only saves and full private exports use the same replay.
    // A forged snapshot may not contradict its deck order, cards or receipts.
    for (const key of Object.keys(state) as (keyof TurnState)[]) {
      if (key in raw && !matchesIssueEvidence(state[key], raw[key]))
        return fail(`Saved ${key} does not match the release replay.`);
    }
  }
  return { ok: true, state };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replayEvent(state: TurnState, event: unknown): Transition | null {
  if (!record(event)) return null;
  if (event.kind === 'interval' && typeof event.interval === 'number') return changeCheckpointInterval(state,event.interval);
  if (event.kind === 'draw' && (event.source === 'members' || event.source === 'connections' || event.source === 'loads')) {
    const result = chooseTurnDraw(state, event.source);
    const drawn = result.ok ? result.state.events.at(-1) : undefined;
    if (result.ok && (drawn?.kind !== 'draw' || drawn.cardId !== event.cardId)) return fail('Saved draw does not match the chosen deck.');
    return result;
  }
  if (event.kind === "end" && typeof event.turn === "number") {
    if (event.status !== undefined && !(event.status === 'pending' && state.rulesRevision === PLAY_REVISION) && event.status !== "stable" && event.status !== "unstable" &&
      event.status !== "partial" && event.status !== "unresolved") return null;
    // The structural cross-check's account replays with the turn, so a
    // restored match shows what the selected solver said.
    const reason = typeof event.reason === "string" ? event.reason : undefined;
    let analysis: StructuralAnalysisResult | undefined;
    if (event.analysis !== undefined) {
    const parsed = structuralAnalysisResultSchema.safeParse(event.analysis);
    if (!parsed.success) return null;
    analysis = parsed.data;
    const snapshot = analysis.request.snapshot;
    const prior = state.reports.at(-1)?.analysis?.request.snapshot;
    if (
      analysis.purpose !== "turn" ||
      analysis.turn?.matchId !== snapshot.modelId ||
      analysis.turn?.turnId !== String(state.turn) ||
      analysis.turn.playerId !== activePlayer(state).id ||
      analysis.turn.rulesVersion !== String(state.version) ||
      state.reports.some(report => report.analysis?.runId === parsed.data.runId) ||
      snapshot.revisionId !== "turn-" + state.turn ||
      analysis.status !== (event.status === "stable" ? "success" : event.status === "unstable" ? "unstable" : "unresolved") ||
      snapshot.parentRevisionId !== prior?.revisionId ||
      (prior && prior.modelId !== snapshot.modelId)
    ) return null;
    }
    return commitTurn(state, event.turn, event.status, {
      final: event.final, issues: event.issues, penaltyDecision: event.penaltyDecision,
      repairPolicy: event.repairPolicy, correction: event.correction,
      checkpoint:event.checkpoint,
    }, analysis, reason);
  }
  if (typeof event.cardId !== "string") return null;
  if (
    event.kind === "element" &&
    typeof event.a === "string" &&
    typeof event.b === "string"
  ) {
    return stageElement(state, event.cardId, event.a, event.b);
  }
  if (event.kind === "load" && typeof event.jointId === "string")
    return stageLoad(state, event.cardId, event.jointId);
  if (
    event.kind === "connection" &&
    typeof event.memberId === "number" &&
    (event.end === "a" || event.end === "b") &&
    (event.jointId === undefined || typeof event.jointId === "string") &&
    (event.profile === undefined || (typeof event.profile === "string" && Object.hasOwn(CONNECTION_PROFILES,event.profile)))
  ) {
    return stageConnection(
      state,
      event.cardId,
      event.memberId,
      event.end,
      event.jointId,
      event.profile as ConnectionProfile | undefined,
    );
  }
  return null;
}
