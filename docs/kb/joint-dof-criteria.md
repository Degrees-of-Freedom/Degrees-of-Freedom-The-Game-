---
title: "Joint Degrees of Freedom Visualization Criteria"
last_validated: 2026-11-14
validated_against:
  - docs/kb/game-completion-criteria.md
  - "Project owner joint-DOF visualization answers and shared-joint rule revision, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/animation-criteria.md
  - apps/web/src/game/turns.ts
  - apps/web/src/game/turnAnalysis.ts
  - packages/solver-contract/src/index.ts
owner: project owner
status: needs-review
---

# Joint Degrees of Freedom Visualization Criteria

## 1. Status and confirmed decisions

This is a criteria-only specification. No new overlay, control, joint rule enforcement or solver capability is implemented by this document. The visual recipes, sizes, timings and compatibility workflow below are proposals unless identified as confirmed.

The owner confirmed:

- A display control with **Selected joint / All joints / Off**, defaulting to **Selected joint**.
- **All member ends meeting at the same shared joint must use the same connection freedoms.** This explicitly replaces the earlier permission for different end-release profiles at one shared joint. End attachment identity and connection-card consumption remain separate concerns.
- Global X/Y/Z is the default presentation; local connection axes are available on selection.
- Glyphs are still normally; a brief movement demonstration may run on hover or selection, respecting reduced motion.
- Foundations are fully fixed by default: all six ground-restraint components are locked.
- Specify both permitted-motion visualization and solver-detected instability now, using clearly distinct overlays.

[Turn criteria](turn-criteria.md#3-deck-2-six-dof-connection-design) record the revised joint rule. [Solver criteria](solver-criteria.md) remain the numerical requirements; [animation criteria](animation-criteria.md) govern pacing, sound and accessibility. Changes to those requirements do not demonstrate implementation compliance.

## 2. What a glyph means

Every node has six potential components: translation `(UX, UY, UZ)` and rotation `(RX, RY, RZ)`. A glyph must identify its subject and reference, not simply claim “this joint can move.”

| Layer | What it describes | What it must not imply |
| --- | --- | --- |
| Connection permissions | Relative translation/rotation allowed between attached member ends and their shared joint, under the joint's common connection profile | Absolute movement in the world, a ground support, or structural stability |
| Foundation restraints | Joint motion relative to ground; default is all six components locked | That every incoming member end has a fixed/moment connector |
| Solver instability | Reported participating nodes/modes and classification for a specific analyzed model and result scope | A connection definition, actual collapse trajectory, or a future game penalty |

A fixed connection may move with the structure. A ball joint may exist in a stable triangulated structure. Six locked ground restraints prevent foundation motion but do not independently specify the end-release laws of attached members. Show connection and ground-restraint subjects separately when both exist; do not combine them into a misleading six-state summary.

A free connection component means no corresponding ideal transferred generalized force; locked means exact relative compatibility, not infinite strength; elastic means a specified force/motion law, not a percentage of freedom. An unused analytical rotation is neither a support nor automatically a mechanism. Inactive/not-applicable, unavailable and invalid/mixed legacy data need distinct labels rather than invented locked or free states.

## 3. Shared-joint compatibility and revised rules

“Meeting” means **intentionally attached to the same stable joint ID**, not merely sharing coordinates, crossing in space or overlapping on screen. Each member end still needs its own explicit connection attachment/card. An unattached coincident end remains unattached and must not inherit the joint's freedoms or ground restraint.

The common connection freedoms apply across all intentionally attached ends regardless of ownership. One member can still have different profiles at its two ends when they attach to different joints. Do not depict different releases for two attached ends of one compliant shared joint.

For anisotropic profiles, compatibility must include the **physical permitted directions**, not just matching names or six flags in differently rotated member frames. Two “hinge X” cards aligned to different world directions are not automatically equivalent. Proposed representation: one joint-owned canonical connection frame/profile, with explicit transformations to each incident member's analytical frame. This replaces the earlier proposal to define every connection frame independently from its member direction for joint-matching purposes. The final numerical relative-rotation convention remains a solver requirement.

Proposed placement workflow, preserving placed-card immutability:

1. A new joint's first attachment establishes its common profile/frame; show a provisional glyph while planning.
2. Before attaching another end, preview compatibility with the existing profile in physical axes.
3. Accept compatible freedoms. Reject an incompatible attachment with the conflicting axes identified; retain the draft/card and explain how to choose a compatible card or another joint.
4. Never upgrade, rotate or rewrite earlier connections to make an incoming card fit. Validate the complete transaction independently of staging order.

The first-attachment workflow and exact matching tolerances are recommendations, not newly confirmed deck rules. Elastic components must match the required free/locked/elastic category and physical directions. The owner confirmed that their stiffness values may differ; store and analyze each connector’s actual stiffness rather than imposing equality or averaging them. Capacity remains distinct from kinematic freedom; identical freedoms do not establish identical strength. Do not silently choose stiffness/capacity combination rules.

Legacy saves with mixed profiles must show **incompatible joint profiles**, identify the affected ends and avoid a false unified glyph. Migration/rejection rules and setup-profile establishment require design before enforcement. Preserve old data; do not silently coerce profiles or connect coincident geometry. Configurable support masks outside the default game remain explicit overrides, never rendered as fully fixed merely because the object is called a foundation.

## 4. Proposed visual grammar: a small motion compass

Anchor one compact glyph to the shared joint, with a central dot and three colour-coded axes. Use straight arrows for translation and curved arrows for rotation. Keep a stable screen-space size rather than allowing distant glyphs to disappear or near ones to engulf the board.

- **Translation:** a short double-headed vector along each axis, explaining positive and negative permitted displacement. Label selected details `UX`, `UY`, `UZ` and use plain text such as “Translate along X.”
- **Rotation:** an open, double-ended curved arc around each axis, in its perpendicular plane. `RX` lies in the YZ plane, `RY` in XZ, `RZ` in XY. These are twists about the axes, not circular travel of the entire joint.
- **Axis identity:** proposed X red/coral, Y green, Z blue, always backed by letters. A small global reference triad states **Z up**. Choose theme-specific contrast values after review.
- **Two readable scales:** compact glyphs on the board; a larger six-component inspector on selection. The inspector uses two rows, Translation and Rotation, each with X/Y/Z cells, status words and optional stiffness values/units.

| State | Proposed glyph treatment | Plain-language label |
| --- | --- | --- |
| Free | Open arrow path with clearly visible heads; rotational arc without a stop marker | Free — permits relative motion |
| Locked | Same axis identity, terminated by a short perpendicular stop bar and small lock/block symbol | Locked — prevents relative motion |
| Elastic | Small zigzag along a translation path or spring/coil accent on a rotation arc | Elastic — resists relative motion; show stiffness and units when defined |
| Inactive / not applicable | Neutral small dash with an explicit inspector explanation | Inactive in this formulation; do not call it restrained |
| Unknown / unavailable | Question-mark badge and neutral placeholder, no confident arrow state | Not available |
| Incompatible profiles | Split-profile warning badge, no fabricated common state | Conflicting attached-end freedoms |

Retain all six entries in the inspector even when board glyphs are simplified. When elastic values differ across attached ends, the common glyph says “elastic — stiffness varies”; selecting a connector shows its actual values/units. Do not display a fabricated common stiffness or infer it by averaging. Locked components should remain legible rather than disappear; absence must not mean locked. Colour identifies axis, shape identifies state, and text explains meaning. Keep selection accent, player identity, result warning and axis colours distinguishable without relying on colour alone. Do not encode stiffness by an arbitrary spring length or opacity without a numerical legend.

Foundation detail is a separate **Ground restraints** row/group with an anchored-base icon and six lock marks by default. If connection permissions are also inspected at that foundation, label both groups explicitly. A fully fixed base and a ball connection are representable without contradiction.

## 5. Global and local views

Default global X/Y/Z arrows remain aligned to the model's world axes as the camera orbits. The camera may change projected directions; it does not change the laws. Labels face the viewer while vectors/arcs retain their physical orientation. The optional selected-joint local view shows the stored connection frame, its orientation and an unmistakable **Local connection axes** label; switching is a view preference only.

A rotated anisotropic connection may couple global components. Never copy local free/locked/elastic flags directly onto global axes or classify the diagonal of a transformed stiffness matrix as six independent laws. Show the global reference triad and actual permitted direction/subspace, mark affected global inspector cells **coupled**, and provide the selected local view for independent component details. Where the current contract cannot supply a reliable transformation, show unavailable/coupled details rather than guessing. Default isotropic fixed and ball presets remain straightforward in either frame.

Preserve global/member/joint IDs and full physical axis transformations through camera changes, member order reversal and save/reload. Demonstration arrows show both permitted signs. A separate tiny positive-sense reference may use the right-hand rule, but must not resemble applied force or moment arrows.

## 6. Controls, clutter and interaction

Expose a clearly labelled **Joint DOFs** three-way control: Selected joint / All joints / Off. Default to Selected joint on first use; persist an explicit preference independently of the saved structural model. With no selected joint, do not invent a selection; provide a short selection hint. Off removes this layer and its automatic motion demonstrations, not the separate instability layer.

All joints shows one glyph per intentional joint, not one per attached end. When coincident but distinct joints project together, provide stacked-count/disambiguation selection; do not merge identities. Selected-joint details take precedence over background glyphs. In dense scenes use collision-aware label placement, quiet background glyphs and visible counts for clustered/culled glyphs; All joints must not silently omit joints or conceal unavailable data. Allow inspection of every joint through the list/inspector.

Proposed sizes: 36–48 CSS pixels for compact glyphs, 72–96 pixels for selected expansion, with accessible hit targets of at least 24 × 24 CSS pixels. These require viewport/zoom playtesting. Expand details through a deliberate click/tap or keyboard selection; hover alone must not be required. Keep hit targets stable during demonstration. These glyphs are explanatory, not draggable transform handles and not a shortcut to edit immutable placed connectors.

Use depth fading and restrained hidden-line treatment, with an optional selected-joint leader/callout when occluded. Explain hidden-line styling in the legend; never reuse it to mean free or elastic. Avoid a permanent X-ray overlay across the whole structure. Handle near-axis camera alignment with readable callouts or the inspector rather than rotating the physical glyph to look better.

## 7. Separate solver-instability overlay

Provide an independent **Instability** control with Off / Static / Play mode (names provisional), default Off. Do not overload Joint DOFs settings to toggle both meanings. Both layers may coexist with separate legends: **connection permissions** versus **solver result**.

- Use a distinct warning outline/halo, component shading and labelled ghosted mode shape, not recoloured permission arrows. Keep labels for mechanism, rigid-body motion, near-mechanism or other classifications only when the solver supplies them.
- Show model/result version, source/fidelity (including **experimental**), valid scope, reason and selected mode index/count. Do not claim localized modes when only a global warning exists.
- Start with a static illustration. Explicit Play animates a bounded ghost about the reference geometry; Pause, Stop and mode selection remain available. Reduced motion uses static snapshots.
- Mode amplitudes and sign/basis may be arbitrary. Label **illustrative normalized mode — exaggerated, not predicted displacement or collapse**. Distinguish translational and rotational participation without inventing missing rotational data.
- Treat multiple modes as a space/basis, not unique identities or independent physical events. Never turn the count of free connection axes into a mechanism count.
- Unknown, stale, unsupported or unresolved scopes remain explicitly unavailable. Invalidate/hide obsolete result motion after a topology change; historic results must be labelled historic and shown against their own model only.
- Regularization/artificial springs, unused DOFs and solver limitations must not become physical support glyphs or false stability claims. Absence of reported modes is not proof of stability.
- Neither overlay changes topology, loads, constraints, scoring or failure state. No penalty, breaking or Conkeldurr reaction follows merely from toggling or demonstrating a glyph.

## 8. Animation, accessibility and performance

Keep routine glyphs still. Proposed hover/selection demonstration: one 400–700 ms cycle of a small arrow/arc or detached ghost, never movement of committed structural geometry. A stopped/locked component gets a static stop cue, not a motion that suggests release. Elastic demonstrations are labelled schematic and do not purport to show a computed displacement. No infinite pulsing or audio on every joint hover. An explicit replay action can repeat a demonstration.

Respect reduced motion, optional glow/pulse and master mute from [animation criteria](animation-criteria.md). Provide text equivalents, keyboard traversal/selection, touch access, readable contrast at supported scales and polite announcements of meaningful state changes. Warning meanings survive grayscale, muted audio and effects off. Do not steal focus or hide error text under animated glyphs.

Render read-only projections from versioned joint definitions and solver results, not fresh physics inferred in the viewer. Avoid duplicated rule logic; the game validates profile compatibility and the solver reports modes. Budget draw calls, labels, occlusion and allocations alongside the main scene and avatar. Batch repeated primitives where useful; do not build a separate renderer per glyph. Compare Selected/All/Off and Static/Play on documented hardware and scene sizes before claiming a performance gate. No implementation or benchmark result is established here.

## 9. Acceptance scenarios and delivery order

| Scenario | Required result |
| --- | --- |
| First visit / preference reload / no selection | Selected default; explicit preference restored; clear selection hint. Off removes only its own overlay. |
| Fixed, ball, hinge, slider and elastic fixtures | All six states readable; correct straight/curved directions and local/global meaning. No force/moment-arrow ambiguity. |
| Foundation with connection release | Six ground locks by default; connector freedoms shown separately; custom support override remains explicit. |
| Two or more ends at one joint | One consistent common profile. Incompatible staged profiles rejected under the configured game policy; no silent existing-card edits. |
| Rotated hinge / member reversal / rigid coordinate rotation | Physical compatible axes preserved; global coupling represented truthfully; local view explains the law. |
| Coincident unattached ends / distinct joint IDs | No inherited connection, accidental shared glyph or leaked ground restraint; identities selectable. |
| Mixed-profile legacy save | Explicit conflict and affected ends; no fabricated common state or silent migration. |
| Stable truss with free rotations / rigid ungrounded frame | Permission glyph does not claim stability; solver result layer independently communicates available evidence. |
| Multiple or rotational-only modes | Correct mode scope/count, available components, normalized/exaggerated label and playback controls. |
| Unknown / stale / experimental result | Clear provenance/unavailability; no fabricated mode or false stability; edits stop stale playback. |
| Dense / occluded / axis-aligned / narrow screen | Every joint remains inspectable; labels/counts truthful; essential controls stay visible. |
| Keyboard / touch / reduced motion / effects off | Equivalent information and stable interaction without hover, colour, sound or motion dependency. |
| Toggle / demonstration / skip / replay | Zero mutations to structural model, cards, solver configuration, penalties or scores. |

Recommended later implementation order: reconcile shared-joint schema/validation and legacy policy; implement static permission glyphs and inspector; add global/local transforms and dense-scene handling; add separately scoped static mode results; then bounded motion/accessibility/performance validation. Each stage needs evidence and KB updates. This criteria change does not authorize shipping an unsupported physics interpretation.

## 10. Open decisions and current gaps

- Elastic stiffness equality is not required; numerical tolerance for matching directions/freedom states, capacity treatment and any coupled connection laws still need definition.
- Final canonical joint-frame initialization, profile establishment and compatibility tolerances; handling existing mixed-profile saves and setup joints.
- Visual approval of sizes, colours, labels, occlusion treatment and demonstration amplitudes after playtesting.
- Solver support for valid component-scoped modes, transformed connection laws and reliable near-mechanism grading. Do not manufacture these from current limited results.

Current Shared table stores connection profiles per end (`fixed`/`ball`) and does not enforce the newly confirmed uniform-profile rule at a shared joint. The preliminary shared contract likewise supports fixed/pinned ends, not arbitrary six-axis elastic laws or a canonical joint profile. Existing joint markers/result overlays are not evidence that this specification is implemented. See [3D viewer](3d-viewer.md), [structural solver](structural-solver.md) and the [gap analysis](solver-criteria-gap-analysis.md) for implementation context.

## 11. Quarter ports and common interface freedoms

The later [placement criteria](placement-criteria.md) require original-reference quarter interfaces on all element families. A port is not automatically a ground support or free connector: incoming attachments still consume cards and must match the common interface freedoms. Explicit internal parent continuity must survive analytical subdivision; do not apply an incoming release law to split the original member into unintended hinges. Distinguish internal continuity from external attachment laws in the schema/inspector. Physical clashes use reference geometry, not this glyph’s visual volume.
