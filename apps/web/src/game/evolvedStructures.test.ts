/// <reference types="node" />
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readGameSave } from './structuralState';
import { allNodeKeys, parseNodeKey } from './model';
import { LEVELS } from './levels';
import { analyzeGame } from './analysis';

/**
 * Cross-checks `tools/structure-gan` output against the game's own loader and solver.
 *
 * The generator keeps a structure only if the OpenSees reference engine finds it
 * stable. This suite is the independent half of that bargain: every stored record
 * must be a valid `dof-voxel-save` the game can load, fit its grid, and be free of
 * mechanisms, floating bodies, unresolved buckling and solver errors in the game's
 * structure evaluation (the Rust solver since 2026-11-15).
 * The game's own maximum utilisation must also be at most 1; the generator's
 * stricter limit (see `physics.py`) is calibrated so this holds.
 */
const databaseUrl = new URL('../../public/structures/evolved.sqlite', import.meta.url);
const rows = existsSync(databaseUrl)
  ? (new DatabaseSync(databaseUrl.pathname, { readOnly: true })
      .prepare('SELECT id, member_count, node_count, save_json FROM evolved_structures ORDER BY id')
      .all() as { id: string; member_count: number; node_count: number; save_json: string }[])
  : [];

describe('evolved structure database', () => {
  it('is present and non-empty', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
  });
  for (const row of rows) it(`loads and analyses ${row.id}`, async () => {
    const { save } = readGameSave(JSON.parse(row.save_json), 'library');
    const model = save.model;
    expect(model.members).toHaveLength(row.member_count);
    expect(allNodeKeys(model)).toHaveLength(row.node_count);
    for (const key of allNodeKeys(model)) {
      parseNodeKey(key).forEach((v, i) => expect(v).toBeLessThanOrEqual([16, 16, 14][i]));
    }
    const result = await analyzeGame(model, LEVELS.library);
    expect(result.unresolved, result.unresolvedReason).toBeFalsy();
    expect(result.error).toBeUndefined();
    expect(result.mechanism).toBe(false);
    expect(result.floating).toHaveLength(0);
    expect(result.maxU).toBeLessThanOrEqual(1);
  }, 30000);
});
