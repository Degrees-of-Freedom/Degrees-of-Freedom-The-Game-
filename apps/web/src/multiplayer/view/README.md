# Multiplayer scene and inspector boundary

Session 3 implementation from shared baseline `bbe4c44`. Import production exports from `./index`. The independent preview is **synthetic display evidence**, not a solver fixture or saved-match authority. This module does not import a store, execute structural analysis, consume cards, commit turns, determine scores, navigate or modify shared rules.

## Integration

```tsx
const [selection, select] = useState<ViewSelection>(null);
const scene = useRef<SceneHandle>(null);

<MultiplayerScene
  ref={scene}
  data={publicView} // immutable projection of the authoritative model/checkpoint
  selection={selection}
  onSelectionChange={select}
  placement={activeDraftPlacement}
  onTargetActivate={target => dispatchValidatedDraftTarget(target)}
  paused={coveredOrQuitting}
  reducedMotion={resolvedMotionPreference}
  onSafeZones={setSceneSafeZones}
/>
<ElementInspector
  data={publicView}
  memberId={selection?.kind === 'member' ? selection.id : null}
  onClose={() => select(null)}
  onDraftChange={(id, edit) => dispatchValidatedDraftEdit(id, edit)}
  onSafeZone={setInspectorSafeZone}
/>
```

`MultiplayerViewData`, `PlacementView`, callback and lifecycle types are in `types.ts`. There are no peer-session imports. Supply only public information: no private card arrays are accepted or needed. Session 4 owns routing/Workspace and conversion from the finished domain/checkpoint APIs. Treat callbacks as requests, validate them against the current authoritative revision, and pass a new immutable view. The local draft guard only checks permissions, finite coordinates, positive Euclidean span, board bounds and printed maximum; it cannot establish clashes or attachment legality. Inject `placement.isLegal` for those rules. Without that predicate the targets are geometric candidates, not proof that a move can be committed.

The board is Z-up, 15 horizontal cells in X and Y (0..15 inclusive). Height and metres per game unit are required view data, displayed in the scene. Member positions/widths/quarter ports use game units; forces/stiffness retain their declared display units. Quarter ports are on original reference spans, never coil vertices. `nodeId` can explicitly identify a port's attached-joint alias. Coincident geometry never creates topology.

Members accept only `member`, `cable`, `spring-025`, `spring-05`. Authored rectangular member width/depth and cable diameter (section width) can be rendered at true scale; normal mode enlarges these by 1.2. Missing dimensions use explicitly schematic defaults and disable true-scale selection. Spring coils always remain schematic and form one continuous visual wire representing **one** analytical spring. `rollRadians` rotates the authored section around its reference axis. Cached low-poly meshes/materials are shared within a scene; target overlay points use one canvas, not thousands of meshes. Flow magnitude affects chevrons only.

One glyph at each shown joint depicts the **original** global rotational mask: slash = restrained; curved arrow = free. Unknown masks show a question mark without asserting a release. Separate amber S records identify system safety overrides; the inspector reports their axes, reason, original turn, checkpoint, verification and neutral reaction. Setup flags lock properties and label original bases/columns; the renderer adds no repair columns or foundations. Cable/spring rotation masks do not invent bending stiffness.

## Results and primary flow

The latest user prompt supersedes the baseline's obsolete MR19 midpoint tension/compression animation. Vectors now travel toward receiving nodes/supports according to a documented **explanatory force-weighted harmonic graph interpretation**: loaded nodes have potential 1, receiving support/safety sinks 0, interior potentials are action-weighted averages, arrows follow decreasing potential. All participating branches remain. This is not a second structural solve, an equilibrium proof, a score or unique physical load attribution. It is calculated only when the view/checkpoint changes. Axial sign independently chooses tension/compression colour; zero axial with valid shear/moment-derived action can still flow.

The injected checkpoint must identify the exact revision, provenance, combination/load scope, all segment actions (including zero/invalid placeholders), and intentional source/sink IDs. Segment IDs belong to members and endpoints must resolve to their explicit original span/port/joint positions. Missing/gapped/overlapping scopes, unknown endpoints, conflicting identities, drafts, invalid evidence and compressive cables cannot animate as valid routes. Slack/zero action is stationary. Mixed-source boundaries, equal potentials and unsupported/nonconverged components are disclosed as ambiguous. A supported selected-load view can supply a more defensible scope; do not silently omit branches to obtain arrows. Stale checkpoints are suppressed on current geometry and labelled with their original turn/revision. See `flow.ts` and `renderingPolicy.ts` for exact assumptions and tolerances.

`adaptBaselineGame` is an optional pure migration adapter. It requires an explicit single old solid family and explicit owner/card/5-or-7-or-10 metadata; unsupported old families are diagnosed rather than silently reclassified. Baseline voxel evidence is always labelled experimental/unverified. The adapter converts kN to N, uses `max(end-force norm, end-moment norm / physical length)` as a force-equivalent overlay weight, and preserves baseline positive-tension sign independently of path direction. It does not provide springs or authorize current rules. Default sources include equivalent selfweight; source/support overlap intentionally produces ambiguity. Supplying an accepted result never rebrands this experimental solver as verified.

## Input, lifecycle and accessibility

Drag/orbit, right-drag/pan, wheel/pinch/zoom and Fit are available. Snap opacity/size fade smoothly with screen distance but picking uses a fixed reach; focused targets remain bold. Arrow keys traverse every target; brackets cycle coincident projected depths; Enter requests the focused target. Native Inspect/Legal target selectors and Use target give keyboard/touch alternatives. Primary clicks alone pick; secondary buttons, drags and multi-touch release do not play targets. The inspector is persistent, focuses on opening, restores its trigger on Close/Escape, and exposes only draft endpoint editing through callbacks. It never analyzes or commits.

`paused` stops the loop and canvas input; the ref provides immediate `fit/pause/resume/dispose`. Prefer controlled `paused` for persistent shell state. Dispose is idempotent, removes listeners/observers, cancels RAF and disposes shared GPU resources; unmount also invokes `onDispose` as a presentation notification only. Safe-zone coordinates are viewport rectangles refreshed on resize/scroll; combine scene and inspector zones in the shell before avatar placement. Reduced motion defaults to the system query when no explicit preference is passed and draws static directional arrows. Accessible text lists each segment's direction/reason/style without relying on colour. No audio or turn-event authority lives here.

WebGL failure/context loss retains camera navigation, selection and schematic projected rendering using the same camera in a 2D fallback. Fallback thickness is explicitly schematic, even if true-scale sections were requested.

## Preview and validation

Run `npm ci --cache /tmp/dof-npm-cache`, then `npm run dev -w @dof/web -- --host 0.0.0.0 --port 5174`; open `/src/multiplayer/view/preview.html`. This dev-only entry is not linked from production or included by the main Vite entry. The synthetic k₀/height are labelled fixture values, not finalized game parameters.

Run `npm test -- apps/web/src/multiplayer/view`, `npm run typecheck`, `npm run build`. Optional browser checks use `browser-check.mjs` with a separately installed Playwright module, `DOF_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node apps/web/src/multiplayer/view/browser-check.mjs`. `DOF_CHROMIUM`, `DOF_VIEW_URL` and `DOF_VIEW_EVIDENCE` override defaults. No new repository dependencies/manifests are required. See the session-3 handoff for measured evidence and integration limits.
