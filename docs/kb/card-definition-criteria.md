---
title: "Element and Card Definition Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/turn-criteria.md
  - docs/kb/element-representation-criteria.md
  - docs/kb/placement-criteria.md
  - docs/kb/solver-criteria.md
  - docs/kb/saved-match-criteria.md
owner: project owner
status: needs-review
---

# Element and Card Definition Criteria

## 1. Status and separation of concerns

Proposed authoring/validation requirements; no new catalogue, numerical values or cards are implemented here. Confirmed visual families include columns with actual sections, wide flanges, square/rectangular and round HSS, axial helical springs, planar two-chord and triangular three-chord trusses, and cables. Retain existing timber and other working families. Assembly placement economy is controlled by the latest owner decision in [placement criteria](placement-criteria.md), not inferred from a mesh.

Separate a versioned card definition from its unique dealt instance, the physical member/assembly definition and generated visual meshes. Changing a material finish or display LOD must not change a card's mechanics. Ownership affects permission/scoring provenance, not E, stiffness or physical behavior. Card titles/rarities cannot substitute for resolved properties.

## 2. Minimum definition contract

| Record | Required authored data |
| --- | --- |
| All cards | Stable definition ID/version, family/category, name, description, allowed choices, required rules/solver capabilities, public preview and any instance-to-object mappings. |
| Physical solid/axial member | Reference length options/range, grid/orientation/roll options, material, resolved section dimensions and relevant E/G/A/Iy/Iz/J, mass/self-weight policy, capacity definitions with units/interaction convention, endpoints and permitted quarter interfaces. |
| Material/section | Source/standard or authored assumption, revision, units, density if used, elastic properties, physical dimensions/axes and any approximation relative to catalogued properties. Do not derive J for an open section from a polar-area shortcut. |
| Cable | Diameter/section/material, explicit rest length or initial strain/pretension convention, tension-only law, capacities and permitted attachments; do not inherit hidden universal pretension. |
| Standalone axial spring | Axial force-extension law and units, stiffness/rest state, tension/compression range and limits, capacities/mass where used, plus physical or labelled schematic coil dimensions. No unsupported nonlinear/contact law is implied. |
| Planar/trichord assembly | Parent definition and stable child topology, chord/web sections/materials, geometry/panel/triangle frame, continuity/releases, exposed ports, allowed attachment fractions, load/self-weight mapping, capacity/failure semantics and analytical expansion or validated equivalent model. |
| Connection | Six free/locked/elastic laws in explicit axes, stiffness units/values, capacities and governing interactions, allowed orientation, joint-compatibility rule, immutable deployed identity and endpoint/port target. |
| Load | Positive printed gravity magnitude with units, persistent global downward direction for base play, eligible explicit targets, mapping to analytical loads and exactly one card identity. No generated duplicate nodal weight. |

Use SI at the shared analytical boundary; document exact conversions from catalogue units and the voxel solver's kN/metre conventions. All required numbers are finite and physically admissible under a documented law. Reject impossible wall/flange dimensions, nonpositive required stiffness/length, invalid roll frames, disconnected/duplicate assembly references and unsupported property combinations.

Capacities require an explicit recognized limit-state interpretation, including axial-flexural interactions where applicable. A list of named capacities alone does not define a design check. Document effective-length, buckling, imperfection, safety-factor and connection assumptions; do not present provisional catalogue checks as validated engineering design. Units and conventions are visible in inspection and fixtures.

## 3. Playable choices and card locations

Print/preview choices available to the player: length/orientation limits, section/roll choices, external ports, quarter-attachment rules and connection profile. No arbitrary property editing during Shared table play. Selection may expose detail but cannot upgrade existing cards. Every instance is in exactly one valid location: a declared deck, a player's hand, staged reservation, deployed state or discard under explicit policy. Staging may be represented as a reservation while the hand owns the instance; it must never create two independently spendable copies.

Connection compatibility compares actual physical freedoms, not just preset names. Matching freedoms/physical axes is required, but the owner allows different elastic stiffnesses across attached ends. Preserve each card’s actual stiffness; no averaging or forced upgrading. Joint frame establishment, matching tolerances and legacy handling must be specified by the release ruleset. Proposed initial policy is reject incompatible incoming connections and retain the card/draft; do not coerce earlier immutable connections. Adding a quarter port never creates free extra cards or resets the parent's capacity/rest state.

A catalogue entry can be visually inspectable yet not playable/analyzable. A scored ruleset must exclude or visibly disable any unsupported physical/card capability before a match starts, rather than discovering silent approximations after a draw. A planned family must not be passed through a solver as a hard-coded steel beam merely to obtain a result.

## 4. Deck construction and balance manifest

Declare deck lists/counts, version, player/round support, opening hand, retention/cap/discard/exchange, seed/shuffle procedure and exhaustion policy before setup. Proposed initial choices remain to playtest: no separate opening hand beyond the first normal draw; retain unplayed cards; no hand cap for the initial fixed-round preset. These are not confirmed rules. Large hands need pagination/search without private information leaks or forced discard.

Two draws per deck per player turn require at least `2 * players * rounds` cards **in each deck**, plus any opening-hand requirement, unless an explicit exhaustion policy permits shortfall/reshuffle. A proposed fallback reshuffles only undeployed discards from that deck, then draws the remainder and records a shortfall; never recycle deployed cards or replace the missing deck with the other one. Passing still draws. Confirm the policy before release.

Proposed deck-1 mix starts near equal element/load counts; define nonzero family representation for the intended test catalogue. Connection frequencies must consider common-joint profile compatibility so the game is not dominated by unusable draws. Record seeded tests of reachable legal choices and hand growth; do not secretly alter draws to rescue a player unless an explicit disclosed rule permits it. Use balance simulation separately from numerical verification.

## 5. Acceptance and open values

| Check | Required evidence |
| --- | --- |
| Every playable definition | Complete valid schema, immutable version/source, recognized capabilities and representative fixture. |
| Unit conversion / orientation / hollow sections | Consistent physical quantities and dimensions across card, mesh, save and solver. |
| Cable/spring rest state | Explicit law/state, correct permitted load direction, no silent pretension or invented coil stiffness. |
| Assembly ports/subdivision | Stable parent/part/quarter identities, correct economy and no duplicated loads/mass/capacity. |
| Hand/deck/staging/retry | One spendable instance and deterministic draws/locations. |
| Unsupported entry / old definition | Clear refusal or explicit migration, never silent replacement. |
| Seeded full matches | Declared deck sizing/exhaustion, usable UI and recorded balance evidence, not a claim of proven optimal balance. |

Open: actual section/material numbers and trusted sources, spring law/limits, cable initial state, assembly templates, connection stiffness/capacity tiers, opening hand/retention/exhaustion, printed load magnitudes and deck frequencies. These should become a versioned reviewed catalogue, not developer-invented defaults hidden in renderer code.
