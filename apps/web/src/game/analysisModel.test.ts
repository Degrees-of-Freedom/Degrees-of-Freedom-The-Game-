import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createWasmSolver } from '../solver/wasm/wasmSolver';
import { sectionFor, toAnalysisModel } from './analysisModel';
import { exampleModel } from './examples';
import { LEVELS } from './levels';
import type { GameModel, LevelId } from './model';
import { summarizeAnalysis } from './structuralSummary';

const sandbox = LEVELS.sandbox;

/**
 * A column on a moment-connected base, a beam rigidly joined to its top, and
 * a cable from the beam tip back to the ground. Without the moment
 * connection at the base the column would be free to fall sideways.
 */
const frame: GameModel = {
  nextId: 4,
  members: [
    { id: 1, a: '0,0,0', b: '0,0,2', type: 'heb' },
    { id: 2, a: '0,0,2', b: '1,0,2', type: 'heb' },
    { id: 3, a: '1,0,2', b: '2,0,0', type: 'cable' },
  ],
  attrs: {
    '0,0,0': { found: true, joint: true },
    '2,0,0': { found: true },
    '0,0,2': { joint: true },
    '1,0,2': { load: 50 },
  },
};

describe('game model to detailed solver contract', () => {
  const { model, options, notes } = toAnalysisModel(frame, sandbox);

  it('converts card properties to SI, with strengths as capacities', () => {
    const shs = sectionFor('shs');
    expect(shs).toMatchObject({ E: 210e9, G: 81e9, A: 2.24e-3, Iy: 3.2e-6, shearAreaY: 1.12e-3 });
    // 355 MPa on the area and on the section modulus.
    expect(shs.capacity?.tension).toBeCloseTo(355e6 * 2.24e-3, 3);
    expect(shs.capacity?.momentY).toBeCloseTo(355e6 * 6.4e-5, 3);
    // The density reproduces the card's 0.176 kN/m self-weight.
    expect(shs.density! * shs.A * 9.81).toBeCloseTo(176, 6);
    expect(sectionFor('cable')).toMatchObject({ E: 160e9, A: 3.6e-4, capacity: { tension: 260e3 } });
    expect(sectionFor('cable').G).toBeUndefined();
  });

  it('sends only the sections in use, and places nodes on the 2 m grid', () => {
    expect(model.sections.map((section) => section.id)).toEqual(['cable', 'heb']);
    expect(model.nodes).toContainEqual({ id: '1,0,2', position: [2, 0, 4] });
    expect(model.nodes).toHaveLength(4);
  });

  it('pins beam ends in bending except at moment connections', () => {
    const [column, beam] = model.members;
    const pinned = ['rigid', 'rigid', 'rigid', 'rigid', 'free', 'free'];
    expect(column).toMatchObject({ kind: 'beam', sectionId: 'heb' });
    expect(column.start).toBeUndefined();
    expect(column.end).toBeUndefined();
    expect(beam.start).toBeUndefined();
    expect(beam.end).toEqual({ laws: pinned });
  });

  it('makes cables tension-only members with the card pretension', () => {
    const cable = model.members[2];
    expect(cable.kind).toBe('cable');
    // 25 kN on E A = 160 GPa x 360 mm².
    expect(cable.initialStrain! * 160e9 * 3.6e-4).toBeCloseTo(25e3, 6);
  });

  it('fixes foundations, applies placed loads downwards, and asks for self-weight', () => {
    expect(model.foundations).toEqual([
      { id: 'foundation:0,0,0', nodeId: '0,0,0', restrained: [true, true, true, true, true, true] },
      { id: 'foundation:2,0,0', nodeId: '2,0,0', restrained: [true, true, true, true, true, true] },
    ]);
    expect(model.loads).toEqual([{ id: 'load:1,0,2', nodeId: '1,0,2', force: [0, 0, -50_000] }]);
    expect(options).toEqual({ fidelity: 'nonlinear', gravity: [0, 0, -9.81] });
    expect(notes.join(' ')).toContain('Wind');
  });

  it('applies the level loads: tower payload on the top nodes, bridge traffic on the deck', () => {
    const tower = toAnalysisModel(exampleModel('tower1')!, LEVELS.tower1).model;
    const total = (loads: typeof tower.loads) => loads.reduce((sum, load) => sum - load.force![2], 0);
    expect(total(tower.loads)).toBeCloseTo(LEVELS.tower1.payload! * 1e3, 6);
    const top = Math.max(...tower.nodes.map((node) => node.position[2]));
    for (const load of tower.loads)
      expect(tower.nodes.find((node) => node.id === load.nodeId)!.position[2]).toBe(top);

    const level = LEVELS.bridge1;
    const bridge = toAnalysisModel(exampleModel('bridge1')!, level).model;
    expect(total(bridge.loads)).toBeCloseTo(level.traffic! * (level.cliffR! - level.cliffL!) * 2 * 1e3, 6);
  });
});

describe('detailed check of game models on the WebAssembly solver', () => {
  const solver = createWasmSolver(() => readFile(new URL('../solver/wasm/dof_solver.wasm', import.meta.url)));

  it('accepts the translation of every reference example and balances its loads', async () => {
    for (const id of ['tower1', 'bridge1', 'pickup1'] satisfies LevelId[]) {
      const { model, options } = toAnalysisModel(exampleModel(id)!, LEVELS[id]);
      const result = await solver.analyzeDetailed(model, options);
      expect(result.analysis.status, `${id}: ${JSON.stringify(result.analysis.diagnostics)}`).toBe('ok');
      expect(result.components.length).toBeGreaterThan(0);
      const summary = summarizeAnalysis(result);
      expect(['stable', 'marginal', 'unstable', 'unknown']).toContain(summary.verdict);
      for (const component of result.components) {
        if (!component.resultsValid) continue;
        // Verified reactions carry exactly the weight and load on that part.
        expect(component.reactionForce![2]).toBeCloseTo(-component.appliedForce[2], 0);
        expect(component.appliedForce[2]).toBeLessThan(0);
      }
    }
  });

  it('summarises a stable frame: reactions, utilisation and a cable that goes slack', async () => {
    const { model, options } = toAnalysisModel(frame, sandbox);
    const result = await solver.analyzeDetailed(model, options);
    const summary = summarizeAnalysis(result);
    expect(summary.verdict, JSON.stringify(result.components[0]?.reasonCodes)).toBe('stable');
    expect(summary).toMatchObject({ components: 1, failingComponents: 0, mechanisms: 0, slackCables: 1 });
    // The load pushes the beam tip towards the cable's anchor, so the cable
    // loses its pretension and carries nothing: it cannot push back.
    expect(result.members['3'].state).toBe('slack');
    expect(summary.governing!.utilization).toBeGreaterThan(0);
    expect(summary.maxDisplacement).toBeGreaterThan(0);
    // The column foundation carries the structure; the anchor of the slack
    // cable holds only half the cable's own weight.
    const [column, anchor] = summary.reactions;
    expect(column).toMatchObject({ nodeId: '0,0,0' });
    expect(column.vertical).toBeGreaterThan(0);
    expect(anchor.vertical).toBeGreaterThan(0);
    expect(anchor.vertical).toBeLessThan(0.1);
    const weight = -result.components[0].appliedForce[2] / 1e3;
    expect(column.vertical! + anchor.vertical!).toBeCloseTo(weight, 3);
    expect(weight).toBeGreaterThan(50);
  });

  it('reports an unsupported part without hiding the rest, and never shows zero for unknown', async () => {
    const floating: GameModel = {
      ...frame,
      nextId: 5,
      members: [...frame.members, { id: 4, a: '5,5,3', b: '6,5,3', type: 'glulam' }],
    };
    const { model, options } = toAnalysisModel(floating, sandbox);
    const summary = summarizeAnalysis(await solver.analyzeDetailed(model, options));
    expect(summary).toMatchObject({ verdict: 'unstable', components: 2, failingComponents: 1 });
    expect(summary.reasons).toContain('Part of the structure has no foundation.');
    // The supported frame keeps its verified reactions.
    expect(summary.reactions.every((reaction) => reaction.vertical !== null)).toBe(true);

    const unfounded = toAnalysisModel({ ...frame, attrs: { '1,0,2': { load: 50 } } }, sandbox);
    const lost = summarizeAnalysis(await solver.analyzeDetailed(unfounded.model, unfounded.options));
    expect(lost.verdict).toBe('unstable');
    expect(lost.maxDisplacement).toBeNull();
    expect(lost.governing).toBeNull();
  });

  it('summarises a rejected model and an empty one', async () => {
    const broken = toAnalysisModel(frame, sandbox);
    broken.model.members[0].sectionId = 'missing';
    const rejected = summarizeAnalysis(await solver.analyzeDetailed(broken.model, broken.options));
    expect(rejected.verdict).toBe('invalid');
    expect(rejected.message).toContain('missing');
    const empty = toAnalysisModel({ nextId: 1, members: [], attrs: {} }, sandbox);
    expect(summarizeAnalysis(await solver.analyzeDetailed(empty.model, empty.options)).verdict).toBe('empty');
  });
});
