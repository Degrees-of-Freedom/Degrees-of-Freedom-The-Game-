/// <reference types="node" />
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseStructureLibrary } from './structureLibrary';
import { allNodeKeys, parseNodeKey } from './model';
import { LEVELS } from './levels';
import { analyzeGame } from './analysis';
import { toStructuralModel } from './structuralModel';
import { useGameStore } from './store';

const directory = new URL('../../public/structures/', import.meta.url);
const catalogText = readFileSync(new URL('catalog.json', directory), 'utf8');
// Hash semantic JSON so Git's Windows newline conversion cannot invalidate it.
const catalogHash = createHash('sha256').update(JSON.stringify(JSON.parse(catalogText))).digest('hex');
const records = parseStructureLibrary(JSON.parse(catalogText));
const baselineFile = new URL('voxel-baseline.json', directory);
const update = process.env.UPDATE_STRUCTURE_BASELINE === '1';
type Measurement = { id: string; scope: string; mechanism: boolean; floating: number; error: string | null; combinations: number; failedCombinations: number; maxDisplacementMetres: number | null; maxUtilization: number | null };
const measurements: Measurement[] = [];
const reference: Measurement[] = update ? [] : JSON.parse(readFileSync(baselineFile, 'utf8')).measurements;

describe('structure library', () => {
  it('ships 20 consistent, bounded, distinct records with real PNG assets', () => {
    expect(records).toHaveLength(20);
    if (!update) expect(JSON.parse(readFileSync(baselineFile, 'utf8')).catalogSha256).toBe(catalogHash);
    expect(new Set(records.map(r => JSON.stringify(r.save.model))).size).toBe(20);
    for (const record of records) {
      const model = record.save.model;
      expect(model.members).toHaveLength(record.memberCount);
      expect(allNodeKeys(model)).toHaveLength(record.nodeCount);
      const edges = model.members.map(m => [m.a, m.b].sort().join('|'));
      expect(new Set(edges).size).toBe(edges.length);
      for (const key of allNodeKeys(model)) {
        const p = parseNodeKey(key);
        p.forEach((v, i) => expect(v).toBeLessThanOrEqual([16, 16, 14][i]));
      }
      expect(JSON.parse(readFileSync(new URL(`records/${record.id}.json`, directory), 'utf8'))).toEqual(record);
      expect(readFileSync(new URL(record.preview, directory)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const contract = toStructuralModel(model).model;
      expect(contract.members).toHaveLength(record.memberCount);
      expect(contract.nodes).toHaveLength(record.nodeCount);
    }
  });
  it('rejects malformed versions, duplicate IDs and invalid model endpoints', () => {
    const value = JSON.parse(catalogText);
    expect(() => parseStructureLibrary({ ...value, version: 2 })).toThrow();
    expect(() => parseStructureLibrary({ ...value, records: [value.records[0], value.records[0]] })).toThrow();
    value.records[0].save.model.members[0].a = '-1,0,0';
    expect(() => parseStructureLibrary(value)).toThrow();
  });
  it('loads detached models in a separate workspace with undoable cycling', () => {
    useGameStore.getState().setLevel('sandbox');
    useGameStore.getState().loadLibraryModel(records[0].save.model);
    expect(useGameStore.getState().levelId).toBe('library');
    expect(useGameStore.getState().model).not.toBe(records[0].save.model);
    useGameStore.getState().loadLibraryModel(records[1].save.model);
    useGameStore.getState().undo();
    expect(useGameStore.getState().model).toEqual(records[0].save.model);
  });
  it('leaves a shared-table game intact when opening the library', () => {
    useGameStore.getState().setMode('multiplayer');
    const turn = useGameStore.getState().turn;
    useGameStore.getState().loadLibraryModel(records[0].save.model);
    expect(useGameStore.getState().mode).toBe('challenge');
    expect(useGameStore.getState().levelId).toBe('library');
    expect(useGameStore.getState().turn).toBe(turn);
    useGameStore.getState().setMode('multiplayer');
    expect(useGameStore.getState().turn).toBe(turn);
    useGameStore.getState().setMode('challenge');
  });
  for (const record of records) it(`analyzes ${record.id} against the observed voxel baseline`, () => {
    const result = analyzeGame(record.save.model, LEVELS.library);
    const maxD = result.combos.flatMap(c => c.maxD === undefined ? [] : [c.maxD]);
    for (const n of maxD) expect(Number.isFinite(n)).toBe(true);
    const measurement: Measurement = {
      id: record.id, scope: result.error || result.mechanism ? 'unavailable' : result.floating.length ? 'supported-component-only' : 'whole-model',
      mechanism: result.mechanism, floating: result.floating.length,
      error: result.error ?? null, combinations: result.combos.length,
      failedCombinations: result.combos.filter(c => c.fail).length,
      maxDisplacementMetres: !result.mechanism && !result.error && maxD.length ? Math.max(...maxD) : null,
      maxUtilization: result.mechanism || result.error ? null : result.maxU ?? null,
    };
    measurements.push(measurement);
    if (record.expectation.stability === 'stable') {
      expect(result.error).toBeUndefined();
      expect(result.mechanism).toBe(false);
      expect(result.floating).toHaveLength(0);
    }
    if (record.expectation.stability === 'mechanism') expect(result.mechanism).toBe(true);
    if (record.expectation.stability === 'floating') expect(result.floating.length).toBeGreaterThan(0);
    if (record.expectation.stability === 'unsupported') expect(result.error).toContain('No foundation');
    if (!update) {
      const expected = reference.find(r => r.id === record.id)!;
      expect(expected).toBeDefined();
      for (const key of ['maxDisplacementMetres', 'maxUtilization'] as const) {
        const actual = measurement[key], target = expected[key];
        if (actual === null || target === null) expect(actual).toBe(target);
        else expect(Math.abs(actual - target)).toBeLessThanOrEqual(1e-9 + Math.abs(target) * 1e-6);
      }
      expect({ ...measurement, maxDisplacementMetres: null, maxUtilization: null }).toEqual({ ...expected, maxDisplacementMetres: null, maxUtilization: null });
    }
  }, 30000);
  it('records baseline provenance only when explicitly requested', () => {
    if (!update) return;
    const solver = new URL('../solver/', import.meta.url);
    const hash = createHash('sha256');
    for (const name of readdirSync(solver).filter(n => n.endsWith('.ts') && !n.endsWith('.test.ts')).sort()) hash.update(name).update(readFileSync(new URL(name, solver), 'utf8').replace(/\r\n/g, '\n'));
    writeFileSync(baselineFile, JSON.stringify({
      format: 'dof-observed-voxel-baseline', version: 1,
      disclaimer: 'Observed regression baseline, not an independent numerical oracle or OpenSees result. Timing deliberately excluded.',
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      solverSourceSha256: hash.digest('hex'), catalogSha256: catalogHash,
      relativeTolerance: 1e-6, absoluteTolerance: 1e-9, measurements,
    }, null, 2) + '\n');
  });
});
