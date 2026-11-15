import { CELL_SIZE } from '../../game/model';
import type { GameModel, MemberType } from '../../game/model';
import type { Combo, Context, StructureEvaluation } from '../../evaluator/results';
import type { FlowSegmentEvidence } from './flow';
import type {
  CheckpointView, JointView, MaximumLength, MemberView, MultiplayerViewData,
  RotationMask, Vec3,
} from './types';
import { quarterPorts } from './viewModel';

/** Authored current-rule identity cannot be recovered from the prototype model. */
export interface BaselineMemberMetadata {
  readonly owner: string;
  readonly cardId: string;
  readonly maxLength: MaximumLength;
  readonly phase?: MemberView['phase'];
  readonly setupLocked?: boolean;
  readonly section?: MemberView['section'];
}

export interface BaselineAnalysisScope {
  readonly result: StructureEvaluation;
  /** Exact revision that was analyzed, including when displaying historical results. */
  readonly analyzedRevision: string;
  readonly checkpointId: string;
  readonly checkpointTurn: number;
  readonly comboIndex: number;
  /** Caller acceptance of this experimental result; this never means verified. */
  readonly valid: boolean;
  /** Only provide overrides for a documented selected-load scope of this combo. */
  readonly sourceNodeIds?: readonly string[];
  readonly supportNodeIds?: readonly string[];
}

export interface BaselineAdapterOptions {
  readonly revision: string;
  /** Choose ONE legacy solid family to represent the new standard member. */
  readonly standardMemberType: Exclude<MemberType, 'cable'>;
  readonly memberMetadata?: Readonly<Record<number, BaselineMemberMetadata>>;
  /** Explicit caller-supplied identity for members without an individual entry. */
  readonly defaultMemberMetadata?: BaselineMemberMetadata;
  readonly rotationMasksByNode?: Readonly<Record<string, RotationMask>>;
  readonly foundationOwnersByNode?: Readonly<Record<string, string>>;
  readonly boardHeight?: number;
  readonly analysis?: BaselineAnalysisScope;
}

export interface BaselineAdapterDiagnostic {
  readonly code: 'unsupported-family' | 'missing-metadata' | 'invalid-model'
    | 'legacy-connection-unmapped' | 'analysis-unavailable' | 'analysis-scope-mismatch'
    | 'cable-compression';
  readonly message: string;
  readonly memberId?: string;
}

export interface BaselineAdapterResult {
  readonly view: MultiplayerViewData;
  readonly diagnostics: readonly BaselineAdapterDiagnostic[];
}

const FORCE_SCALE = 1000; // Prototype kN -> displayed N; kNm / metres -> kN.
const NONZERO = 1e-10;

function readPosition(key: string): Vec3 | null {
  const parts = key.split(',');
  if (parts.length !== 3 || parts.some(part => part.trim() === '')) return null;
  const values = parts.map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [values[0], values[1], values[2]];
}

function copyMask(mask: RotationMask | undefined): RotationMask | null {
  return mask?.length === 3 && mask.every(value => typeof value === 'boolean')
    ? [mask[0], mask[1], mask[2]] : null;
}

function metadataValid(metadata: BaselineMemberMetadata): boolean {
  return typeof metadata.owner === 'string' && metadata.owner.trim().length > 0
    && typeof metadata.cardId === 'string' && metadata.cardId.trim().length > 0
    && [5, 7, 10].includes(metadata.maxLength)
    && (metadata.phase === undefined || metadata.phase === 'draft' || metadata.phase === 'committed')
    && (!metadata.section || (metadata.section.unit === 'game units'
      && Number.isFinite(metadata.section.width) && metadata.section.width > 0
      && Number.isFinite(metadata.section.depth) && metadata.section.depth > 0));
}

function activeNode(ctx: Context, active: number): string | undefined {
  if (!Number.isInteger(active) || active < 0 || active >= ctx.act.length) return undefined;
  return ctx.keys[ctx.act[active]];
}

function loadSources(combo: Combo, ctx: Context): string[] {
  const sources: string[] = [];
  for (let active = 0; active < ctx.act.length; active++) {
    const force = combo.F.subarray(active * 6, active * 6 + 3);
    const key = activeNode(ctx, active);
    if (key && force.length === 3 && [...force].every(Number.isFinite)
      && Math.hypot(...force) > NONZERO) sources.push(key);
  }
  return sources;
}

function receivingSupports(combo: Combo, ctx: Context): string[] {
  return Object.entries(combo.reac ?? {}).flatMap(([active, reaction]) => {
    const key = activeNode(ctx, Number(active));
    return key && reaction.length >= 6 && [...reaction].every(Number.isFinite)
      && reaction.some(value => Math.abs(value) > NONZERO) ? [key] : [];
  });
}

function checkpointView(
  scope: BaselineAnalysisScope,
  members: readonly MemberView[],
  model: GameModel,
  jointIds: ReadonlySet<string>,
  diagnostics: BaselineAdapterDiagnostic[],
): CheckpointView {
  const { result, comboIndex } = scope;
  const combo = Number.isInteger(comboIndex) ? result.combos[comboIndex] : undefined;
  const ctx = result.ctx;
  let valid = scope.valid && scope.analyzedRevision.trim().length > 0
    && scope.checkpointId.trim().length > 0 && Number.isInteger(scope.checkpointTurn)
    && scope.checkpointTurn >= 0 && !result.error && !result.mechanism
    && !!combo && !combo.fail && !!ctx && !!combo.ef;
  if (!valid) diagnostics.push({
    code: 'analysis-unavailable',
    message: 'The selected experimental checkpoint is unavailable, rejected, or incomplete; no current flow is claimed.',
  });
  const memberMap = new Map(members.map(member => [member.id, member]));
  const segments: FlowSegmentEvidence[] = [];
  if (combo && ctx) {
    if (members.length !== model.members.length) {
      valid = false;
      diagnostics.push({ code: 'analysis-scope-mismatch', message: 'The view omits legacy members; the full result network cannot be represented as a current load path.' });
    }
    for (const element of ctx.els) {
      const memberId = String(element.m.id);
      const member = memberMap.get(memberId);
      if (!member) continue;
      const original = model.members.find(candidate => candidate.id === element.m.id);
      const sameEndpoints = (element.m.a === member.startNode && element.m.b === member.endNode)
        || (element.m.a === member.endNode && element.m.b === member.startNode);
      if (!sameEndpoints || !original || element.m.type !== original.type) {
        valid = false;
        diagnostics.push({ code: 'analysis-scope-mismatch', memberId, message: `Result member ${memberId} does not match this view's intentional connectivity and family.` });
        continue;
      }
      const force = combo.ef?.get(element);
      const f = force?.f;
      const known = !!f && f.length === 12 && [...f].every(Number.isFinite)
        && Number.isFinite(element.L) && element.L > 0;
      const axial = known ? f[6] * FORCE_SCALE : undefined;
      const compressedCable = member.family === 'cable' && axial !== undefined && axial < -NONZERO;
      if (!known || compressedCable) valid = false;
      if (compressedCable) diagnostics.push({ code: 'cable-compression', memberId, message: `Cable ${memberId} has a diagnostic compression result; it is not a valid tension-only load path.` });
      if (!known) diagnostics.push({ code: 'analysis-unavailable', memberId, message: `Member ${memberId} has no finite simultaneous end-force result in the selected combination.` });
      /*
       * Force-equivalent action retains shear and pure moment transfer. This is
       * max(end force norm, end moment norm / reference length), NOT an axial
       * force, stress or unique physical attribution. All terms become N.
       * f[6] is the prototype's positive-tension axial convention; endpoint order
       * stays exactly element.m.a -> element.m.b and never follows axial sign.
       */
      const magnitude = known ? Math.max(
        Math.hypot(f[0], f[1], f[2]), Math.hypot(f[6], f[7], f[8]),
        Math.hypot(f[3], f[4], f[5]) / element.L,
        Math.hypot(f[9], f[10], f[11]) / element.L,
      ) * FORCE_SCALE : 0;
      segments.push({
        id: `${memberId}:baseline`, memberId, a: element.m.a, b: element.m.b,
        magnitude, axial, valid: known && !compressedCable,
        slack: !!force?.slack || (member.family === 'cable' && combo.active?.get(element) === false),
      });
    }
    if (segments.length !== members.length) valid = false;
  }
  const sources = scope.sourceNodeIds ?? (combo && ctx ? loadSources(combo, ctx) : []);
  const supports = scope.supportNodeIds ?? (combo && ctx ? receivingSupports(combo, ctx) : []);
  const filterNodes = (ids: readonly string[]): string[] => [...new Set(ids)].filter(id => jointIds.has(id));
  if ([...sources, ...supports].some(id => !jointIds.has(id))) {
    valid = false;
    diagnostics.push({ code: 'analysis-scope-mismatch', message: 'The selected result boundaries contain nodes absent from this view.' });
  }
  return {
    id: scope.checkpointId, modelRevision: scope.analyzedRevision,
    turn: scope.checkpointTurn, valid,
    provenance: `Experimental voxel baseline (unverified)${combo ? ` · ${combo.combo.name}` : ''}`,
    forceUnit: 'N', segments, sources: filterNodes(sources), supports: filterNodes(supports),
  };
}

/**
 * Pure, explicit migration/view adapter. It never solves, reads a store, invents
 * authored card/owner/tier metadata, or silently maps all old families to one.
 * Positions remain game lattice units: one unit = CELL_SIZE metres (currently 2).
 * The baseline has no spring cards and cannot author current rotation masks.
 *
 * Default source scope is nonzero selected-combo translational F, including
 * equivalent self-weight loads. A loaded support is intentionally BOTH a source
 * and sink, leaving that path ambiguous. Callers may provide a documented
 * selected-load scope, but must not remove branches merely to manufacture flow.
 */
export function adaptBaselineGame(model: GameModel, options: BaselineAdapterOptions): BaselineAdapterResult {
  if (!options.revision.trim()) throw new RangeError('A nonempty current model revision is required.');
  if (!['shs', 'glulam', 'ipe', 'heb'].includes(options.standardMemberType)) {
    throw new RangeError('Explicitly select one legacy solid family as the standard member.');
  }
  const height = options.boardHeight ?? 15;
  if (!Number.isFinite(height) || height <= 0) throw new RangeError('Board height must be positive and finite.');
  const diagnostics: BaselineAdapterDiagnostic[] = [];
  const members: MemberView[] = [];
  const positions = new Map<string, Vec3>();
  const seenMembers = new Set<number>();
  for (const member of model.members) {
    const id = String(member.id);
    if (!Number.isSafeInteger(member.id) || seenMembers.has(member.id)) {
      diagnostics.push({ code: 'invalid-model', memberId: id, message: `Member ${id} needs a unique safe integer identity.` });
      continue;
    }
    seenMembers.add(member.id);
    if (member.type !== options.standardMemberType && member.type !== 'cable') {
      diagnostics.push({ code: 'unsupported-family', memberId: id, message: `Legacy ${member.type} member ${id} is not the explicitly selected current standard family.` });
      continue;
    }
    const metadata = options.memberMetadata?.[member.id] ?? options.defaultMemberMetadata;
    if (!metadata || !metadataValid(metadata)) {
      diagnostics.push({ code: 'missing-metadata', memberId: id, message: `Member ${id} needs explicit owner, card identity, and printed maximum (5, 7 or 10).` });
      continue;
    }
    const start = readPosition(member.a);
    const end = readPosition(member.b);
    if (!start || !end || Math.hypot(...end.map((value, axis) => value - start[axis])) <= NONZERO) {
      diagnostics.push({ code: 'invalid-model', memberId: id, message: `Member ${id} has invalid or coincident endpoints.` });
      continue;
    }
    positions.set(member.a, start);
    positions.set(member.b, end);
    members.push({
      id, cardId: metadata.cardId, owner: metadata.owner,
      family: member.type === 'cable' ? 'cable' : 'member',
      startNode: member.a, endNode: member.b, start, end,
      maxLength: metadata.maxLength, phase: metadata.phase ?? 'committed',
      setupLocked: metadata.setupLocked,
      rotations: [copyMask(options.rotationMasksByNode?.[member.a]), copyMask(options.rotationMasksByNode?.[member.b])],
      quarterPorts: quarterPorts(id, start, end),
      section: metadata.section ? { ...metadata.section } : undefined,
    });
  }
  for (const [key, attrs] of Object.entries(model.attrs)) {
    if (!attrs.found && !attrs.joint && !attrs.load && !attrs.locked) continue;
    const position = readPosition(key);
    if (position) positions.set(key, position);
    else diagnostics.push({ code: 'invalid-model', message: `Node ${key} has invalid coordinates.` });
    if (attrs.joint && !options.rotationMasksByNode?.[key]) diagnostics.push({
      code: 'legacy-connection-unmapped', message: `Legacy joint ${key} has no authored current-rule rotation mask; its freedoms remain unknown.`,
    });
  }
  const joints: JointView[] = [...positions].map(([id, position]) => ({
    id, position, rotations: copyMask(options.rotationMasksByNode?.[id]),
    setupLocked: model.attrs[id]?.locked,
    foundationOwner: model.attrs[id]?.found ? options.foundationOwnersByNode?.[id] : undefined,
  }));
  return {
    view: {
      revision: options.revision, board: { width: 15, depth: 15, height },
      metresPerUnit: CELL_SIZE, members, joints,
      checkpoint: options.analysis
        ? checkpointView(options.analysis, members, model, new Set(positions.keys()), diagnostics) : undefined,
    },
    diagnostics,
  };
}
