import { describe, expect, it } from 'vitest';
import type { GameModel } from '../../game/model';
import type { Combo, Context, Element, StructureEvaluation } from '../../evaluator/results';
import { ITEMS } from '../../evaluator/sections';
import { adaptBaselineGame } from './baselineAdapter';
import type { BaselineAdapterOptions, BaselineAnalysisScope } from './baselineAdapter';
import { buildPrimaryFlow } from './flow';

function modelFixture(): GameModel {
  return {
    members: [{ id: 1, a: '0,0,0', b: '0,0,2', type: 'shs' }],
    attrs: { '0,0,0': { found: true, locked: true }, '0,0,2': { load: 8 } },
    nextId: 2,
  };
}

const optionsFixture = (): BaselineAdapterOptions => ({
  revision: 'revision-8', standardMemberType: 'shs',
  defaultMemberMetadata: { owner: 'P1', cardId: 'member-7', maxLength: 7 },
});

function analysisFixture(model = modelFixture()): BaselineAnalysisScope {
  const member = model.members[0];
  const element: Element = {
    m: { ...member }, it: ITEMS[member.type], L: 4,
    R: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], ex: [0, 0, 1],
    a: 0, b: 1, cable: member.type === 'cable',
    rigidA: true, rigidB: true,
  };
  const force = new Float64Array(12);
  force[0] = -2;
  force[6] = 2;
  force[5] = 12;
  const load = new Float64Array(12);
  load[8] = -8;
  const combo: Combo = {
    combo: { name: 'selected load', short: 'Q', type: 'SLS', dir: [0, 0, 0] },
    F: load, vis: [{ a: 1, v: [0, 0, -8], kind: 'Q' }],
    ef: new Map([[element, { f: force, ul: new Float64Array(12) }]]),
    active: new Map([[element, true]]),
    reac: { 0: new Float64Array([0, 0, 8, 0, 0, 0]) },
  };
  const ctx: Context = {
    keys: [member.a, member.b], pos: [[0, 0, 0], [0, 0, 4]], act: [0, 1],
    NA: 2, els: [element],
    isF: [true, false], idx: new Map([[member.a, 0], [member.b, 1]]), aid: new Int32Array([0, 1]),
  };
  const result: StructureEvaluation = {
    mechanism: false, floating: [], unstable: new Set(), objectives: [],
    members: {}, found: {}, combos: [combo], nodes: {}, ctx,
  };
  return {
    result, analyzedRevision: 'revision-8', checkpointId: 'checkpoint-3',
    checkpointTurn: 3, comboIndex: 0, valid: true,
  };
}

describe('explicit prototype-to-multiplayer view adapter', () => {
  it('maps one selected solid family and cables without inventing other current cards', () => {
    const model = modelFixture();
    model.members.push(
      { id: 2, a: '0,0,2', b: '1,0,3', type: 'cable' },
      { id: 3, a: '0,0,2', b: '2,0,2', type: 'ipe' },
    );
    const { view, diagnostics } = adaptBaselineGame(model, optionsFixture());
    expect(view.board).toEqual({ width: 15, depth: 15, height: 15 });
    expect(view.metresPerUnit).toBe(2);
    expect(view.members.map(member => member.family)).toEqual(['member', 'cable']);
    expect(view.members[0]).toMatchObject({
      id: '1', owner: 'P1', cardId: 'member-7', maxLength: 7,
      start: [0, 0, 0], end: [0, 0, 2], phase: 'committed',
    });
    expect(view.members[0].quarterPorts.map(port => port.position)).toEqual([[0, 0, 0.5], [0, 0, 1], [0, 0, 1.5]]);
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-family', memberId: '3' })]);
    expect(view.checkpoint).toBeUndefined();
  });

  it('requires explicitly supplied owner, card identity and printed tier', () => {
    const options = optionsFixture();
    const { view, diagnostics } = adaptBaselineGame(modelFixture(), { ...options, defaultMemberMetadata: undefined });
    expect(view.members).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ code: 'missing-metadata', memberId: '1' });
    expect(adaptBaselineGame(modelFixture(), {
      ...options, memberMetadata: { 1: { owner: 'P2', cardId: 'authored-card', maxLength: 5, phase: 'draft' } },
    }).view.members[0]).toMatchObject({ owner: 'P2', cardId: 'authored-card', maxLength: 5, phase: 'draft' });
  });

  it('does not reinterpret legacy joint flags or support reactions as authored rotational masks', () => {
    const model = modelFixture();
    model.attrs['0,0,2'].joint = true;
    model.attrs['0,0,0'].restraint = [true, true, true, true, true, true];
    const unknown = adaptBaselineGame(model, optionsFixture());
    expect(unknown.view.members[0].rotations).toEqual([null, null]);
    expect(unknown.diagnostics[0].code).toBe('legacy-connection-unmapped');
    const supplied = adaptBaselineGame(model, {
      ...optionsFixture(), rotationMasksByNode: { '0,0,2': [true, false, true] },
      foundationOwnersByNode: { '0,0,0': 'P1' },
      memberMetadata: { 1: { owner: 'P1', cardId: 'setup', maxLength: 5, setupLocked: true } },
    });
    expect(supplied.view.members[0]).toMatchObject({ setupLocked: true, rotations: [null, [true, false, true]] });
    expect(supplied.view.joints.find(joint => joint.id === '0,0,0')).toMatchObject({
      foundationOwner: 'P1', setupLocked: true, rotations: null,
    });
  });

  it('rejects malformed or coincident spans and validates public scalar configuration', () => {
    const model = modelFixture();
    model.members.push(
      { id: 2, a: 'NaN,0,0', b: '0,0,2', type: 'shs' },
      { id: 3, a: ',0,0', b: '0,0,2', type: 'shs' },
      { id: 4, a: '0,0,0', b: '0,0,0', type: 'shs' },
    );
    const adapted = adaptBaselineGame(model, optionsFixture());
    expect(adapted.view.members).toHaveLength(1);
    expect(adapted.diagnostics).toHaveLength(3);
    expect(adapted.diagnostics.every(diagnostic => diagnostic.code === 'invalid-model')).toBe(true);
    expect(() => adaptBaselineGame(model, { ...optionsFixture(), revision: '' })).toThrow(/revision/);
    expect(() => adaptBaselineGame(model, { ...optionsFixture(), boardHeight: Infinity })).toThrow(/height/);
  });

  it('converts simultaneous kN end actions to N while keeping moment transfer and original endpoint order', () => {
    const model = modelFixture();
    const analysis = analysisFixture(model);
    const element = analysis.result.ctx!.els[0];
    element.m.a = model.members[0].b;
    element.m.b = model.members[0].a;
    const { view, diagnostics } = adaptBaselineGame(model, { ...optionsFixture(), analysis });
    expect(diagnostics).toEqual([]);
    expect(view.checkpoint).toMatchObject({
      valid: true, modelRevision: 'revision-8', forceUnit: 'N',
      sources: ['0,0,2'], supports: ['0,0,0'],
      segments: [{ id: '1:baseline', memberId: '1', a: '0,0,2', b: '0,0,0', axial: 2000, magnitude: 3000, valid: true }],
    });
    expect(view.checkpoint?.provenance).toMatch(/Experimental.*unverified/);
    const flow = buildPrimaryFlow({
      modelRevision: view.revision, checkpoint: view.checkpoint,
      segments: view.checkpoint!.segments, sources: view.checkpoint!.sources, supports: view.checkpoint!.supports,
    });
    expect(flow.segments[0]).toMatchObject({ direction: 1, style: 'tension', from: '0,0,2', to: '0,0,0' });
  });

  it('does not suppress a valid pure-bending path merely because axial force is zero', () => {
    const analysis = analysisFixture();
    const combo = analysis.result.combos[0];
    const element = analysis.result.ctx!.els[0];
    const f = combo.ef!.get(element)!.f;
    f[0] = 0;
    f[6] = 0;
    const { view } = adaptBaselineGame(modelFixture(), { ...optionsFixture(), analysis });
    expect(view.checkpoint?.segments[0]).toMatchObject({ axial: 0, magnitude: 3000, valid: true });
  });

  it('keeps exact historical revision so stale results never animate as current', () => {
    const analysis = analysisFixture();
    const { view } = adaptBaselineGame(modelFixture(), { ...optionsFixture(), revision: 'revision-9', analysis });
    const checkpoint = view.checkpoint!;
    expect(checkpoint.modelRevision).toBe('revision-8');
    expect(buildPrimaryFlow({
      modelRevision: view.revision, checkpoint, segments: checkpoint.segments,
      sources: checkpoint.sources, supports: checkpoint.supports,
    })).toMatchObject({ status: 'stale', segments: [expect.objectContaining({ direction: 0, reason: 'stale' })] });
  });

  it('marks failed, omitted and incomplete result scopes unavailable instead of borrowing envelope values', () => {
    const analysis = analysisFixture();
    analysis.result.combos[0].ef?.clear();
    const unknown = adaptBaselineGame(modelFixture(), { ...optionsFixture(), analysis });
    expect(unknown.view.checkpoint).toMatchObject({ valid: false, segments: [{ magnitude: 0, valid: false }] });
    const missingCombo = adaptBaselineGame(modelFixture(), {
      ...optionsFixture(), analysis: { ...analysis, comboIndex: 8 },
    });
    expect(missingCombo.view.checkpoint).toMatchObject({ valid: false, segments: [] });
    expect(missingCombo.diagnostics.some(diagnostic => diagnostic.code === 'analysis-unavailable')).toBe(true);
    const omitted = adaptBaselineGame(modelFixture(), {
      ...optionsFixture(), analysis: analysisFixture(), defaultMemberMetadata: undefined,
    });
    expect(omitted.view.checkpoint?.valid).toBe(false);
    expect(omitted.diagnostics.some(diagnostic => diagnostic.code === 'analysis-scope-mismatch')).toBe(true);
  });

  it('separates slack cables and diagnostic cable compression from playable load transfer', () => {
    const model = modelFixture();
    model.members[0].type = 'cable';
    const analysis = analysisFixture(model);
    const element = analysis.result.ctx!.els[0];
    const combo = analysis.result.combos[0];
    combo.active?.set(element, false);
    const slack = adaptBaselineGame(model, { ...optionsFixture(), analysis });
    expect(slack.view.checkpoint?.segments[0].slack).toBe(true);
    combo.active?.set(element, true);
    combo.ef!.get(element)!.f[6] = -2;
    const compression = adaptBaselineGame(model, { ...optionsFixture(), analysis });
    expect(compression.view.checkpoint).toMatchObject({ valid: false, segments: [{ axial: -2000, valid: false }] });
    expect(compression.diagnostics.some(diagnostic => diagnostic.code === 'cable-compression')).toBe(true);
  });

  it('retains source/support conflicts as ambiguity and honors an explicit selected scope', () => {
    const analysis = analysisFixture();
    analysis.result.combos[0].F[2] = -0.1; // Actual equivalent self-weight at a support.
    const { view } = adaptBaselineGame(modelFixture(), { ...optionsFixture(), analysis });
    const checkpoint = view.checkpoint!;
    expect(checkpoint.sources).toEqual(['0,0,0', '0,0,2']);
    expect(buildPrimaryFlow({
      modelRevision: view.revision, checkpoint, segments: checkpoint.segments,
      sources: checkpoint.sources, supports: checkpoint.supports,
    }).segments[0]).toMatchObject({ direction: 0, reason: 'ambiguous' });
    const selected = adaptBaselineGame(modelFixture(), {
      ...optionsFixture(), analysis: { ...analysis, sourceNodeIds: ['0,0,2'], supportNodeIds: ['0,0,0'] },
    });
    expect(selected.view.checkpoint?.sources).toEqual(['0,0,2']);
  });

  it('does not mutate prototype input/results or alias caller-owned mask and metadata arrays', () => {
    const model = modelFixture();
    const analysis = analysisFixture(model);
    const original = JSON.stringify(model);
    const originalForces = [...analysis.result.combos[0].ef!.values()].map(force => [...force.f]);
    const masks: Record<string, [boolean, boolean, boolean]> = { '0,0,0': [true, true, true] };
    const metadata = { owner: 'P1', cardId: 'draft', maxLength: 5 as const, section: { width: 0.2, depth: 0.3, unit: 'game units' as const } };
    const { view } = adaptBaselineGame(model, { ...optionsFixture(), defaultMemberMetadata: metadata, rotationMasksByNode: masks, analysis });
    masks['0,0,0'][0] = false;
    metadata.section.width = 4;
    expect(view.members[0].rotations[0]).toEqual([true, true, true]);
    expect(view.members[0].section?.width).toBe(0.2);
    expect(JSON.stringify(model)).toBe(original);
    expect([...analysis.result.combos[0].ef!.values()].map(force => [...force.f])).toEqual(originalForces);
  });
});
