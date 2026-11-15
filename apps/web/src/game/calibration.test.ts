/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGameSave } from './structuralState';
import { LEVELS } from './levels';
import { analyzeGame } from './analysis';

/**
 * Harness for `tools/structure-gan` calibration (see `calibration.py`). Skipped unless
 * `DOF_CALIBRATION_IN` names a JSON export of game saves; writes the game's verdicts,
 * in the same order, to `DOF_CALIBRATION_OUT`.
 */
const input = process.env.DOF_CALIBRATION_IN;
const output = process.env.DOF_CALIBRATION_OUT;

describe.skipIf(!input || !output)('structure-gan calibration', () => {
  it('re-analyses exported structures with the game solver', () => {
    const items = JSON.parse(readFileSync(input!, 'utf8')) as { save: unknown }[];
    const rows = items.map(item => {
      const { save } = readGameSave(item.save, 'library');
      const result = analyzeGame(save.model, LEVELS.library);
      return {
        mechanism: result.mechanism, floating: result.floating.length,
        error: result.error ?? null, maxU: result.maxU ?? null,
        // Which part of the game's design check governs; see voxelDesignChecks.ts.
        connMax: result.connMax ?? null, foundMax: result.foundMax ?? null, failing: result.failing ?? null,
      };
    });
    writeFileSync(output!, JSON.stringify(rows));
    expect(rows).toHaveLength(items.length);
  }, 900000);
});
