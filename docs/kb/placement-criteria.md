---
title: "Placement and Connection Legality Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/card-definition-criteria.md
  - docs/kb/solver-criteria.md
owner: project owner
status: needs-review
---

# Placement and Connection Legality Criteria

## 1. Confirmed decisions and implementation status

Criteria only; no new placement, clash, assembly or quarter-subdivision behavior is implemented here. The owner confirmed:

- 3D grid endpoints, including diagonals, within printed card lengths/orientations.
- Interior attachment only at **quarter points**: 25%, 50% and 75% of the original reference span.
- Every element family, including cables and springs, must support quarter-point attachments in the target game.
- Unconnected elements are permitted, but **physical clashes are not**.
- One planar-truss or trichord assembly card places one complete assembly using one element play; each external attachment requires its own connection card. This explicitly supersedes the earlier one-member-only prohibition for those assembly cards.

Existing shared access, immutable placed connectors, same connection freedoms at a joint, setup-only fixed foundations and independent 1/1/2 play maxima remain in force. A legal structure may be unsupported, unstable or overloaded; physical adversity is not placement illegality. New numerical interpretations must satisfy [solver criteria](solver-criteria.md).

## 2. Reference geometry and target identity

Declare grid origin, spacing, board limits, terrain/obstacles and geometric tolerances in the ruleset. Normal free endpoint placement uses that 3D grid. Diagonal member length is physical Euclidean reference distance, not Manhattan distance or maximum coordinate difference, unless a card explicitly defines a different printed restriction. Card authoring must state any discrete length/orientation options. Zero-length, nonfinite, out-of-bounds or physically invalid geometry is rejected with a specific explanation.

Quarter ports are an explicit exception to grid-only endpoint locations: an endpoint may target a permitted quarter point even if it falls between base-grid nodes. Never round it to the grid. For a straight original reference segment A–B, the location is `A + q * (B - A)` for exact q in `{1/4, 1/2, 3/4}`. Endpoints remain fractions 0 and 1. Store parent ID and rational fraction, not a repeatedly rounded coordinate.

Always reference the original placed parent, including after analytical subdivision, deformation or save/reload. Quartering an already subdivided segment must not create new 1/16 attachment stations. For a supported authored curved reference path, define its station measure explicitly (proposed reference arc length); a deformed cable's current length cannot silently move a committed attachment. Assembly quarter stations reference the parent span/frame and resolve to explicit physical ports/load paths, not a point in the empty center of a triangular truss.

Coincidence is not connectivity. Track distinct end, port and joint IDs, including multiple unattached ends at the same coordinates. Attaching is an intentional card action to a declared interface, never a side effect of snapping, crossing, clash detection, mesh merging or a loaded node appearing nearby.

## 3. Quarter attachments and analytical continuity

Before accepting a quarter attachment, materialize a stable port/joint on the parent and map it to compatible analytical interfaces. The incoming end consumes one connector card. Creating the target port must not consume the parent's card again, release its continuity, add a free foundation or silently grant ground fixity. Multiple incoming ends may share the same quarter port when geometry/capacity/connection rules permit; do not create duplicate coincident analytical nodes for one intended joint.

Preserve the parent's original properties, rest state, loads, mass and capacities through subdivision. Continuous original segments are internal parts of the same member, not newly played ends that automatically receive hinge releases. Common-freedoms matching applies to intentional incoming attachment laws at the shared interface; analytical internal continuity remains explicitly represented. Joint/port schema and solver adapters must make this distinction inspectable, not infer it from geometry. A load-card target at an activated quarter joint is a proposed eligible load target under the same persistence/identity rules; final target definitions must be printed/versioned.

| Parent family | Required quarter-attachment support before scored play |
| --- | --- |
| Frame/column/section member | Compatible subdivision preserving continuous bending/axial/torsional behavior, section roll, parent identity, distributed/equivalent load accounting and end releases. |
| Planar/trichord assembly | Authored or validated quarter-station interface tied to actual chord/web topology. Define eccentricity, load transfer and constituent subdivision; no invisible arbitrary stiff link to empty space. |
| Cable | Intermediate nodes and compatible tension-only segmented formulation preserving reference/rest length or initial strain, active/slack states and load/mass accounting. A cosmetic kink is not validated equilibrium. |
| Axial spring | Defined multi-port/segmented axial law, rest-state and force mapping with validated two-terminal equivalence and interior loading behavior. A scalar two-end spring or physical coil mesh alone does not establish correct intermediate-load response. |

All families are required by the confirmed target scope; silently excluding cables/springs from the final feature is not compliance. Until each has validated semantics, label the capability unavailable and do not claim a fully compliant scored release. Do not invent spring segment stiffness/rest lengths or cable prestress simply to make a quarter marker appear usable.

## 4. Clashes versus intentional contact

Evaluate physical reference geometry/declared clearance envelopes, not enlarged readable meshes, selection halos, load arrows, DOF glyphs or deformation illustrations. Projected crossings at different depths can be legal. A same-location intersection of material is a clash unless it lies in a deliberately permitted, defined attachment/contact region. Unconnected geometry cannot pass through another physical member merely because the solver has no contact law.

Use broad-phase bounds followed by suitable narrow-phase profile/assembly checks. A bounding-box overlap is a candidate, not final proof of a clash; hollow spaces and truss panels require an appropriate exact or explicitly conservative envelope policy. Define required clearances and tolerances so near-touching behavior is deterministic. The legality check must not introduce contact forces or friction into the solver.

Authorized end/quarter connections may have specified insertion/cutback/fitting envelopes; they cannot exempt the rest of either member from clashes. Define fitting capacity/space for multiple concurrent attachments. Spring coil and cable envelopes follow declared physical/reference geometry; incomplete schematic geometry cannot certify clash clearance. Check terrain, assembly constituents and all staged additions, not just the new parent centerline. Exact overlapping duplicate members are proposed illegal rather than a hidden stiffness-stacking exploit.

The initial clash policy concerns undeformed reference placement. Do not reinterpret ghost modes or enlarged deformation as illegal retroactive placements. If deformed contact is later gameplay, it requires a separate rule and validated physics. The board must clearly identify the two conflicting physical objects/regions and retain the rejected card/draft.

## 5. Attachment transaction and immutable joint rules

Preview card ownership, allowed target/port, endpoint, physical orientation, common-joint compatibility and clashes before staging; repeat validation against the complete draft and current parent revision at commit. Provisional allowed errors must not become committed invalid states. Staging order cannot determine the final legality of an otherwise identical complete transaction.

An incoming connection cannot edit/reorient/upgrade older placed connectors. A first-attachment profile-establishment workflow remains proposed until specified; all accepted connections must meet the latest matching policy. A connection attaches one external end/port; one card never joins every assembly end. Internal assembly joints authored in its definition do not consume new player connector cards. More than two newly played external connectors requires a later turn; incomplete staged/committed connectivity is allowed if all other rules are met.

Shared access permits targeting opponents' eligible joints/quarter ports. It does not permit moving their objects, changing foundation ownership, replacing connectors, editing printed definitions or removing persistent loads. Foundations remain setup-only. Distinguish stale drafts, invalid geometry and forbidden actions from verified physical issues; invalid actions do not receive physical penalties.

## 6. Acceptance and open parameters

| Fixture | Required result |
| --- | --- |
| Diagonal / board edge / printed length | Correct physical distance and stated card/grid restrictions, actionable rejection. |
| Quarter point between grid nodes / diagonal parent | Exact original-reference fraction; no snapping drift, recursive quartering or unintended joint. |
| Frame, cable, spring and both assembly types | Valid interface/analytical mapping, continuity/rest state, loads/mass and parent identity preserved. |
| Assembly play and 0/1/2 external attachments | One element play, one connector per attachment, no free cross-player or foundation connection. |
| Crossing projection / material clash / hollow space | Correct physical/reference policy, no dependence on mesh readability or camera. |
| Intentional joint insertion / multiple attachments | Defined contact envelope, no blanket collision bypass or silent incompatible profile. |
| Preview, reorder, retry, save-reload | Same legality/topology and stable port IDs; no penalty for an invalid input. |

Open: grid/board preset and tolerances, actual clearance/fitting rules, quarter-port analytical laws, spring multi-port behavior, assembly station ports, load-target details, first-profile establishment and legacy migration. These are release blockers for the dependent claims, not permission to silently approximate them.

## 7. Explicit system-correction boundary

The owner now authorizes recorded game-owned automatic repair for instability and overload, preserving player moves. It does not legalize an invalid player draft, delete loads, upgrade immutable player connectors or silently waive clash/quarter/common-freedom rules. System objects must have a declared physical/attachment policy, ownership and provenance; neutral ground anchors are now an explicit system-only exception to player setup-only foundations; accepted repairs remain permanent for the match. Direct player contacts stay local to the flagged element/interfaces and must be recorded; indirect redistribution is verified globally. Matching elastic freedom states/axes permit differing connector stiffness values, retained individually. See [repair transaction](failure-repair-criteria.md#6-automatic-correction-transaction).
