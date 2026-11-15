# Session 3 — multiplayer scene and inspection

Status: **independent implementation complete, integration-ready; production Workspace wiring belongs to session 4**. Built in `/workspace/dof-session-3` on `session-3/multiplayer-view`, starting at the requested shared baseline `bbe4c44`. No push/merge to main, peer-session cherry-picks, shared KB edits, manifests, global CSS, store, navigation, domain, checkpoint or solver changes were made.

## Commits and owned surface

- `5905ac3` — independent procedural geometry, explanatory primary-flow interpretation, Euclidean targets and focused tests.
- `93f0a5c` — scene/inspector, readonly public view contract, explicit legacy adapter, scope validation, preview/browser checks and module documentation.
- `e05b4bf` — narrow smooth pointer focus so thousands of legal depth targets do not obscure the board.
- The final handoff/evidence commit also clarifies the read-only label when a draft-edit callback is unavailable. Read the branch's latest commit for that small follow-up and this document.

All implementation files live under `apps/web/src/multiplayer/view/`. Evidence and this unique handoff live under `docs/implementation-handoffs/`. The full integration guide is [view/README.md](../../apps/web/src/multiplayer/view/README.md); the precise public contract is [types.ts](../../apps/web/src/multiplayer/view/types.ts). No missing peer exports are imported.

## Exported interface

Production imports come from `apps/web/src/multiplayer/view/index.ts`:

| Export | Contract |
| --- | --- |
| `MultiplayerScene` / `MultiplayerSceneProps` | Readonly `data`, controlled `selection`, `onSelectionChange`; optional geometric `placement` + canonical `isLegal`; `onTargetActivate` requests a draft selection. No commits/solves/store writes. |
| `ElementInspector` / `ElementInspectorProps` | Readonly `data`, `memberId`, `onClose`; optional `onDraftChange(id, {end})`. Committed/setup members never expose editing. |
| `SceneHandle` | `fit()`, `pause()`, `resume()`, idempotent `dispose()` via ref. Controlled `paused` persists shell suspension; `onDispose` is presentation-only. |
| Safe zones | Scene `onSafeZones(rects)` and inspector `onSafeZone(rectOrNull)` report viewport rectangles for controls/inspector and update on resize/scroll. Shell combines these with its own hand/quit/avatar zones. |
| `MultiplayerViewData` | Revision, explicit 15×15 Z-up bounds/height/metres-per-unit, four-family members, shared-joint original masks, separate safety records, optional exactly scoped checkpoint. No private hand data. |
| `sceneFlow` / `sceneFlowPositions` | Conservative scoped-result validation, explicit quarter/joint aliases and explanatory load-transfer direction. No physical solve. |
| `adaptBaselineGame` | Pure optional `GameModel`/selected `VoxelAnalysis` bridge with explicit standard-family/card/owner/tier metadata and diagnostics. It does not establish current gameplay physics. |
| Geometry / targeting helpers | Cached low-poly box/cable/two-coil geometry; original-reference quarters; all-direction Euclidean 5/7/10 targets; salience/depth-stack/cycling helpers. |

## Session 4 integration steps

1. Join this finished branch only after reviewing its owned files. Keep peer implementations isolated until their handoffs are ready. Do not replace the current canonical domain/checkpoint APIs with this display fixture.
2. Adapt the finished domain snapshot to `MultiplayerViewData`. Publish board height and scale, card identity/owner/tier, authored section dimensions, original global rotational masks, setup locks and explicit original quarter ports. Retain explicit node/port identities; geometric crossing/coincidence never means attachment. Each player should supply only their original default base/column.
3. Mount scene and inspector together as shown in the module README. A member selection opens the persistent inspector. Route target and draft-edit callbacks into the domain's validated commands, then provide a fresh readonly view. Inject placement clash/attachment/card legality; the local geometric guard is deliberately not another game rule engine.
4. Supply checkpoint results only from the accepted exact revision/load-combination/replay lineage. Include all committed member segments, zero/invalid placeholders and explicit loaded/receiving node IDs. Neutral system safety restraints may be sinks, with their reactions separately recorded and unscored. No manual solve is offered here; inspection never invokes the checkpoint service.
5. Feed the resolved reduced-motion setting and controlled suspension state. Pause/dispose on cover/quit as appropriate, invalidate stale shell callbacks and preserve domain state. Session 4 owns quit/navigation, turn/audio/avatar events and Workspace/store/menu/settings wiring. Safe zones here identify controls and inspector; also reserve current board interaction/public-result areas according to the shell/avatar policy.
6. After all sessions are integrated, update shared KB implementation status/links and reconcile the obsolete baseline MR19 text. **The user's latest prompt is implemented:** load-transfer direction toward receiving nodes/supports; tension/compression only controls colour/labels. This branch intentionally does not edit shared KB pages.

## Implemented behavior and numerical limits

The board uses 0..15 horizontal coordinates with separately supplied Z height. Fit includes the full board/model and active placement height. Targets retain off-axis and shorter Euclidean spans, fractional quarter ports and coincident identities. Distance fading is visual only; fixed picking corridors, depth cycling, keyboard traversal and native target selectors remain. Secondary clicks, orbit drags and multi-touch releases cannot select a placement accidentally.

The standard member is a lightweight rectangular axial/bending representation; authored width/depth and cable diameter support true-scale inspection and normal ×1.2 readability. Missing dimensions remain visibly schematic. The spring variants have identical two-endpoint-coil topology and distinct labels/colours, with k=0.25k₀ or 0.5k₀. The provided k₀ is displayed, never doubled by visual halves or altered in this module. Coils remain schematic; port positions stay analytical. No retired section/assembly families or additional foundations/repair props are introduced.

Node-only XYZ rotation glyphs show original restrictions, with separate safety badges/inspector records. Unknown masks do not assert released rotation. Setup pieces are labelled locked. The inspector reports owner/card/family, actual/max length, units, endpoints/quarters, original masks, k₀/multiplier/effective k, scoped checkpoint actions and separate system constraints/reactions. Axial-only families explicitly do not gain bending stiffness from a joint mask.

Primary direction is a **documented explanatory harmonic graph interpretation**, not a uniquely determined physical flow field: source potential 1, support/safety potential 0, interior action-weighted averages, vectors down the potential gradient on all participating branches. The graph weights come from supplied calculated action magnitude; axial sign independently styles tension/compression. The baseline adapter uses max(end-force norm, end-moment norm / physical length) in N so zero axial does not hide valid shear/bending. Different applied-load decompositions may need a supported selected-load view for defensible interpretation. Equal/conflicting boundaries, missing paths and bounded nonconvergence are explicit ambiguity.

Result lineage is conservative: invalid owners/endpoints/positions, missing/gapped/overlapping subdivisions, unknown evidence and compressive cables suppress affected scope; slack and zero displayed action do not move. No whole-member value is invented for absent segments. Stale checkpoints do not animate on current geometry and are labelled with their last turn/revision. Flow magnitude changes chevrons only. The scene never decides safety, penalties, repairs or foundation scoring.

## Validation and observed evidence

- `npm test -- apps/web/src/multiplayer/view`: **67 tests passed in 7 files**. Covers primary direction/branching independent of axial sign, zero-axial non-axial paths, ambiguity/stale/slack/zero/unknown evidence, valid and invalid subdivisions/aliases, spring geometry/caching/disposal, Euclidean targets/fading/depth identity, inspector permissions/non-mutation and loop/listener cleanup. A final inspector-label-only change also passed its focused 6 tests.
- `npm run typecheck`: passed for the full baseline plus new modules.
- `npm run build`: passed; existing main-entry bundle-size warning remains. The new components intentionally are not wired into that entry.
- Independently production-bundled `preview.html` through Vite's build API to `/tmp/dof-session3-preview-build`: passed (29 modules, ~791 kB uncompressed standalone JS including React/Three; bundle-size warning, not a failure). No config/manifests were edited.
- Ran `browser-check.mjs` against both dev preview and the standalone production bundle in headless Chromium with software WebGL. **1440×1000 and 390×844 checks passed**, no page errors/horizontal overflow. Checked persistent inspector and lock permissions, valid draft edit/overlength rejection, stale labels/hidden values, quarter target selection, keyboard-to-selector synchronization, true/readable sections, moving normal arrows and static reduced-motion arrows. Near-cursor salience was visually tightened after observing the dense target cloud.

Observed screenshots of the standalone production preview (synthetic evidence, not game/solver acceptance):

| Desktop inspector and flow | All-direction target cloud and cursor focus | Narrow draft inspector |
| --- | --- | --- |
| [desktop.png](session-3-evidence/desktop.png) | [targets.png](session-3-evidence/targets.png) | [narrow.png](session-3-evidence/narrow.png) |

The visible cloud browser automation returned “Browser Use could not read requirements”; native typing also failed with an AT-SPI provider error. The independent Chromium runner provided the successful observed WebGL evidence instead. Fallback rendering/lifecycle is covered by a no-WebGL renderer test. Hardware GPU performance, real-device touch/pinch and a complete integrated game are not claimed as tested.

## Accessibility and remaining limits

Native element/target selectors, keyboard target traversal/depth cycling/Enter and persistent panel controls provide alternatives to precision mouse picking. Inspector focus and Close/Escape return handling, text force-direction/style lists, labelled masks/status/provenance, reduced-motion static arrows and system-setting fallback avoid relying solely on motion or colour. WebGL failure retains schematic projected rendering with the same camera and interaction model; its thickness is explicitly not true-scale.

Production wiring, private hand/quit/handoff state, sound/turn-event choreography, canonical game/card/capacity values, final correction legality and real verified checkpoint acceptance remain owned by the other sessions. Fixture height=12, k₀=40000 N/m and displayed forces are synthetic examples. The optional voxel adapter is labelled experimental/unverified and does not supply spring physics/current connector laws. No hidden aliases between legacy families, scored safety reactions or accepted numerical results are invented. Future supported authored nonrectangular standard geometry would need an explicit section contract; retired playable families are not restored here.

For reproduction and the exact optional Playwright command/environment variables, use [view/README.md](../../apps/web/src/multiplayer/view/README.md) and [browser-check.mjs](../../apps/web/src/multiplayer/view/browser-check.mjs). No repository dependency changes are needed; this run installed Playwright only under `/tmp/dof-session3-browser`.
