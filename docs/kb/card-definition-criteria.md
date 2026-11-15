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

In the current playtest, every printing has a definition ID and version, and every dealt card has a separate instance ID. New Shared tables default to four implemented frame families with card-gravity verification. The optional planar and triangular truss catalogues add the verified printings described below. Presetless version-one saves replay their historical five-family deck, including experimental cables. The frame sections retain the existing voxel properties and expose SI physical definitions and nominal geometry. Candidate definitions in `game/cardCatalogue.ts` retain their separate authoring IDs. See the [criteria ledger](criteria-ledger.md).

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


### Tension-only cable playtest printing

The optional `shared-table-cables-1` catalogue deals a 24 mm cable with a metallic area of 360 mm², E = 160 GPa, and a provisional tensile capacity of 260 kN. The 25 kN initial tension refers to an installed straight cable whose two ends are held at their original separation. The unstressed length is the placed span divided by (1 + 25/57,600). Each activated clamp retains its original material fraction, so two segments on opposite sides of a loaded clamp may develop different tensions. The placement check uses a circumscribed 24 mm square clearance envelope around the reference cable. The end/quarter fitting allowance follows the other printed members.

The browser solves the current tension and direction of every segment with its material and geometric tangent. Each taut segment transfers tensile force along its deformed chord. A slack segment carries zero force. The mixed solver retains the existing small-motion frame law and withholds support awards when a component fails strain, stability or deformed-equilibrium checks. Its bounded iteration may return unresolved when a slack configuration provides insufficient initial tangent stiffness. The baseline five-family cable remains an experimental two-end printing in historical matches.

The 8 m two-anchor fixture with 5 kN at its midpoint sags 151.232 mm and has 66.171 kN tension. Applying the load at 25% instead yields 3.751566 kN and 1.248434 kN upward support reactions. The independently derived [force-method and OpenSees reference](../evidence/cable/reference.py) and [game regressions](../../apps/web/src/game/cablePorts.test.ts) cover all three clamps, slack reversal and the scope boundary. In the seed-8 match, the cable spans the players' original column heads. Two 5 kN cards at its first and third clamps with separate SHS braces give 2.999621 kN governing tension and 50% share per foundation. [Before](../evidence/cable/before-board.png) · [After](../evidence/cable/after-board.png) · [Loaded](../evidence/cable/loaded-board.png) · [Browser check](../evidence/cable/check.mjs)

### Four-panel planar playtest printing

The optional `shared-table-planar-1` catalogue adds `planar-welded-1` to the frame families. The default frame catalogue and its existing deals retain their versions. The printed parent is one element card. Each external tip needs its own connection card. Its 25%, 50% and 75% ports are physical lower-chord joints, reached through the same pointer and precise placement controls as frame ports.

The printing has two SHS 100×6 chords separated by 0.5 m, five welded transverse posts, four pin-ended alternating diagonals and two short terminal pieces. The lower tips are 0.125 m beyond the end posts (limited to one sixteenth of the span). Welded posts restrain the upper chord outside the truss plane. The earlier fully pin-ended post concept remains an unvalidated candidate. Each of the 19 factory pieces has a stable identity for its geometry, stiffness and self-weight. The printed weld develops the section; the diagonal pin uses the printed ball connector force limit. Maximum member utilization identifies the governing piece. Only the two terminal pieces transmit actions into external tip connectors.

The small-displacement verification checks use the full placed chord length for the conservative out-of-plane compression screen. Failed physical or numerical checks leave the component's response unverified. The [independent OpenSeesPy reference](../evidence/planar/reference.py) uses a 4 m cantilever with a 1 kN point force at each port, separately in and out of plane. The browser response, signed foundation force/moment, total physical weight, clash opening, end connections and replay are exercised by [the regression cases](../../apps/web/src/game/planar.test.ts). [Normal setup and real pointer walkthrough](../evidence/planar/check.mjs).

The optional `shared-table-planar-1` deck retains the frame preset as a separate choice. Its `planar-welded-1` card uses the scored SHS material, a 0.5 m truss depth, four panels and welded posts for out-of-plane resistance. The earlier pin-post candidate did not supply that restraint. The two chords, five posts, four diagonals and two terminal pieces form one placed parent with a stable identity, including under replay. See [card and placement evidence](criteria-ledger.md#cards-placement-match-and-recovery).

### Four-panel triangular playtest printing

The optional `shared-table-trusses-1` catalogue adds `trichord-ring-1` alongside the planar printing. Its three SHS 100×6 chords follow the edges of a 0.5 m equilateral triangular prism. Five welded triangular rings span the section, with a pin-ended diagonal on each face of each panel. Two short terminal stubs on the first chord provide the external tip connectors. Only its first chord exposes the 25%, 50% and 75% ring joints for other cards. A player spends one element and a separate connector for each attached end. The same 41 physical pieces define rendering, solid interference, stiffness, self-weight and member capacity. Each piece and attachment retains its parent identity on replay.

The linear verification uses the planar printing's section, factory-weld and diagonal-pin capacities, full-span chord slenderness screen and small-motion limits. The independent 4 m cantilever reference exercises lateral and vertical loads at all three joints and a pure 500 Nm torque at midspan. The regression checks compare signed reactions, point motion and twist, including a rotated, reordered assembly. [OpenSeesPy reference](../evidence/trichord/reference.py) · [regression cases](../../apps/web/src/game/trichord.test.ts).

The Grow Dusk walkthrough deals the triangular printing in normal Shared table setup, selects each physical quarter joint in 3D, attaches a branch at midspan and reloads the committed 5 kN load. Matched seed/camera captures show the earlier planar deck and the new triangular deck. [Before](../evidence/trichord/before-board.png) · [after](../evidence/trichord/after-board.png) · [repeatable walkthrough](../evidence/planar/check.mjs).

### Axial spring playtest printing

The optional `shared-table-springs-1` deck contains the four frame sections and a two-terminal axial spring. It has four reach printings. The placed span is its unloaded reference length. The authored bilateral stiffness is 50 kN/m, its tension and compression force limit is 5 kN, and its game self-weight is zero. Eight schematic turns and five square fittings identify the two tips and three original sliding collars. The mean coil diameter is 160 mm and the wire diameter is 12 mm. The default readable symbol enlarges both transverse dimensions 1.8 times while keeping all five station coordinates. These display dimensions are independent of the printed stiffness.

Each quarter is a 200 kN/m series segment. Unused intermediate collar coordinates condense to the equivalent stiffness `50 / fraction` kN/m between two active stations. A connected collar shares translations with the selected joint. The cartridge provides axial action only. The connected structure must supply transverse stability. Clearance uses the five square fittings and conservative square envelopes around individual wire segments. Open space inside the helix remains available between fittings.

The linear verification envelope permits up to 120 mm whole-span axial stroke, scaled by each segment's fraction and limited to half its length. Relative transverse motion beyond 1% of a segment length requires separate nonlinear evidence. A free transverse translation, excessive stroke or a failed stability check withholds the affected component's attraction and capacity evidence. The Shared table solver enforces these rules. The separate OpenSees editor check explicitly reports that it cannot translate the spring printing.

In the guided 8 m two-anchor fixture, a 5 kN force at the first collar produces 18.75 mm axial displacement. The signed support reactions oppose 3.75 and 1.25 kN. Reversing the force reverses both reactions. Midpoint and third-collar fixtures check the same law. In seed 1, actual frame members supply the midpoint restraint and an attached 5 kN gravity card generates a verified +0.043750059 kN governing spring section action. The [regressions](../../apps/web/src/game/spring.test.ts) and [browser walkthrough](../evidence/spring/check.mjs) cover all three original picks, section and connector checks, retained identity and reload.

## 6. System repair definitions are not player cards

Permanent neutral repair objects require their own versioned physical/visual catalogue, local-contact/ground-anchor permissions and capacity/geometry limits. They do not create dealt player instances or consume the player's turn allowances, and their reactions cannot be credited to a nearby card owner. Keep original player properties immutable. A reset of camera/theme or later player reinforcement cannot delete an accepted in-match repair. Whether new player cards may target system repair objects remains an explicit release-rule parameter.
