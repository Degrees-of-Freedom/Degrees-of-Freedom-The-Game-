---
title: "Structural Element Representation Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/visualization-criteria.md
owner: project owner
status: needs-review
---

# Structural Element Representation Criteria

## 1. Current scope and status

The [multiplayer refresh](multiplayer-refresh-criteria.md) supersedes the former wide catalogue. Only one standard axial/bending beam-column, one tension-only cable and two spring stiffness variants are playable. No planar/trichord assemblies or multiple wide-flange/HSS/timber/material card families. A starting column is the locked setup use of the standard member, not another drawable family. Criteria only; no generator is implemented by this document.

## 2. Lightweight accurate geometry

Generate recognizable surfaces from one versioned standard section/material definition and physical endpoints/frame; do not render every piece as a generic screen-space line. Keep section dimensions, roll, units and meaningful end shape correct. A normal readable-section enlargement and true-scale inspection are view-only; neither changes physical endpoints, maximum lengths, capacities or solver inputs. Actual standard section/material dimensions remain authored data, not an arbitrary player selector.

Use indexed procedural geometry, shared materials/meshes, cached topology, instancing where appropriate and screen-size LOD with hysteresis. Do not rebuild all geometry for a hover/colour/inspector change. Preserve physical identity/roll and selected detail at all LODs. Broader section generators may remain internal/legacy, but are not required current card variants.

Cable is slender round geometry with explicit endpoints and only valid authored/result curvature. Do not invent sag, compression or snapping physics. Display paired axial vectors as a separate overlay: tension centre-to-nodes, compression nodes-to-centre, based on verified axial sign. A slack cable has no moving axial vectors.

## 3. Two endpoint spring coils

Both spring variants use **two simple coils, one extending from each end toward the span interior**, with one parent element and explicit attachment identity. Keep both coil ends visually connected through a readable central continuation or clear continuous spring-body convention; no apparent disconnected gap. Use few tube sides/path samples, shared templates and selection-time refinement. Do not revive the old single full-span high-detail coil as the required silhouette.

Visual halves do not become two analytical elements in parallel/series and do not double/halve stiffness. The analytical law stays k = 0.25k₀ or 0.5k₀, with reference k₀ in N/m; coil size/turn count is not a stiffness calculation. Quarter points refer to original analytical reference span/ports, not a random helix vertex. Physical/schematic coil parameters and true-scale availability must be explicit. No new contact/bouncing/coil-binding law is implied.

## 4. Node-only connections and safety corrections

Render player connections only at their joint/node with a compact rotational DOF glyph for the 1-, 2- or 3-axis mask. No large per-end connector meshes, slider/spring translation icons or added support columns. Inspector can select individual end/card records without drawing their hardware. Starting foundation/column appears fully fixed/locked.

Minimum system safety restraints are a distinct node-local override badge, with original/effective rotational state and any required system-only translational correction visible in detail. They are not additional foundation or prop geometry. No auto-fixer draws a column straight down. Do not allow decoration or enlarged pick geometry to create physical connectivity/clash exceptions.

## 5. Lengths, board and picking

Reference member maxima are 5, 7 or 10 lattice units; actual permitted shorter spans and diagonals use Euclidean length. The 15×15 horizontal field/camera/fit and target strategy must handle these lengths without per-frame mesh churn. Quarter targets may lie between base lattice points and must not drift when display geometry is resized/deformed.

Nearby legal snap targets are bold and clear; distant targets fade by pointer distance. Current/armed/keyboard-selected targets remain visible and hit identity stable. Do not show only principal spokes when another in-range grid point is legal. Overlapping depth candidates have explicit cycle/list access.

## 6. Result and scale truth

Use valid solver data and formulation-compatible interpolation for deformed geometry; do not invent beam curves or intermediate forces from endpoint positions alone. Label visual exaggeration, unsolved current topology and historical result scope. Between scheduled checkpoints do not animate old forces on a new structure as current. Section thickness is not load-path magnitude. Unknown is not zero/safe.

## 7. Performance and lifecycle

Reuse resources and dispose only after final owner release; avoid one renderer per member/glyph, individual cable strands or high-detail repeated spring meshes. Benchmark the 15×15 board at published maximum hand/placed-object workloads with targets, inspector, DOFs, paths and roaming avatar enabled. Report draw calls, triangles, memory, p95 frame time and expanded target counts on named hardware. Existing 60 fps/latency targets require evidence, not smaller physics fidelity.

## 8. Acceptance criteria and delivery order

Fixtures must cover: only four current variants; standard section orientation and locked setup; two coils at both spring ends with unchanged single-element k; shorter/diagonal 5/7/10 cards; physical versus readable scale; correct original-quarter mapping; node-only rotational masks; no downward correction columns/new foundations; near-bold/far-faded picking with depth disambiguation; checkpoint freshness; tension-out/compression-in vectors with zero/slack/unknown cases; correct disposal and supported viewport/input performance. Implement definitions before geometry, then inspection/picking and truthful result overlays.

## 9. Open parameters

Standard section/material/capacity and k₀ values, coil template dimensions/central continuation, vertical board extent, supported performance budgets and exact visual sizes remain authored/reviewed parameters. Do not restore retired truss/section families to satisfy historical gallery fixtures.
