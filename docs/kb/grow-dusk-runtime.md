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

**Play** starts or resumes Shared table in Grow Dusk at `/match`. Each player gets eight turns and a deliberate private reveal. New matches use `rulesRevision: grow-dusk-play-2`. Existing saved matches replay their recorded rules. To start the revised three-deck rules from an older match, choose Menu → Restart and confirm replacement. **More modes** exposes the other workspaces and historical presets.

## Turn and assessment

Three independently shuffled finite decks appear at the beginning of each turn. Choose any four cards, one at a time, from Members, Connections and Loads. Each choice is saved before it updates the hand. The member deck has 18 Beam / column cards, four cables and one of each spring. The load deck has 24 gravity cards and the connection deck has 48 cards restraining one, two or three rotational axes. Connected translations are compatible. The first eight member cards are ordinary beams, covering either player's opening choice of four members. Held cards can be played without the former 1/1/2 limits. Passing follows the fourth draw. Cancel returns provisional cards, and Undo/Ctrl+Z removes the latest placement while retaining the four recorded draw choices. Inspector endpoint edits validate the card and its dependent attachments before accepting a changed draft.

Member reach is a Euclidean maximum of 5, 7 or 10 game units, with shorter legal spans allowed. The board has 15×15 horizontal cells, coordinates 0–15 inclusive in X/Y and 0–12 in Z, at 2 m per game unit. Each player has one immutable fully fixed foundation and starting column. Load targets identify player-built tips and original quarters. Explicit end-to-port selection preserves identity even when geometry coincides. A unique quarter selected by its exact typed coordinate resolves to that same parent port. Deliberate joint contacts allow angle-dependent local fitting clearance; overlapping spans and interior crossings still undergo material checks. Connector cards establish actual force transfer. Setup and system repair objects are inspection-only.

The four member variants are one axial/bending beam-column, one tension-only cable and two axial springs. The authored reference `SPRING.stiffnessNPerM` is 50,000 N/m, documented in the card criteria. Quarter and half springs are 12,500 and 25,000 N/m, independently of span. This reuses the existing authored game constitutive data.

Release choices use the selected member's local section frame. X follows A → B and Y/Z use the same basis as the rendered section and numerical member. The target and its three directions are shown before attachment. New connection actions store `axes` in global coordinates and `frameVersion: member-local-1`. Shared-joint compatibility compares actual physical permitted subspaces, so different local axis names can match at nonparallel members. Inspect exposes the recorded frame, effective system restraint and optional global-coupled/local view. Existing connections without an axes field retain their original global-frame interpretation during replay. Editing a provisional member recomputes its provisional connection frames and rechecks compatibility; committed frames are read-only.

New matches assess after three completed **player turns**, including passes, by default. The toolbar shows the actual remaining count and supports a recorded interval from 1–12. Changing the interval takes effect at the next End and retains the pending window. The final turn always flushes the remaining window. A checkpoint replays pending origins oldest-first with their original player and model identities, carries accepted system fittings forward and attributes at most one deduction per origin. Unknown evidence at its first attempt cannot produce a later retroactive penalty. Persisted last-attempt and last-verified markers are separate. Intermediate reports are explicitly pending.

`turns.ts` validates accepted actions and checks the frozen draft again at End. `releaseSession.ts` saves the assessing intent before sending it to a module worker. `turnAnalysis.ts` maps explicit attachments, active quarter stations, original member properties and persistent gravity to the Rust/WASM solver. Scored gravity excludes member self-weight. Subdividing a spring preserves its force-extension law. Cable rest length equals the dealt member's original span. Nonlinear results carry scoped equilibrium, stability, strength and displacement evidence. The editor's optional OpenSees service is also used for independent reference tests.

`turnIssues.ts` compares physical states and `turnPenalty.ts` records the originating player's historical deduction. Revised repairs use `nodeRepair.ts` and separate `board.jointCorrections`: rated system moment fittings lock released rotations at existing intentional joints. Original connector cards remain inspectable alongside the effective law. Each candidate is checked for whole-model equilibrium and actual member/fitting capacity. A fully disconnected member cannot acquire a ground support from a release edit and remains explicit unresolved scope. Original saved rules retain their recorded prop policy. On turn 16, `finalScore.ts` divides verified signed upward player reactions by all applied gravity and subtracts historical deductions. Neutral/unknown shares and full-precision tie tolerance remain explicit.

## Privacy, persistence and recovery

`releaseDatabase.ts` stores complete private JSON records under `head` and `previous` in the IndexedDB database `dof-grow-dusk`. One read/write transaction compares the expected head and rotates the old valid revision with its replacement. Each record carries match, commit and parent identity, policy versions, private hands/decks, draw ledger, draft, board, accepted actions and physical receipts. A failed transaction retains the exact candidate for retry. The UI publishes a new turn after acknowledgement. Broadcast notifications conceal stale readers; the database comparison also rejects stale writers if a notification was missed.

Reloading a pending assessment reconstructs the frozen turn and completes its existing intent. Closing the route terminates its worker and aborts stale result delivery. Restoring a private file requires an 8 MiB byte-limit check, a supported header and successful versioned replay against the full snapshot. Files rejected during import remain downloadable unchanged. An unreadable stored head can be exported and explicitly replaced by its validated previous revision or a fresh match. An unavailable solver on restore has a retry screen and original-byte export. Existing playtest saves remain available through their own modes.

Private hands, deck order, draw identities, seed and the draft are absent from the handoff screen. Pausing, backgrounding and reloading conceal the hand. The menu offers separately labelled **Export public summary** and **Export private match**. Public summaries are field-by-field projections of the committed structure and reports. Only the private file can resume play.

## Board and presentation

The header shows seat, round, remaining draws and deductions. The hand tray groups cards and exposes targeting when a card is selected. Original-quarter and precise coordinate controls supplement the 3D board. Inspect exposes engineering evidence for the current scope. GPU fallback keeps the precision controls available. Settings control companion, glow, reduced motion and opt-in sound. The compact companion uses locally attributed models, procedural poses and matching portrait fallbacks. Every third distinct verified deduction for one player can trigger the 800 ms foreman clip, subject to a 45-second cooldown. The same clip changes from Timburr to Conkeldurr at its 160 ms crouch peak. A verified instability complaint identifies the member and originating turn in a red bubble. Final scoring and privacy take priority. [Companion policy and timing](avatar-criteria.md)

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

The board exposes Deformation, Load paths, Shear, Bending and Instability controls directly. Deformation and transfer start enabled and node releases start at All joints for new display preferences. Results appear automatically for the calculated checkpoint model. Pending topology or draft changes suppress incompatible overlays with an explicit countdown/last-calculated-turn label. A two-entry cache retains public physical response data across private handoffs; inspecting or drawing does not launch a new authoritative checkpoint. Calculating and saving have distinct cover messages.

Deflection uses the calculated six-colour magnitude contour, labelled scale and dashed reference geometry. Directional arrows show calculated gravity transfer independently of tension/compression styling. Signed local actions, shear/moment diagrams, original stations, hollow end-on section profiles and six global foundation reactions are in Inspect. Reaction labels have Off/Small/Normal/Large preferences. The independent instability view uses returned solver vectors, including rotational participation, with static/play controls and a normalized exaggerated-ghost label. Arrow keys orbit/elevate, Q/E rotate, and F fits the camera when the board has keyboard focus. Player 1 is Coral and Player 2 Blue, with explicit labels and distinct marker shapes.

Install Node 22 or later and run `npm ci` and `npm run dev` from the repository root. The checked-in WASM supports local development. Production builds require Cargo and the standard library for `wasm32-unknown-unknown` (`rustup target add wasm32-unknown-unknown`). `npm run build` compiles Rust from source, builds the shared contract and client, compares the SHA-256 of the distributed module to Cargo's output and writes `apps/web/dist/release-build.json`. Build from a Git checkout for provenance.

Serve the contents of `apps/web/dist` at an HTTPS origin root, with history fallback to `index.html` for client routes such as `/match`. Serve actual assets and workers with the correct MIME types, including `application/wasm`. Dynamic modules, workers, the solver, Draco decoders and character assets are served locally. Keep asset URLs available across deployments for already-open tabs. IndexedDB and crypto must be available on the same origin. A new origin has a separate local match store.

## Acceptance commands

Run `npm run typecheck`, `npm test`, `npm run test:solver`, `npm run test:opensees`, `npm run build:solver`, `npm run build` and `npm run bench:solver`. The Python suite uses uv and independently assembled OpenSees models. Setting `VITE_OPENSEES_URL` to a running reference service also enables the live TypeScript adapter cross-checks.

After a production build, install Playwright Chromium with `npx playwright install chromium` or set `DOF_BROWSER_CHANNEL` to `chrome` or `msedge`. Run `npm run test:release` for seeds 0–19 plus a separate all-pass match. `npm run test:release -- --faults` exercises storage and worker interruptions. `node scripts/release-presentation.mjs` checks controls, zoom and presentation fallbacks. `DOF_FIRST_SEED`, `DOF_LAST_SEED`, `DOF_INPUT=keyboard`, `DOF_BROWSER_EXECUTABLE` and `DOF_EVIDENCE_DIR` select a shorter range, actual keyboard input, browser binary and output directory. Use `DOF_CAPTURE_TURNS=1` for turn-by-turn screenshots of seeds 0–2. A new browser profile can select a deterministic initial deal through `/match?seed=6`; the route removes the query and an existing record takes precedence.

Run `node scripts/release-performance.mjs` for default-decoration frame and input timing, and `node scripts/release-resources.mjs` for repeated route and scene resets. The performance report includes the active graphics renderer, CPU, installed memory, browser, build and individual timing samples. The [release criteria ledger](criteria-ledger.md) records measured results, unavailable platforms and acceptance status.
