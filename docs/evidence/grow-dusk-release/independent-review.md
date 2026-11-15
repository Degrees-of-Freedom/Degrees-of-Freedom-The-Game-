# Independent Grow Dusk release review

The comparison base is `origin/Complete-Grow-Dusk-Release` at `3a2d4e3`. The owner's acceptance target is the two-player Shared table through the normal Grow Dusk Play entry. The `grow-dusk-release-1` numerical, privacy, input and platform gates apply to that mode. Other modes retain their secondary navigation. See the [release criteria](../../kb/release-acceptance-criteria.md) and [criteria ledger](../../kb/criteria-ledger.md).

## Independent match fixtures

Use the built Vite site in a fresh browser profile for each seed. Open `/?seed=N`, choose Play and deliberately reveal each hand. Enter member endpoints through Precise placement, select the indicated connector targets and select gravity locations by the original member ID. The observations below used production controls, the bundled solver, and read-only inspection of the saved revisions. All coordinates are in grid units.

| Seed | Player actions and expected result |
| --- | --- |
| 7 | Player 1 places an HEB between the two setup-column heads at (5,7,1) and (10,7,1) with a fixed connector at each end. Player 2 passes. Player 1 adds an HEB from (10,7,1) to (15,7,1), fixes its first end, and puts 5 kN at its loose tip. Reload before End turn. The handoff must cover the private draft. Reveal, commit once and pass through turn 16. The remote foundation has signed uplift and the near foundation attracts over 100% of the gravity. |
| 14 | Place the half-stiffness spring between both setup-column heads, fix both ends and put 5 kN at its original 50% port on turn 1. The two columns initially share the gravity equally by symmetry. The transverse sag and the axial cartridge extension are different measurements. Evaluate the 10% stroke envelope, the 5 kN axial strength, and any physical neutral repair before reading final scores. Pass the remaining turns. |
| 16 | Repeat the same two-foundation setup using the zero-initial-strain 24 mm cable. Open Inspect, request committed response and display foundation shares. The verified reactions must each be +2.5 kN. Pass through turn 16. The final result must display a tie, 5 kN gravity and 50% per player. |
| 16, separate fresh match | Place the cable between (2,4,2) and (7,4,2) with both ends unattached. Put 5 kN on its midpoint. Pass turn 2. On turn 3, place an HEB from (5,7,1) to (5,7,2), fix its first end and play 5 kN at the tip. Pass through turn 16. The two loads must retain separate physical validity and a common 10 kN score denominator. |

The preliminary Chrome build used WASM SHA-256 `ecd098dd8d37366b58fb9b8f252b43932db213ab04a1c43f6ae321f8149ee97e`. On that build, seed 16 returned +2.500000000055 kN at each base. Seed 14 exposed a solver projection defect. A converged spring equilibrium lost its reactions because the component's overall displacement exceeded a generic deformation threshold. A second defect occurred when a valid saved match reloaded with its WASM request aborted. The app offered damaged-save replacement. Both findings were sent to the integration and physics owners for correction and final-build retest.

## Observed integrated results

The final production manifest identified clean commit `63ae1b499b65cdb9456417361dd2382f5a089e15`, assets SHA-256 `a779d41e7e638170b7a7dfb40c0ce6c9f879994b23b99a98d06771de0e8608e0` and WASM SHA-256 `e238263e5b5c3518b73e3bf9af39be0542191f5f8e51a8fa537bccf68744e744`. The final integrated diff from `3a2d4e3` covered 125 files and passed `git diff --check`. The four matches used separate Chrome 157.0.8103.51 profiles on Windows 11 at 1366 × 900, DPR 1, the normal Play entry and real solver workers. All moves and inspections used visible controls. Saved revisions were read for assertions. I repeated the fixtures across the spring/recovery correction and the subsequent physics and presentation changes.

| Walkthrough | Observed outcome |
| --- | --- |
| Uplift and interrupted draft | Reload mounted a neutral cover. The saved turn 3 draft matched before and after reload. The final reactions were −2.7056586283 kN and +7.7056586283 kN. The result showed −54.11% and 154.11%, 5 kN applied, zero unverified gravity and zero deductions. |
| Adverse spring play | The turn recorded `member-overload:3`, deducted one point and accepted a physical neutral HEB prop from `port:3:2` to (7.5,7,0). The verified neutral reaction was +4.999999999999998 kN. Final player attractions were both 0%, the displayed neutral share was 100%, and Player 2 won 0 to −1. |
| Symmetric cable and solver outage | Both base reactions were +2.500000000055 kN. The result showed 50% per player and joint winners with no deduction. Aborting the WASM request on reload offered Retry, original private download and title exit. Re-enabling the asset and choosing Retry restored the identical final commit ID. |
| Mixed verified and unknown gravity | All three repair attempts on the floating cable were rejected for remaining instability. They created no support. The independent column returned +5.000000000000001 kN. Final player scores were 49 and 0, including one historical deduction. The result showed 10 kN in the denominator, 5 kN unverified and 0% neutral. |

Each completed match had exactly 16 reports. The private tray was absent from the handoff, inspection agreed with the saved signed physical results, and no uncaught page errors occurred. I inspected the rendered final boards, result tables, totals and denominators. The spring and cable screenshots used reduced motion. The uplift run used normal motion.

In the updated inspector, the 10 m loaded overhang showed local `My` of 50 kN·m at the fixed end, 25 kN·m at midspan and 1.209 × 10⁻⁹ kN·m at the tip, matching the cantilever section-cut reference. The sign convention and units appeared with the plot. Combined shape, transfer, shear and bending layers showed independent legends. The signed six-component tables returned equal and opposite horizontal X reactions of 14.55 kN and the two distinct Z reactions above. Mixed components preserved the column plot and identified the cable's reading as unavailable. The section action menu disabled shear, torsion and moment for axial spring and cable members. The three related issue/adapter/section-cut Vitest files passed all 18 tests.

Focusing the inspector with an eight-card hand previously pushed the 1,658 px header 292 px left. Repeating the same interaction on the final build put the header at X=0 with width 1,366 px. The player, round, deductions and Pass button remained visible while the cards scrolled within the tray.

A separate seed 7 match checked rejected placements and shared access. After Player 1 built the HEB span above, staging an HEB from (6,7,1) to (9,7,1) reported a material intersection with member 3. The hand, draft and stored commit ID stayed intact. On turn 4 Player 2 attached a new HEB to Player 1's original midpoint `port:3:2`. On turn 5, a single-axis connector offered the new loose ends while omitting both of member 3's occupied ends and the incompatible fixed joint at (5,7,1).

The storage fault runner passed on the same production bundle. It checked redaction and exact private bytes, malformed/future/oversize/altered imports, restart cancellation, quota failure, a stale second tab, duplicate End input and resumption after interruption between persisted intent and solver completion. During recovery from a deliberately corrupt head, a second failed write still allowed both the exact damaged source and the pending candidate to be exported. Retry restored the expected turn exactly once. The test profile contained synthetic match data.

To repeat the browser fault suite after `npm run build`, run these commands from the repository root in PowerShell.

```powershell
$env:DOF_EVIDENCE_DIR = '.venv/verifier-gd'
$env:DOF_PREVIEW_PORT = '48372'
$env:DOF_BROWSER_CHANNEL = 'chrome'
npm run test:release -- --faults
```

`npm test -- apps/web/src/game/turnIssues.test.ts apps/web/src/solver/wasm/turnSolver.test.ts` passed all 16 tests in both files. The comparisons cover a second independently unstable dimension on the same member, equal rank with a reordered basis, incompatible topology and unknown intervals. The Rust fixture `a_second_euler_mode_increases_full_load_negative_inertia` passed independently. Loads of 1.3 and 2.3 times the weak-axis Euler load produced one and two negative pivots respectively, with invalid equilibrium reactions at both loads.

The three tests in `services/opensees/tests/test_release_wasm_reference.py` passed against the local OpenSees model and the numerical WASM after the upstream range-guard merge. Lateral sway was 0.0054120214 m in WASM and 0.0054067377 m in OpenSees. The WASM critical load was 1.0000488 times the Euler load, against an OpenSees stability bracket of 1.0007813–1.0015625. Cable tensions were 379632.4530 N and 379632.4526 N respectively. These cases passed the specified 1% nonlinear and 2% buckling gates. Reproduce with `uv run --project services/opensees pytest -q -s services/opensees/tests/test_release_wasm_reference.py` after building the solver.

`npm test -- apps/web/src/solver/wasm/turnCatalogue.test.ts` passed all 24 expanded-catalogue WASM fixtures. They check all three original attachment stations for the relevant cable, frame and assembly printings using the browser solver's published responses. The production walkthrough table above is separate evidence for the frozen deal.

## Platform reproduction

The Mac Safari/VoiceOver and physical landscape iPad/touch gates were not run on this Windows host. The exact 16 GB main timing machine and 8 GB i5-1135G7 machine were unavailable. The local machine has 63.45 GiB of RAM, a Core Ultra 9 185H, integrated Intel Arc and a discrete NVIDIA GPU. Its measurements can identify slow paths but do not certify either named hardware configuration. The [NVDA test record](nvda.md) documents the failed attempt to obtain speech from the game on the inactive Windows desktop and the interactive retest required.

Use the same production artifact and record the exact browser, operating system, input devices, GPU, RAM, viewport, device pixel ratio and build hashes. On supported real macOS Safari versions, run the cable and overhang cases above through final scoring with VoiceOver, including the privacy cover after background, reload and pause. Use actual landscape iPad Safari touch at 1024 × 768 or larger. Touch a quarter target, cancel a draft, complete two handoffs and finish all 16 turns. On Windows use NVDA with Chrome and repeat the private-hand, coordinate, menu, inspection and final-score flow. Check that only the active hand is reachable through the accessibility tree and that focus enters the neutral cover on handoff. Measure frame times on the specified 16 GB Core Ultra 9 185H integrated-Arc machine at 1366 × 900, DPR 1, then repeat with reduced decoration on the i5-1135G7/8 GB profile. Keep measurements from different machines labelled with their actual configurations.
