/// <reference types="node" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { parseStructureLibrary } from './structureLibrary';
import { LEVELS } from './levels';
import { analyzeGame } from './analysis';
import { createOpenSeesSolver } from '../solver/opensees';
import { createSolvers, runSolver, type RunContext, type SolverVerdict } from './solvers';
import {
  findDisagreements,
  summarizeBySolver,
  summarizeTimings,
  type FixtureComparison,
} from './solverComparison';

/**
 * Opt-in timing comparison of every solver over the twenty library fixtures.
 *
 *   VITE_OPENSEES_URL=http://127.0.0.1:8000 npm run compare:solvers
 *
 * Optional: SOLVER_TIMING_REPS (measured repetitions, default 5). One warm-up
 * run per solver and fixture is discarded. Results are printed and written to
 * `.generated/solver-timing.json` (git-ignored). These are single-machine
 * timings, useful for relative comparison and for spotting verdict
 * disagreements, not published benchmarks.
 */
const url: string | undefined = import.meta.env.VITE_OPENSEES_URL;
const repetitions = Math.max(1, Number(process.env.SOLVER_TIMING_REPS) || 5);
const output = new URL('../../../../.generated/solver-timing.json', import.meta.url);

const catalog = parseStructureLibrary(
  JSON.parse(readFileSync(new URL('../../public/structures/catalog.json', import.meta.url), 'utf8')),
);

const fmt = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(1));

describe.skipIf(!url)('solver timing comparison (needs a running service)', () => {
  it('runs every fixture through every solver and writes the results', { timeout: 30 * 60_000 }, async () => {
    const solvers = createSolvers(createOpenSeesSolver(url!));
    const fixtures: (FixtureComparison & {
      name: string;
      wallMs: Record<string, number[]>;
      messages: Record<string, string>;
    })[] = [];

    for (const record of catalog) {
      const model = record.save.model;
      const context: RunContext = {
        model,
        level: LEVELS.library,
        contractCompatible: true,
        analyzeVoxel: () => analyzeGame(model, LEVELS.library),
      };
      const entry = {
        fixtureId: record.id,
        name: record.name,
        verdicts: {} as Record<string, SolverVerdict>,
        computeMs: {} as Record<string, number[]>,
        wallMs: {} as Record<string, number[]>,
        messages: {} as Record<string, string>,
      };
      for (const solver of solvers) {
        await runSolver(solver, context); // warm-up, discarded
        const compute: number[] = [];
        const wall: number[] = [];
        for (let i = 0; i < repetitions; i++) {
          const run = await runSolver(solver, context);
          entry.verdicts[solver.id] = run.verdict;
          entry.messages[solver.id] = run.message;
          if (run.computeMs !== null) compute.push(run.computeMs);
          wall.push(run.wallMs);
        }
        entry.computeMs[solver.id] = compute;
        entry.wallMs[solver.id] = wall;
      }
      fixtures.push(entry);

      console.log(`\n${record.id} ${record.name} (${record.memberCount} members)`);
      console.log('solver'.padEnd(20) + 'verdict'.padEnd(13) + 'median ms'.padStart(11) + 'worst ms'.padStart(11) + 'wall median'.padStart(13));
      for (const solver of solvers) {
        const compute = summarizeTimings(entry.computeMs[solver.id]);
        const wall = summarizeTimings(entry.wallMs[solver.id]);
        console.log(
          solver.id.padEnd(20) + entry.verdicts[solver.id].padEnd(13) +
            fmt(compute?.medianMs).padStart(11) + fmt(compute?.worstMs).padStart(11) + fmt(wall?.medianMs).padStart(13),
        );
      }
    }

    const summary = summarizeBySolver(fixtures);
    const disagreements = findDisagreements(fixtures);
    console.log(`\nSummary over ${fixtures.length} fixtures, ${repetitions} repetitions each (compute ms)`);
    for (const solver of solvers) {
      const s = summary[solver.id];
      console.log(`${solver.id.padEnd(20)} median ${fmt(s?.medianMs).padStart(9)}   worst ${fmt(s?.worstMs).padStart(9)}`);
    }
    console.log(
      disagreements.length
        ? `\nStability disagreements (a finding, not noise):\n${disagreements
            .map((d) => `  ${d.fixtureId}: ${Object.entries(d.claims).map(([id, v]) => `${id}=${v}`).join(', ')}`)
            .join('\n')}`
        : '\nNo stability disagreements between solvers that made a claim.',
    );

    mkdirSync(new URL('./', output), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          serviceUrl: url,
          repetitions,
          warmupRuns: 1,
          note: 'Single-machine timings. computeMs is the solver own measurement; wallMs includes the network round trip.',
          fixtures,
          summary,
          disagreements,
        },
        null,
        2,
      ),
    );
  });
});
