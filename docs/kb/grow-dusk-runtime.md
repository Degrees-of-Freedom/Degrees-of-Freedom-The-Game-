---
title: "Grow Dusk local match runtime"
last_validated: 2026-11-15
validated_against:
  - apps/web/src/pages/ReleaseMatch.tsx
  - apps/web/src/game/releaseSession.ts
  - apps/web/src/game/releaseSave.ts
  - apps/web/src/game/turns.ts
  - apps/web/src/game/turnAnalysis.ts
  - apps/web/src/components/ReleaseBoard.tsx
  - scripts/release-browser.mjs
  - apps/web/src/components/viewModes
  - apps/web/src/viewer/viewModes.ts
  - apps/web/src/viewer/viewLegends.ts
  - apps/web/src/viewer/displacementShadow.ts
status: partial
---

# Shared table in Grow Dusk

**Play** starts or resumes Shared table in the Grow Dusk environment at `/match`. The owner scoped the release criteria to this two-player mode. Each player gets eight turns and a deliberate private reveal. **More modes** preserves existing workspaces and historical card presets under their original save formats. The release uses the existing TurnState domain with the `grow-dusk-release-1` rules and an assessment after each turn.

## Turn and assessment

The match authority creates two 48-card decks with independent deterministic shuffles. Every turn draws two cards per deck once. A player can retain cards, stage one element, one gravity load and two end connections, cancel the draft, or pass. The release board spans 0–15 in X/Y and 0–12 in Z, in 2 m units. Load targets identify the above-ground tip or original quarter of a player-built member. Loose ends have physical identities even at coincident coordinates. Explicit connections determine force transfer. Setup endpoints and neutral repair objects are excluded load targets.

`turns.ts` validates accepted actions and checks the frozen draft again at End. `releaseSession.ts` saves the assessing intent before sending it to a module worker. `turnAnalysis.ts` maps explicit attachments, active quarter stations, original member properties and persistent gravity to the Rust/WASM solver. Scored gravity excludes member self-weight. Subdividing a spring preserves its force-extension law. Cable rest length equals the dealt member's original span. Nonlinear results carry scoped equilibrium, stability, strength and displacement evidence. The editor's optional OpenSees service is also used for independent reference tests.

`turnIssues.ts` compares the original and staged models, then `turnPenalty.ts` records at most one deduction for the acting player. `turnRepair.ts` can test up to three permanent physical reinforcements at the affected member. Receipts identify rejected candidates, accepted objects, pending scope and foundation reactions. On turn 16, `finalScore.ts` divides each player's verified signed upward reaction by total applied gravity and subtracts historical deductions. Neutral reactions and unknown gravity remain separately inspectable. The tie tolerance is 0.01 points on unrounded scores.

## Privacy, persistence and recovery

`releaseDatabase.ts` stores complete private JSON records under `head` and `previous` in the IndexedDB database `dof-grow-dusk`. One read/write transaction compares the expected head and rotates the old valid revision with its replacement. Each record carries match, commit and parent identity, policy versions, private hands/decks, draw ledger, draft, board, accepted actions and physical receipts. A failed transaction retains the exact candidate for retry. The UI publishes a new turn after acknowledgement. Broadcast notifications conceal stale readers; the database comparison also rejects stale writers if a notification was missed.

Reloading a pending assessment reconstructs the frozen turn and completes its existing intent. Closing the route terminates its worker and aborts stale result delivery. Restoring a private file requires an 8 MiB byte-limit check, a supported header and successful versioned replay against the full snapshot. Files rejected during import remain downloadable unchanged. An unreadable stored head can be exported and explicitly replaced by its validated previous revision or a fresh match. An unavailable solver on restore has a retry screen and original-byte export. Existing playtest saves remain available through their own modes.

Private hands, deck order, draw identities, seed and the draft are absent from the handoff screen. Its lightly blurred scene renders committed geometry only, with the pass message and Ready control over it. Pausing, backgrounding and reloading conceal the hand. The menu offers separately labelled **Export public summary** and **Export private match**. Public summaries are field-by-field projections of the committed structure and reports. Only the private file can resume play.

## Board and presentation

The header shows seat, round, remaining allowances and deductions. The compact hand tray groups cards and uses blue for elements, purple for connections and amber for gravity; labels and symbols also identify each type. Selecting a card exposes targeting. Original-quarter and precise coordinate controls supplement the 3D board. Inspect exposes engineering evidence for the current scope. GPU fallback keeps the precision controls available. Settings control companion, glow, reduced motion and opt-in sound. The presentation reads committed public reports. The compact Timburr/Conkeldurr companion uses locally attributed models, procedural poses and matching portrait fallbacks. A qualified foreman reaction requires a newly penalized instability or utilization of at least 1.25, with a 45-second cooldown. Final scoring and privacy take priority over cosmetic events.

### View modes and legends

An eye button at the top right of the board (or **V**) opens **View modes**: eight toggle tiles that can be combined. `viewModes.ts` holds the presentation state and `useBoardView.ts` derives the overlays; none of it changes geometry, values, connectivity or scoring.

| Mode | Draws | Legend reports |
| --- | --- | --- |
| Load path | Signed gravity-transfer arrows; member colour by tension, compression or mixed action, thickness by transfer | Colour keys and the largest transfer in kN |
| Deflected shape | Members on the verified deflected centreline with the displacement contour and dashed reference | 0 mm to peak mm on the contour, displayed exaggeration |
| Displacement shadow | Members stay at rest; a translucent contour-coloured ghost of the deflected shape and dashed joint-travel lines | As above |
| Joint freedoms | The All joints glyph display (the persisted joint-display setting) | Axis colours and glyph vocabulary, joint count |
| Loads & reactions | Card gravity and signed support reaction arrows | Colours and total applied card gravity |
| Shear / bending diagram | Vy or Vz, My or Mz along verified frame sections, chosen on the tile | Component, peak value and positive direction |
| Instability | Dashed witnessed region | Whether a witness exists |

Deflected shape and displacement shadow are mutually exclusive; the other modes combine freely. The board solves the committed structure only when a response-backed mode is first pressed, as before. Until then, or while a draft is staged or the solve is pending or fails, each response legend states why it is not drawn; joint freedoms need no solve. The default is the earlier view: deflected shape with loads and reactions. **Clear** hides all overlays and returns joints to Selected; **Reset** restores the default.

The **Labels** switch hides or shows every in-scene text label at once: load and reaction values, the largest load-path transfers (at most 16, above 5% of the peak), the peak deflection, diagram peaks, the instability tag and joint axis letters. Legends stay visible and can be folded to one chip; they start folded on screens up to 520 px tall. The contour runs dark blue, cyan, green, yellow and orange to red. The scene and legends share one palette (`viewPalette.ts`, `contourRamp.ts`), so a legend always matches the drawn colour. Values below 10⁻⁶ in display units read as zero.

The Inspect drawer's **Board overlay**, displacement scale, diagram and instability controls drive the same state. The overlay keeps its first four options in their scripted order and adds the two shadow layers after them. While the view panel is open, Escape closes it before the board's own Escape handling or the pause menu (`data-owns-escape`, see `PauseMenu.tsx`).

## Running and hosting

Response inspection starts with deflected geometry. The board can combine deflection and signed gravity transfer with shear and bending plots. Every displayed diagram uses verified cuts and a labelled magnitude scale. Reference geometry, original stations, signed values and the six global foundation reactions are available in the same drawer. The camera, display scale and overlays are presentation settings.

Install Node 22 or later and run `npm ci` and `npm run dev` from the repository root. The checked-in WASM supports local development. Production builds require Cargo and the standard library for `wasm32-unknown-unknown` (`rustup target add wasm32-unknown-unknown`). `npm run build` compiles Rust from source, builds the shared contract and client, compares the SHA-256 of the distributed module to Cargo's output and writes `apps/web/dist/release-build.json`. Build from a Git checkout for provenance.

Serve the contents of `apps/web/dist` at an HTTPS origin root, with history fallback to `index.html` for client routes such as `/match`. Serve actual assets and workers with the correct MIME types, including `application/wasm`. Dynamic modules, workers, the solver, Draco decoders and character assets are served locally. Keep asset URLs available across deployments for already-open tabs. IndexedDB and crypto must be available on the same origin. A new origin has a separate local match store.

## Acceptance commands

Run `npm run typecheck`, `npm test`, `npm run test:solver`, `npm run test:opensees`, `npm run build:solver`, `npm run build` and `npm run bench:solver`. The Python suite uses uv and independently assembled OpenSees models. Setting `VITE_OPENSEES_URL` to a running reference service also enables the live TypeScript adapter cross-checks.

After a production build, install Playwright Chromium with `npx playwright install chromium` or set `DOF_BROWSER_CHANNEL` to `chrome` or `msedge`. Run `npm run test:release` for seeds 0–19 plus a separate all-pass match. `npm run test:release -- --faults` exercises storage and worker interruptions. `node scripts/release-presentation.mjs` checks controls, zoom and presentation fallbacks. `DOF_FIRST_SEED`, `DOF_LAST_SEED`, `DOF_INPUT=keyboard`, `DOF_BROWSER_EXECUTABLE` and `DOF_EVIDENCE_DIR` select a shorter range, actual keyboard input, browser binary and output directory. Use `DOF_CAPTURE_TURNS=1` for turn-by-turn screenshots of seeds 0–2. A new browser profile can select a deterministic initial deal through `/match?seed=6`; the route removes the query and an existing record takes precedence.

Run `node scripts/release-performance.mjs` for default-decoration frame and input timing, and `node scripts/release-resources.mjs` for repeated route and scene resets. The performance report includes the active graphics renderer, CPU, installed memory, browser, build and individual timing samples. The [release criteria ledger](criteria-ledger.md) records measured results, unavailable platforms and acceptance status.
