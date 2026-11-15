# Viewer baseline

Captured from commit `cdd5c9a9e4be713a7ab85acb4dc9c8acbc3b6611` before implementation on Windows, headless Chrome 157.0.8103.51, ANGLE SwiftShader, 1366 × 900 CSS pixels, DPR 1. The capture used the repository's Vite dev server, a fresh browser profile and default settings. It used the Creative portal in `game/environmentExamples.ts`, which contains four SHS members, two supports, a 10 kN downward load and a 5 kN lateral load. The working plane was 3. No analysis, selection, drawer, or help overlay was active.

| Presenter | Before |
| --- | --- |
| Grow Dusk | [Screenshot](before/grow-dusk.png) |
| Grow | [Screenshot](before/grow.png) |
| Levels | [Screenshot](before/levels.png) |
| Blocks | [Screenshot](before/blocks.png) |
| Kit | [Screenshot](before/kit.png) |

The capture loaded `/play` and used the existing store to select Creative, the presenter and fixture. Each view used the environment's initial orientation and the normal Fit control, with the pointer moved to the upper-left corner. Grow Dusk is the only presenter reachable from the baseline menus. The other four screenshots exercise existing presentation code through the store. These captures establish scene appearance. They do not establish gameplay, numerical, device or accessibility acceptance.

To repeat with the same fixture and settings, start Vite from the workspace root and run [capture.cjs](capture.cjs) with the local Playwright module, Chrome executable, dev-server origin and comparison directory as its four arguments. The runner logs the observed presenter label, member count and Chrome version.

## Grow Dusk applied-load preview

On Windows with an Intel Core Ultra 9 185H and Intel Arc Pro Graphics, Chrome 157.0.8103.51 used ANGLE D3D11 hardware rendering. [measure.cjs](measure.cjs) loads each library record in Creative at 1366 × 900, DPR 1. Each browser launch takes 120 frame samples after 30 warm-up frames. Each of the 20 timed preview calls follows five warm-up solves and rebuilds the analysis from the game model, including load generation, member recovery and verification. No prior model solution is reused. Run `node docs/evidence/viewer/measure.cjs <playwright-module> <chrome-executable> <local-vite-origin> auto`.

| Fixture | Members | Original preview p95, ms | Updated preview p95, ms (three launches) | Frame p95, ms (three launches) |
| --- | ---: | ---: | ---: | ---: |
| 04-rigid-portal | 6 | 1.3 | 0.9 / 0.5 / 1.7 | 6.2 / 6.2 / 6.8 |
| 12-midrise | 208 | 162.3 | 13.3 / 13.3 / 46.1 | 6.2 / 7.6 / 12.1 |

All three launches completed without browser page errors. The midrise has 384 free equations and passed the applied linear checks. Its normalized force, moment and free-axis nodal balance residuals were 1.11e-15, 7.63e-16 and 3.69e-16. The measured timings apply to these fixtures, browser and hardware.

[solver-parity.mjs](solver-parity.mjs) compares the applied and design combinations for all 20 library records. Run `node docs/evidence/viewer/solver-parity.mjs` on each checkout. Both returned SHA-256 `c3e10424122e57805e46854438f6c3d2e28937dd1902a5f85c423309305572c8` across 40 analyses. The digest covers displacement, signed end and reaction vectors, element-local motion, component classifications, residuals and the full design critical-factor estimates. The focused compression fixture in `voxelVerification.test.ts` also exercises factors immediately below and above the conservative preview cutoff.
