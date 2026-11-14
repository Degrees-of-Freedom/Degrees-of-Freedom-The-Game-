# Timburr companion — deferred implementation handoff

**Read [the avatar criteria](../../docs/kb/avatar-criteria.md) first.** The owner requested criteria-first work; implementation was stopped and removed from the active app. This package preserves an unfinished experiment for a future Codex/Claude run. Nothing here is enabled by the documentation change. The criteria take precedence over prototype behavior.

## Start here for a future run

1. Read `AGENTS.md`, `docs/kb/README.md`, `docs/kb/avatar-criteria.md` and `docs/kb/animation-criteria.md`.
2. Inspect current main and the turn/solver criteria. Do not assume the experiment's event model still matches the app.
3. Review the known gaps below. Ask the owner about unresolved art/policy choices when they affect implementation; do not ask again about confirmed compact placement or character choice.
4. Work on an isolated feature branch/worktree. Review the patch before applying it. `git apply --check` only validates applicability, not correctness or readiness.
5. Integrate selectively, fix the gaps and report actual validation. Do not merge an automatic transformation triggered by experimental analysis.

## Package contents and application

[`implementation.patch`](implementation.patch) is a self-contained Git binary patch containing 18 paths: the React/Three.js companion prototype, app/workspace integration, reaction tests, original synthetic sound code, both local GLBs, local Draco decoder/Apache licence, model attribution/hash manifest, and an unfinished Blender fallback-portrait script. No new production npm dependency is required by the prototype.

The patch was created against app files on main revision `c51eeae` plus the preceding animation-criteria documentation commit `15d2764`. It applies to the current app baseline at packaging time; future main may need conflict resolution. Preserve unrelated later changes.

From the repository root on an implementation branch:

```bash
git apply --stat prototypes/timburr-companion/implementation.patch
git apply --check prototypes/timburr-companion/implementation.patch
# Only after reviewing the criteria and gaps, if reusing this prototype:
git apply prototypes/timburr-companion/implementation.patch
npm ci --cache /tmp/dof-npm-cache --no-audit --no-fund
npm run build
npm test
npm run dev -w @dof/web -- --host 0.0.0.0 --port 5173
```

Do not apply the patch during criteria-only work. It creates active app code and requires further implementation. A future run may instead extract just the models/manifest or rewrite the UI. No service deployment, PR or main merge was performed.

## What the experiment attempted

- A compact recurring character across routes, click-for-tip behavior and larger temporary reactions.
- Read-only observations of member additions, load/joint changes, staged Shared table attachments and committed reports.
- Provisional manual-analysis guidance and repair/playtest wrap-up responses.
- A local GLTFLoader/DRACOLoader renderer with whole-model procedural motion. Both candidate GLBs have **no embedded animation clips**; no articulated or skeletal expressions were implemented.
- Optional decorative glow, motion preferences, opt-in synthesized sound, hide/restore, and a labelled Conkeldurr preview in settings.
- One replaceable reaction and a 45-second transformation cooldown.

These are prototype intentions, not acceptance claims. The original models are 22,088 bytes (Timburr) and 26,100 bytes (Conkeldurr); decoder assets add about 251 kB. See the patch's `apps/web/public/companion/sources.json` and `CREDITS.md` for provenance, hashes and licences. Source repository revision: `429de1288cea0d43f5b4f56305d2276e94239d65`. The project owner states permission for character use.

## Known gaps — address before integration

1. **Automatic transformation policy conflicts with the final criteria.** The prototype responds to an experimental stable-to-unstable committed report. Disable or replace that trigger. `TurnReport.status` is not verified new/worsened serious-issue evidence. Preserve explicit unknown/preview handling; do not manufacture penalties or collapse.
2. **Live 3D is unverified in the available desktop browser.** Chromium could not create a WebGL context. The fallback text and controls appeared, but neither character was visually approved. Review camera direction, lighting, texture loading, swapping and resource lifecycle on a WebGL-capable browser.
3. **Portrait fallback is unfinished.** The final archived source references `companion/timburr.png` and `companion/conkeldurr.png`, but those PNGs do not exist in the patch. Generate/approve them or replace the fallback before using it. This last change was not browser-validated.
4. **The fallback generation script did not complete.** The local Blender build lacked its Draco library. Temporary predecoded GLBs were produced with `@gltf-transform/core`, `@gltf-transform/extensions` and `draco3dgltf`, but the next render attempt failed because OpenImageDenoise was unavailable. The archived script enables denoising; adapt to the target Blender build. No successful portraits, decoded GLBs or temporary tooling are packaged. The script supports a predecoded input directory after `--`.
5. **Audio integration is provisional.** Companion sound has its own opt-in setting; app-wide master mute/volume, sound unlock timing and interruption need proper integration and browser testing.
6. **Accessibility/layout review is incomplete.** Check mobile/zoom, focus, dismissal, screen-reader announcement frequency, foreground dialogs, restore placement and all five styles. The prototype is a proposed layout, not an approved visual design.
7. **Events need stronger identity.** The experiment mostly compares state references/counts; robust event IDs, reload/reconnect deduplication, stale version handling and meaningful issue comparison still need design/implementation.
8. **Performance and memory are unmeasured.** It adds a separate renderer and frame loop. Validate alongside the board, stop unnecessary hidden/reduced-motion work and check loading failures/unmount races before shipping.
9. **Reaction coverage is partial.** No full animation criteria implementation, verified serious-event integration, authoritative scoring/victory flow, authored rig/poses, character cries or voice acting was completed. Complete-playtest text does not declare a winner.

## Evidence recorded before work stopped

| Check | Actual result and scope |
| --- | --- |
| Model inspection | Both files have GLB headers, WebP textures, Draco compression and embedded attribution. No embedded animation clips. Files were downloaded and hashed. |
| `npm run build` | Passed before the final fallback edits; Vite emitted the Three.js chunk-size warning. |
| `npm test` | Passed before the final fallback edits: 22 files, 94 passed tests, 2 existing service-dependent skips. Four new tests check reaction semantics and non-mutation, not visual behavior. |
| Browser | Launcher and companion controls loaded. WebGL context creation failed; the character did not render. No successful transformation or audio playback was observed. |
| Latest fallback source | Preserved but not revalidated; missing portraits are a known blocker. |
| `git apply --check` after removing prototype from active app | Passed at packaging time. A round-trip extraction also restored both models with matching SHA-256 hashes. This is packaging evidence only. |

A default npm cache path was unwritable in this workspace; retrying with `--cache /tmp/dof-npm-cache` installed the existing lockfile successfully. No dependency manifest/lockfile changes were needed.

Keep the knowledge base honest: future work should update [avatar criteria](../../docs/kb/avatar-criteria.md), [3D viewer](../../docs/kb/3d-viewer.md) and [development and testing](../../docs/kb/development-and-testing.md) with what actually ships and the evidence obtained.
