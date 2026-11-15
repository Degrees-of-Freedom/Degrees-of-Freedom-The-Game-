# Fixed interior frame collar evidence

Validated on 2026-11-15 on `codex/shared-table-cantilevers`. The final browser rerun began at UI source `f4a4f9b2044cdba97213de2db60467df11c18d58`. During that run, `323e8bed644d3573a6aa08e0513db8ad1cfa8de6` added the final rule guard excluding load-only endpoint identities from authoring targets. The final full test suite and shared-contract/web builds ran after that guard. The browser fixture uses the unchanged ordinary starting-column shared joint; this record does not claim that every browser case ran against a single unchanged source revision.

This record predates integration of feature `fca92ab` with main `cca5702`. The combined source preserves main's Rust-backed evaluator and updated module; current capacity code/tests live in `evaluator/capacity.ts` and `evaluator/collarCapacity.test.ts`, and the turn-model helper is `toTurnEvaluatorInput`. The raw results and screenshot below remain evidence of their original source. See [integrated validation](../../kb/development-and-testing.md#cantilever-feature-and-main-integration--2026-11-15) for the separate combined-source checks.

The [browser runner](../../../scripts/cantilever-browser.mjs) passed all **6 scenarios** in Linux Chromium **156.0.8078.79**, using genuine opening **seed 6** and `grow-dusk-release-2`. The [raw results](results.json) were copied unchanged from the completed run.

| Scenario | Input exercised |
| --- | --- |
| `pointer` | Pointer activation of the attachment, station, legal-tip and explicit connector controls. |
| `scene` | Actual canvas support/tip clicks through the production picker. Camera projection was observed only to locate fixture points on screen. |
| `precise` | Two endpoint coordinate fields while preserving the selected quarter contact. |
| `keyboard` | Keyboard activation and native select navigation. |
| `touch` | Touch-emulated button taps and native target selection on an 1180 × 820 landscape viewport. |
| `gpu-fallback` | The same placement controls while WebGL context creation was unavailable. |

Every scenario staged one frame from `(4,7,1)` to `(8,7,1)`, supported at its original `q1` station over `(5,7,1)`. It checked Unconnected before the explicit Fixed connector action and Attached afterward, exactly one element and one `q1` connection, unchanged draft after reload, a persistent 5 kN load at the free tip, completed End-turn assessment, concealed hands during private handoff, committed geometry and no horizontal page overflow. The runner also rejected unexpected browser exceptions. Non-touch scenarios used a 1440 × 1000 viewport.

The selected screenshot shows the production scene's whole-beam preview with the attachment pinned at 25%, a total span of 8 m and overhangs of 2 m / 6 m:

![Whole-element quarter-supported preview](scene-preview.png)

## Reproduction

From the repository root, with dependencies installed:

```sh
DOF_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/cantilever-browser.mjs
```

Omit `DOF_BROWSER_EXECUTABLE` to use Playwright's installed Chromium. `DOF_EVIDENCE_DIR` selects an output directory; the default is `/tmp/dof-cantilever-evidence`. The runner starts its own Vite server and writes JSON plus screenshots for each scenario. This directory retains one representative screenshot to keep repository evidence bounded.

## Additional validation and limits

- `npm test`: **608 passed, 9 skipped**, across 87 test files. This includes the final authoring guard, source-collar rules, exact placement, asymmetric numerical references, connector resultants, complete match/replay and old-save compatibility suites described in [cantilever placement](../../kb/cantilever-placement.md).
- The shared solver-contract and web production builds passed.
- The top-level `npm run build` could not rebuild Rust because Cargo was unavailable (`ENOENT`). No Rust sources changed; browser and numerical validation used the checked-in WASM module.

These results cover fixed interior sources on continuous frame members. Partial-lock, ball and elastic source collars, and cable/spring/assembly source collars, remain unavailable. Touch emulation is not hardware-touch or screen-reader acceptance. This run does not change the broader [release acceptance ledger](../../kb/criteria-ledger.md).
