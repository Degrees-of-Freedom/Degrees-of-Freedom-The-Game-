import { structuralAnalysisResultSchema, type StructuralAnalysisResult } from '@dof/solver-contract';
import {
  nodeKey,
  parseNodeKey,
  type GameModel,
  type Member,
} from "./model";
import { LEGACY_CATALOGUE, RELEASE_CATALOGUE, RELEASE_MANIFEST, connectionChoices, createReleaseDecks, isScoredCatalogue, printedCards, type CardDefinition, type CatalogueId } from "./cardCatalogue";
import { conflictingJointAxes, connectionFrame, CONNECTION_PROFILES, type ConnectionProfile } from "./jointFreedom";
import { findMaterialClash } from "./materialClashes";
import { analysisLoadJoint, findPort, loadTargets, systemTarget, targetCoordinate, turnJoints } from "./turnPorts";
import { analyzeTurn } from "./turnAnalysis";
import { resolveMemberLaw, S } from "../evaluator/sections";
import { correctTurnIssues, LEGACY_REPAIR_POLICY, REPAIR_POLICY, type CorrectionReceipt, type RepairPolicy, type SystemProvenance } from "./turnRepair";
import { assessTurnOutcome, matchesIssueEvidence, type IssueAssessment } from "./turnIssues";
import { decidePenalty, type PenaltyDecision } from "./turnPenalty";
import { awardFinalScore, finalReceipt, recoverFinalScore, type FinalScore } from "./finalScore";
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
type Board = Placements & { joints: Joint[] };
type TurnPlayer = { id: string; score: number; hand: TurnCard[] };
type Event =
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
  | { kind: "end"; turn: number; status?: TurnReport["status"]; analysis?: StructuralAnalysisResult; final?: FinalScore; issues?: IssueAssessment; penaltyDecision?: PenaltyDecision; repairPolicy?: RepairPolicy; correction?: CorrectionReceipt; reason?: string };

export type TurnReport = {
  turn: number;
  playerId: string;
  status: "stable" | "unstable" | "partial" | "unresolved";
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
  seed: number;
  turn: number;
  playerIndex: number;
  players: TurnPlayer[];
  decks: [TurnCard[], TurnCard[]];
  /** Private, replay-checked receipts. The opening draw is turn one's ordinary draw. */
  draws?: { turn: number; playerId: string; pieces: string[]; connectors: string[]; remaining: [number, number] }[];
  nextId: number;
  draft: Placements;
  board: Board;
  reports: TurnReport[];
  events: Event[];
  finished: boolean;
  finalScore?: FinalScore;
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

function createDecks(seed: number, catalogue: CatalogueId): TurnState["decks"] {
  if (catalogue === RELEASE_CATALOGUE) {
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

export function createTurnGame(seed = 1, catalogue: CatalogueId = LEGACY_CATALOGUE): TurnState {
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
  return draw({
    version: KIT_PLAYTEST.version,
    catalogue,
    seed,
    turn: 1,
    playerIndex: 0,
    players,
    decks: createDecks(seed, catalogue),
    nextId: 3,
    draft: emptyDraft(),
    board,
    reports: [],
    events: [],
    finished: false,
  });
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
  if (state.draft.members.length >= 1)
    return fail("One element may be played per turn.");
  const parents = state.board.members;
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
    { ...state.draft, members: [member] },
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
  if (state.draft.loads.length >= 1)
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
    { ...state.draft, loads: [load] },
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
  if (state.draft.connections.length >= 2)
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
  if (state.catalogue === RELEASE_CATALOGUE && draft.loads.length &&
      !loadTargets({...state, draft}).some(target => target.id === draft.loads[0].jointId))
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
  if (count > 4) return "The draft exceeds the turn's card allowances.";
  const boundary = state.events.length - count;
  if (boundary < 0 || (boundary > 0 && state.events[boundary-1].kind !== "end"))
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
  replay?: { final: unknown; issues: unknown; penaltyDecision: unknown; repairPolicy: unknown; correction: unknown },
  analysis?: StructuralAnalysisResult,
  /** Account of the turn to record and replay; a generic sentence for the status otherwise. */
  reason?: string,
): Transition {
  if (state.finished || expectedTurn !== state.turn)
    return fail("This turn has already ended.");
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
  // Old scored receipts did not record an assessment. Keep their historical
  // evidence scope while replaying. A new assessed event must reproduce it.
  const previous = state.reports.at(-1);
  const release = state.catalogue === RELEASE_CATALOGUE;
  if (release && (reason !== undefined || analysis !== undefined))
    return fail("Release turn evidence must come from the assessed structure.");
  if (release && replay && (!replay.issues || !replay.penaltyDecision || replay.repairPolicy !== REPAIR_POLICY))
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
  }, draft: emptyDraft() };
  const repairPolicy = replay ? replay.repairPolicy : penaltyDecision && REPAIR_POLICY;
  if (repairPolicy !== undefined && ((repairPolicy !== REPAIR_POLICY && repairPolicy !== LEGACY_REPAIR_POLICY) || !penaltyDecision))
    return fail("Unsupported or incomplete saved correction policy.");
  const repair = issues && repairPolicy ? correctTurnIssues(frozen, issues, state.turn, repairPolicy) : undefined;
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
  return { ok: true, state: finished ? committed : draw(committed) };
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
    raw.events.length > KIT_PLAYTEST.players * KIT_PLAYTEST.rounds * 5
  )
    return fail("Unrecognized match format or invalid replay header.");
  // Original version-one saves predate catalogue selection and keep their
  // deterministic five-family hands, including experimental cables.
  const catalogue = raw.catalogue === undefined ? LEGACY_CATALOGUE : raw.catalogue;
  if (catalogue !== LEGACY_CATALOGUE && !isScoredCatalogue(catalogue)) {
    return fail("Saved match requires an unsupported physical catalogue.");
  }
  let state = createTurnGame(raw.seed, catalogue);
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
  if (event.kind === "end" && typeof event.turn === "number") {
    if (event.status !== undefined && event.status !== "stable" && event.status !== "unstable" &&
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
