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
