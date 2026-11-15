---
title: "Structural Element Representation Criteria"
last_validated: 2026-11-15
validated_against:
  - docs/kb/game-completion-criteria.md
  - "Project owner element catalogue and geometry answers, 2026-11-14"
  - docs/kb/structural-solver.md
  - docs/kb/solver-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/placement-criteria.md
  - docs/kb/card-definition-criteria.md
  - docs/kb/joint-dof-criteria.md
  - apps/web/src/viewer/structureMeshes.ts
  - apps/web/src/viewer/sceneGeometry.ts
  - apps/web/src/solver/voxelSections.ts
owner: project owner
status: needs-review
---

# Structural Element Representation Criteria

## 1. Status and confirmed scope

**Current Grow Dusk implementation.** IPE and HEB use nominal web and flange dimensions with reference roll. The optional four-panel planar truss uses one parent mesh made from its real SHS chords, welded posts, pin-ended diagonals and terminal pieces. Its lower chord exposes three original quarter joints. Numerical and visual evidence for each family is recorded in [the ledger](criteria-ledger.md). The remaining requirements below describe target behavior.

**Criteria only.** This page specifies future geometry and presentation; it does not implement new meshes, cards, schemas, analytical elements or solver support. [Structural solver](structural-solver.md#required-element-catalogue-and-geometry-direction) records the catalogue and the boundary between geometry and physics. [3D viewer](3d-viewer.md) describes the current implementation.

The owner requires recognizable structural geometry rather than generic straight lines for columns, springs, trusses, trichord trusses, wide flanges, HSS, round HSS and cables. Follow-up decisions confirm:

- “Trusses” means **planar two-chord assemblies** with web members.
- “Trichord truss” means **three-chord assemblies with a triangular cross-section** and connecting web members.
- Standalone springs are **axial springs between two endpoints, shown as a helical coil**. Elastic joint connections are a separate concept.
- Default game sections are **slightly enlarged for readability**, with a **true-scale inspection mode**.

Recommendations below define a reviewable implementation target. Exact display factors, templates, dimensions, LOD budgets and solver/deck integration remain proposed until validated. Preserve existing glulam and other working families; the requested list is an extension, not a mandate to delete them.

## 2. Model distinctions and accuracy

Keep **structural role**, **cross-section**, **assembly topology** and **analytical formulation** separate. A column is a beam-column used in a column role; its section may be wide flange or HSS. A wide flange is a section, not inherently a beam or column. A truss assembly contains chords and webs; it is not the same object as one axial truss bar. Reorienting a member does not convert its section or analytically release its ends.

Generate geometry from a versioned definition shared by card preview, placement ghost, board, inspector and export where supported. Definition data should include stable definition/parent/member IDs, physical units, reference endpoints, local section frame/roll, section dimensions, material/finish, and explicit assembly or spring/cable parameters where relevant. Use metres for generated physical lengths and radians for stored roll, converting grid indices and any catalogue units exactly once at the boundary. The current voxel grid uses two-metre cells and its force properties use kN-based conventions; geometry must not silently mix those with the shared SI contract. Renderer preferences remain separate from physical model data.

Visual geometry must agree with the selected definition. Do not invent missing wall thicknesses, flange sizes, spring properties, truss panels, connectivity or cable rest lengths and then present them as accurate. Missing dimensions require an explicit approximate preview/placeholder label or an unavailable representation; unsupported analysis remains unsupported. Current catalogued A, Iy, Iz and J alone cannot uniquely reconstruct a section.

Use reference centerlines and section datums consistent with the solver. Define any eccentric offset explicitly; a mesh offset must not silently create an analytical lever arm. Catalogued properties may include fillets/manufacturing conventions while a lightweight mesh omits those details: record that simplification, retain the authoritative physical properties and never recompute solver stiffness from display triangles. Rounded-corner HSS, open-section torsion and cable/spring laws need proper definitions, not visual guesses.

## 3. Per-family geometry requirements

| Family | Required recognizable geometry | Parameters and lightweight construction |
| --- | --- | --- |
| Column | Solid surface representation of its actual chosen section, with readable height and roll; no generic pole substitution for every section | Reuse the beam-column section generator along reference endpoints. Section/frame is explicit; supports and connection hardware remain separate objects. |
| Axial spring | Continuous helical wire with a clear coil axis, body and short end leads to its two attachment interfaces | Define axial span/rest state, coil mean radius, wire radius, active turns, pitch and end treatment as applicable. Sweep a low-sided wire profile along a sampled helix; cache topology. An authored schematic coil is labelled schematic if physical coil dimensions are unavailable. |
| Planar truss | Two distinct chords with an authored pattern of web diagonals/verticals in one plane; open panels stay open | Define span, depth, panel count/positions, chord/web sections, panel pattern, supports/interfaces and assembly frame. Build chords/webs from shared section geometry, then instance or batch. Do not render as an opaque slab or a single fat bar. |
| Trichord truss | Three longitudinal chords at the vertices of a triangular cross-section, with clearly visible web members connecting the faces | Define triangle width/depth or vertex coordinates, apex orientation, span, panel layout, face bracing and chord/web sections. Reuse one assembly-local template with deterministic transforms. Three rails without connecting webs are insufficient. |
| Wide flange | An open I/H-shaped section: two flanges and one web, visibly oriented about its strong/weak axes | Define total depth, flange width/thickness, web thickness and optional fillet convention. Extrude a single indexed section outline, or use three shared boxes without visible coplanar overlap artifacts. Preserve open spaces; do not substitute a rectangle. |
| HSS, square/rectangular | Hollow square/rectangular tube with outer faces, wall thickness and an inner opening visible at exposed ends/cuts | Define width, depth, wall thickness and corner-radius convention. Extrude outer/inner contours or equivalent lightweight walls. End faces are material rims, not solid filled rectangles. Detail inner walls where visible; simplification must preserve the hollow end silhouette. |
| HSS, round | Hollow circular tube, distinct from a solid rod or cable; visible annular ends/cuts | Define outside diameter and wall thickness; use shared low-sided outer/inner cylindrical surfaces and annular rims. Increase radial segments for inspection rather than using a high-resolution cylinder everywhere. |
| Cable | Slender round surface following the authored reference or verified result curve, with explicit attachment locations | Define diameter, reference path, rest length/initial strain policy and any optional end fittings. Use a low-sided tube; prefer a shaded/normal-mapped strand suggestion over thousands of modeled wires. Draw only supported curvature/slack information as physical results. |

For straight prism families, render section faces and meaningful edges; flat line strokes may be an optional analytical-centerline overlay, never the default substitute for the member. A far-distance simplification is permitted only when projected detail is genuinely subpixel and full geometry returns on inspection.

Use mild bevels, fillet hints or material roughness only where they improve reading. Detailed weld beads, bolt threads, strand wires, casting textures and fabrication hardware are optional later polish, not required for this lightweight scope. Do not make every member shiny or rely on colour alone for family identity.

## 4. Springs, assemblies and cables: truth before decoration

### Axial springs

A drawn helix does not supply stiffness by itself. The solver needs an explicit axial law, stiffness units, rest length/initial deformation and supported tension/compression behavior. Coil radius/wire dimensions can define an actual mechanical spring only with a validated relationship and assumptions; otherwise the helix is an authored visual symbol with a stated status. Do not invent stiffness from a display coil or imply a torsional spring merely because the coil looks twisted.

In a valid deformation view, adjust the visual axial span/pitch consistently with the reported end displacement while preserving declared wire/coil conventions. Do not animate bouncing, contact, coil bind, buckling or dynamic response unless the relevant state/law exists. Impossible pitch, turn overlap or unrepresentable compression needs an explicit limit/visual warning, not silently inverted geometry.

### Truss assemblies

Keep one stable assembly/card parent identity and stable identities for constituent chords, webs, internal nodes and external connection interfaces. Define continuous chord segmentation and intentional web connections; crossing geometry alone transfers no force. External attachment points and local triangular/planar orientation must remain inspectable. Apply the [shared-joint freedoms rule](joint-dof-criteria.md#3-shared-joint-compatibility-and-revised-rules) wherever constituent ends intentionally meet at one joint.

A rendering mesh does not establish a solver formulation. Before numerical use, choose and validate either an explicitly expanded analytical assembly or an appropriate equivalent model with documented limits. Expansion must preserve parent identity, material/section properties, loads, self-weight and results mapping without double-counting. Never replace the whole assembly with an arbitrary beam stiffness because it looks beam-like.

Selecting an assembly should show its parent and component detail without implying every web is independently playable. Later owner decisions now authorize one assembly card using one element play and one connection card per external attachment, and require original-quarter-point interior attachments on every family. See [placement criteria](placement-criteria.md). Internal topology, valid quarter-port load transfer, capacities/costs and numerical mapping remain to define; appearance alone does not validate them.

### Cables

Keep diameter and attachment identity distinct from load-path overlay width. Taut straight reference cables may be represented by a straight tube. A sagging curve can be physically displayed only when authored as reference geometry or supplied by a compatible validated analysis, with the applicable state identified. A purely cosmetic slack icon/ghost must be labelled illustrative; do not turn every gravity-loaded cable into an invented catenary. No compression capacity, prestress, strand physics, snap or dynamic whip is inferred from geometry.

## 5. Physical scale, readable scale and orientation

The IPE and HEB viewer meshes use the nominal catalogue width, depth, web and flange dimensions with a 1.5× readable transverse scale. Their length and analytical properties retain their physical values. The 3D stick preview uses the same section orientation. [Five-presenter checks and scope](criteria-ledger.md)

Default game view uses modest section enlargement, visibly identified as **Readable sections**. Proposed initial factor: 1.5× transverse section dimensions, subject to playtesting. It affects display only. Keep physical span, endpoints, joint positions, reference topology and assembly chord spacing/depth unchanged. Scale section thicknesses consistently so I/H and hollow proportions remain recognizable; spring wire/coil readability needs a separately documented symbol policy to avoid changing its apparent analytical attachment span. Cable readability enlargement must be included in the legend.

Provide a **True scale** inspection mode restoring physical section dimensions, with numeric dimensions and an end-on section view. This should be a reversible inspection preference, not a model edit. Selection halos and generous invisible pick volumes may remain screen-scaled, but must not be presented as physical material. If a family uses schematic geometry because dimensions are missing, true-scale mode must say unavailable rather than certify its dimensions.

Use one documented right-handed member/assembly frame and stored roll, with Z up in world space. Derive extrusion direction from physical endpoints, with deterministic handling of vertical, diagonal and nearly parallel reference vectors. Avoid arbitrary roll flips when dragging, reordering endpoints, changing LOD or reloading. A wide flange's web orientation and a trichord's apex are physical definition data, not camera-facing decorations.

Physical mesh ends must reach the correct reference interfaces. Cosmetic connector clearances/cutbacks require an explicit visual offset and cannot create analytical offsets, rigid links or gaps. Keep separate coincident ends visibly distinguishable with selection/attachment indicators; do not fuse meshes in a way that falsely implies connectivity.

## 6. Geometry generation and levels of detail

Prefer compact procedural indexed geometry, reusable unit-length profile meshes and instance transforms. Cache by physical profile, detail tier and relevant authored parameters; share materials and repeated chord/web primitives. Rebuilding a colour, selection or result overlay should not reconstruct the entire structure's geometry.

LOD is driven by projected screen size and inspection state, with hysteresis to prevent flicker. It must preserve attachment positions, section/frame identity, assembly envelope and panel pattern. Do not change a truss's actual topology or spring's authored turn count merely to reduce triangles; use fewer radial/path samples, instancing and distant representations instead. Simplification never changes analytical input or physical results.

Proposed starting budgets, to validate rather than claim as proven:

| Primitive / scene | Proposed target |
| --- | --- |
| Straight wide flange or rectangular HSS | At most 200 triangles per visible normal-detail segment, excluding optional hardware. |
| Round HSS | 8–12 radial segments normally, 16–24 on close inspection; maintain inner opening when visible. |
| Cable | 6–8 radial segments normally; axial curve subdivisions tied to curvature/projected error, not fixed high density. |
| Spring wire | 4–6 radial segments and about 8–12 helix samples per turn normally; refine for selected inspection. |
| Truss / trichord | Budget and report total constituent geometry and draw calls, not only assembly parent count. Batch repeated chord/web profiles. |
| Normal board interaction | Target 60 fps on named supported hardware; measure p95 frame time with selection, DOF overlays and results active. |

A 1-pixel projected silhouette error is a proposed LOD tuning target, not permission to lose hollow ends or selected identity. Benchmark a representative board plus at least a 500-placed-object stress fixture, recording internal submember count, total triangles, draw calls, geometry/material memory, renderer/browser/hardware, viewport and LOD choices. A 500-truss scene is not comparable to 500 simple bars; report both placement count and expanded complexity. Establish lower-power profiles and degradation policy before accepting budgets. No performance result has been measured by this documentation.

Avoid expensive constructive solid geometry, per-wire cable meshes, per-member renderer instances and excessive transparency. Define resource ownership for shared geometry/materials; release them only when no live instance uses them. Loading, editing, undo where allowed, resetting, LOD changes and scene teardown must not leak resources or leave stale picking bounds.

## 7. Interaction, result overlays and view consistency

Use the same geometry definitions for cards, previews, ghost placement, committed board, selection and inspection. Each theme may vary palette/material finish, but must not flatten a wide flange into a box or convert an HSS tube into a solid capsule. Preserve existing timber geometry with its proper section as the new catalogue is added.

Selection should identify parent member/assembly and, where applicable, a constituent component. Broader pick volumes improve thin-member access without changing contact/connectivity rules. Provide accessible names, family/section labels, dimensions, material, roll and physical-versus-readable display state. Users must distinguish round HSS from cable and planar from trichord truss without relying on material colour.

Load, reaction, ownership, utilization and selection overlays must not overwrite physical section dimensions. In particular, load-path thickness is a separately labelled overlay, not a change in member size. Joint DOF glyphs anchor to real interfaces, not arbitrary decorative mesh vertices; hide or fade decorative detail before obscuring warnings, cards or essential endpoints.

Deformation uses available compatible analytical results. Mesh tessellation along a beam may interpolate a verified displacement field for display; it does not create extra analytical nodes. Endpoint translations alone are insufficient to invent bending, twist, local buckling or truss-component deformation. If only equivalent assembly results exist, show their valid scope rather than fabricate web-member forces. Label exaggerated deformation and preserve reference geometry. Unknown/unresolved results never become undeformed “safe” geometry or automatic breaking/Conkeldurr effects.

## 8. Acceptance criteria and delivery order

These are required future checks, not current test coverage.

| Fixture / action | Required evidence |
| --- | --- |
| Section gallery in all themes | Recognizable columns by actual section, I/H flanges/webs, hollow square/rectangular/round ends, helical spring, two-chord planar and triangular three-chord trusses, slender cable; no generic-line substitution. |
| Definition/dimension fixtures | Width/depth/diameter/wall/roll/assembly panel layout agree with inputs; invalid or incomplete geometry is explicit. Proposed true-scale dimensional error at most 0.5% for nonzero dimensions; documented absolute tolerances for endpoints/zeros. |
| Tube ends / clipping planes | Material rims and exposed inner opening remain correct; no filled-solid cap masquerading as HSS. |
| Rotated / vertical / reversed endpoints / save-reload | Stable frames, wide-flange strong-axis orientation and trichord apex; transformed physical envelope and IDs preserved. |
| Readable ↔ true scale | Correct indicator/dimensions; same endpoints, physical definitions, solver input, capacities and results. |
| Spring at valid/limit configurations | Correct span and coil identity; no invented stiffness, interpenetration treated as valid physics, or unsupported bouncing. |
| Assembly identity / joints / crossings | Parent-to-part mappings stable; intentional connections only; no unsupported new card or interface rules. |
| Cable authored/taut/slack/unknown views | Supported curve/state only; no invented catenary, compression or snap event. |
| Selection / ghost / card / committed view | Consistent section and frame; enlarged pick volumes do not connect or collide objects physically. |
| LOD / slicing / deformation / overlays | No visible identity/roll flicker, altered topology or hidden result-validity limits. Selected hollow/profile detail restored. |
| Stress / repeated edit and reset | Measured budgets and stable resource use; report expanded assembly complexity and visible overlay costs. |
| Unsupported solver family | Recognizable geometry does not become a claimed supported analysis; explicit diagnostic and no fabricated result. |

Recommended implementation stages: define versioned profiles/assembly data and solver-support boundaries; generate wide-flange/HSS/column geometry and true-scale inspection; add axial spring/planar/trichord/cable generators with explicit parameters; integrate selection, previews, joint interfaces and valid result fields; then validate LOD, accessibility, memory and performance. Update this page, [structural solver](structural-solver.md), [3D viewer](3d-viewer.md) and [development and testing](development-and-testing.md) as evidence is obtained. Implementation is deferred.

### Hollow-section implementation evidence

`viewer/sectionGeometry.ts` supplies a reusable square/rectangular hollow extrusion and the circular annular extrusion. Exposed ends are material rims with open bores and inward-facing inner walls. `viewer/structureMeshes.ts` uses them for standalone SHS/CHS members, and assemblies reuse the same rectangular profile. Catalogue wall thickness and section dimensions remain physical metres, with readable transverse enlargement separate from true scale and member length. Current SHS corners are sharp nominal corners. The generic rectangular generator accepts distinct width/depth, but this does not add a new playable RHS printing or numerical catalogue entry.

`components/SectionProfile.tsx` supplies an end-on physical section with width/depth, wall thickness, or web/flange dimensions in millimetres. The section profile is independent of board enlargement and uses open holes rather than filled tube ends. `viewer/sectionGeometry.test.ts` raycasts both exposed ends and the inner walls of square, rectangular and circular sections. It also checks independent true/readable scale. These are geometry/projection tests. Final browser readability, device performance and any newly authored physical printing require separate acceptance.

## 9. Open decisions

- Actual section dimensions/material families and whether named W/H sections are authored or drawn from a particular catalogue; treatment of fillets and tube corners.
- Spring stiffness/law, physical versus schematic coil dimensions, rest state and end attachments.
- Planar/trichord templates, panel layout, assembly end/quarter interfaces, internal analytical model and catalogue balance within the confirmed one-assembly-play/per-external-connection economy.
- Final readable enlargement factor, inspection workflow, LOD thresholds and supported-device budgets.
- Cable fittings and validated curve/deformation support; no additional cable physics is approved merely by this presentation request.

## 10. Later card and quarter-interface decisions

The owner subsequently authorized one planar/trichord assembly card per element play, with one card per external connection, and original-quarter-point attachment on every family including cables/springs. [Placement criteria](placement-criteria.md) define stable fractions, physical clashes, continuity and validated multi-port mapping. Update definition/card previews to expose real target ports; do not draw a trichord attachment in empty space or let a coil mesh certify a spring’s interior-load response. The visual requirements remain independent of numerical/card implementation.
