---
title: "Element and Card Definition Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/turn-criteria.md
  - docs/kb/element-representation-criteria.md
owner: project owner
status: needs-review
---

# Element and Card Definition Criteria

## 1. Current playable catalogue

The [multiplayer refresh](multiplayer-refresh-criteria.md) supersedes the larger historical catalogue. This page specifies future implementation, not existing coverage.

| Current member variant | Required mechanics/data |
| --- | --- |
| Standard beam-column | One material/section definition; axial and bending response; explicit supported shear/torsion, orientation/roll, capacities and units. No extra selectable section/material families. |
| Cable | Tension-only law, diameter/section, explicit rest length/initial strain and capacities; never a hidden two-way truss. |
| Spring 0.25 | Axial spring with k = 0.25k₀, explicit rest state/capacities and two endpoint coils. |
| Spring 0.5 | Same reference k₀/law conventions with k = 0.5k₀; exactly twice the other spring's stiffness. |

k₀ is a published versioned reference axial stiffness in N/m, **not** implicitly EA/L. Its numerical value and the standard member's actual properties remain to author/review. Visual coil dimensions do not derive the stiffness. Whether shorter placement changes rest length is explicit; it must not silently change the printed stiffness multiplier. Preserve validated quarter-port laws on every current family.

No playable planar/trichord assembly, standalone brace, foundation, HSS/wide-flange/timber variant or elastic/translation connector. General solver fixtures and legacy saved definitions may remain internal/read-only without becoming drawable cards.

## 2. Versioned definitions and length tiers

Every card definition has stable ID/version, category/family, public name, printed choices, required rules/solver capabilities and immutable resolved data. Unique dealt instances have their own IDs and one spendable location. Distinguish player cards from system corrective constraint records.

Member cards have `maxLength` exactly 5, 7 or 10 game units, not exact length. Preview actual and maximum lengths/units. Positive legal shorter/diagonal spans are permitted; compare Euclidean reference length with the maximum and published tolerances. One explicit game-to-SI conversion is used by card, geometry, save and solver. Do not preserve old per-axis `maxCells` semantics as a misleading “10-unit” cube.

Resolved member properties include appropriate E/G/A/Iy/Iz/J, physical geometry/frame, capacities/limit-state conventions, mass/self-weight policy, reference/rest state and quarter interfaces. Values/frames must be valid, finite and supported. Unsupported laws or missing dimensions are not replaced with hard-coded steel results. Editing a draft changes only printed options, never arbitrary E, section or capacity sliders. Committed pieces and starting setup parts are physically read-only.

## 3. Rotation-only connector definitions

Only three card families: restrain 1, 2 or 3 rotational DOFs; choose the permitted axes in the documented stored frame. Store exactly that many locked RX/RY/RZ components and release the others. Connected translations are compatible through the explicit attachment definition; no editable translation-law card or ground restraint is added by a player connector. No fourth zero-restraint/ball, elastic, slider or six-law custom card.

Preserve per-end/card identity, shared-joint physical-axis compatibility and immutable starting column/foundation fixity. Cable/spring inactive rotations do not gain invented bending stiffness. System repair adds a separately inspectable effective-constraint layer; never relabel it as another player connector card or silently overwrite the original mask.

## 4. Decks, unlimited plays and validation

Exactly four draws per turn, source chosen independently for each draw from elements/loads or connectors. Any number of cards held may be played, including loads; passing is allowed. No fixed deck split, per-category play cap, free duplicated instance or implicit spend through animation. Cancelling a draft restores its reservations without undoing draws.

Deck counts must accommodate allowed source choices or define exhaustion/reshuffle/shortfall honestly. The old `2 * players * rounds` per-deck sizing is no longer sufficient to guarantee no exhaustion when all four draws may target one deck. A no-shortfall guarantee for either deck requires up to `4 * players * rounds` cards in **each** deck, plus any explicit opening-hand allowance. Exact mix/retention/exhaustion remain reviewed parameters, not secret draw manipulation.

Validate catalogue capabilities before a scored match. Required tests include four source-selectable draws and recovery; many plays of every category; 5/7/10 maxima and shorter diagonals; k multiplier ratio/units/rest state; exactly 1/2/3 rotational masks; no retired cards; no new foundations; quarter mapping and no duplicated loads/mass after subdivision. Balance tests are distinct from numerical validation.

## 5. Open authored parameters

Actual material/section/capacity values and k₀, load magnitudes, deck counts/ratios, hand policy/exhaustion, correction limits, physical tolerances and spring/cable quarter constitutive laws remain explicit. They must be versioned and tested; no implementation session should infer them from display meshes or silently restore the retired catalogue.
