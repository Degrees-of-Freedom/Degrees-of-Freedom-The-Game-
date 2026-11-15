# Fixed interior frame collar evidence

Validated on 2026-11-15 against the final integrated source tree on local main at `6c8b1eab891c41fc9ed26665a085afe25c1367d5`. This retains feature integration `458104c4c0000051467f60a441a0e8234b0d2d6d` and concurrent main `533e1af04ba66d5f80076a184bf4fb05fb915d2f`, preserving the Rust-backed evaluator, solver module, companion, View modes and compact coloured cards. This record identifies local source validation; it does not report a remote push.

Current capacity code/tests live in `evaluator/capacity.ts` and `evaluator/collarCapacity.test.ts`, and the turn-model helper is `toTurnEvaluatorInput`. See [integrated validation](../../kb/development-and-testing.md#cantilever-feature-and-main-integration--2026-11-15) for the combined-source checks.

The [browser runner](../../../scripts/cantilever-browser.mjs) passed all **6 scenarios** against the integrated source in Linux Chromium **156.0.8078.79**, using genuine opening **seed 6** and `grow-dusk-release-2`. The [main integration results](main-integration-results.json) were copied unchanged from the completed run; [original feature results](results.json) remain historical evidence.

| Scenario | Input exercised |
| --- | --- |
| `pointer` | Pointer activation of the attachment, station, legal-tip and explicit connector controls. |
| `scene` | Actual canvas support/tip clicks through the production picker. Camera projection was observed only to locate fixture points on screen. |
| `precise` | Two endpoint coordinate fields while preserving the selected quarter contact. |
| `keyboard` | Keyboard activation and native select navigation. |
| `touch` | Touch-emulated button taps and native target selection on an 1180 × 820 landscape viewport. |
| `gpu-fallback` | The same placement controls while WebGL context creation was unavailable. |

Every scenario staged one frame from `(4,7,1)` to `(8,7,1)`, supported at its original `q1` station over `(5,7,1)`. It checked Unconnected before the explicit Fixed connector action and Attached afterward, exactly one element and one `q1` connection, unchanged draft after reload, a persistent 5 kN load at the free tip, completed End-turn assessment, concealed hands during private handoff, committed geometry and no horizontal page overflow. The runner also rejected unexpected browser exceptions. Non-touch scenarios used a 1440 × 1000 viewport.

The selected screenshot comes from the final integrated source at `6c8b1ea`. It shows the production scene's whole-beam preview with the attachment pinned at 25%, a total span of 8 m and overhangs of 2 m / 6 m, alongside main's companion islet, View modes control and compact coloured cards:

![Whole-element quarter-supported preview](scene-preview.png)

## Reproduction

From the repository root, with dependencies installed:

```sh
DOF_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/cantilever-browser.mjs
```

Omit `DOF_BROWSER_EXECUTABLE` to use Playwright's installed Chromium. `DOF_EVIDENCE_DIR` selects an output directory; the default is `/tmp/dof-cantilever-evidence`. The runner starts its own Vite server and writes JSON plus screenshots for each scenario. This directory retains one representative screenshot to keep repository evidence bounded.

## Integrated validation and limits

- TypeScript checking passed.
- `npm test`: **872 passed, 12 skipped** (884 total), with 101 passed files and 3 skipped files (104 total). This includes the main evaluator and presentation changes together with the source-collar rules, exact placement, asymmetric references, connector demand, full match/replay and old-save compatibility suites.
- The shared solver-contract and web production builds passed on the same integrated source tree. These checks used main's checked-in solver module; the feature-host Cargo limitation below is not a new Rust build result.

These results cover fixed interior sources on continuous frame members. Partial-lock, ball and elastic source collars, and cable/spring/assembly source collars, remain unavailable. Touch emulation is not hardware-touch or screen-reader acceptance. This run does not change the broader [release acceptance ledger](../../kb/criteria-ledger.md).

## Historical feature validation

Before integration, the feature run began at UI source `f4a4f9b2044cdba97213de2db60467df11c18d58`. The final source-authoring guard `323e8bed644d3573a6aa08e0513db8ad1cfa8de6` landed during that run. Its [raw results](results.json) record the same six scenarios. The feature's later full suite passed 608 tests with 9 skipped across 87 files, and its shared-contract/web builds passed. Cargo was unavailable (`ENOENT`) for its top-level rebuild; that feature changed no Rust source and used its then-checked-in module. Those results retain their original provenance rather than being relabelled as combined-source tests.
