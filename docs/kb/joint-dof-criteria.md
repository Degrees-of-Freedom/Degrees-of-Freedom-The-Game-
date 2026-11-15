---
title: "Joint Degrees of Freedom Visualization Criteria"
last_validated: 2026-11-14
validated_against:
  - "Project owner multiplayer simplification and follow-up answers, 2026-11-14"
  - docs/kb/multiplayer-refresh-criteria.md
  - docs/kb/failure-repair-criteria.md
  - docs/kb/visualization-criteria.md
owner: project owner
status: needs-review
---

# Joint Degrees of Freedom Visualization Criteria

## 1. Current decisions and status

The [multiplayer refresh](multiplayer-refresh-criteria.md) supersedes the earlier six-axis player-connection palette. Show connection appearance **only at the node**, with three rotational components, for card types restraining 1, 2 or 3 rotations. Connected translations are compatible by attachment definition, not free/elastic/locked translation choices exposed to players. This is a target specification, not claimed UI implementation.

Retain Selected joint / All joints / Off (Selected default), global reference axes with local frame available on selection, still-by-default glyphs and brief optional demonstrations. Foundations and starting columns are fully fixed/locked and cannot be changed. Solver instability remains a distinct overlay, never inferred from a glyph.

## 2. Meaning of rotation glyphs

Use three small curved arrows around RX/RY/RZ, with axis labels and shape distinctions for restrained versus released. RX arc lies in YZ, RY in XZ, RZ in XY. Restraint marks use a stop/lock accent; released arcs remain visibly open. Axis colour alone is insufficient. Straight translation arrows are not the normal player-connector UI, and no translational editing control/slider/elastic-card icon is offered.

One common node glyph conveys the joint rotational mask; an inspector exposes actual incoming end/card identities when needed. A fixed relative connector does not itself fix a joint to the world; default ground fixity belongs to the one player foundation. Cables/springs do not acquire moment resistance through an inactive analytical rotation. Label inactive or unavailable quantities rather than pretending all rotations are physically engaged.

## 3. Shared-joint compatibility and revised rules

Preserve intentional attachment and compatible rotational freedom axes at one shared joint. Store physical frame and mask, not just “one rotation” as an ambiguous label. Player chooses permitted axis/pair for the 1/2 types; 3 locks all three. No zero-lock fourth player type, no elastic/translation connection-card variants. New incoming cards cannot relax the immutable starting column/foundation connections. At a setup-fixed joint only compatible attachments are legal; no hidden upgrade/removal action.

System correction is a separate original-versus-effective layer. Show a distinct safety badge when the game added a minimum local rotational restraint or required system-only translational safety constraint. Detail target/frame, original turn/checkpoint, reason, neutral reaction/validity and permanence. Never render it as a new player card, foundation or downward column. It may override effective behavior under correction policy while the original player mask remains unchanged in history.

## 4. Readability and interaction

Node-local glyphs keep screen size readable, scale up on selection and avoid members/cards/inspector/quit controls. No bulky connector meshes along member ends. An All joints view may cluster/count glyphs truthfully and prioritize the selected node. Coincident but distinct unattached ends/joints stay individually selectable; visual overlap does not connect them.

Inspector shows restrained/released RX/RY/RZ and exact frame. Default foundation shows its six locked ground restraints in a clearly separate read-only setup group. The ordinary player connector group has no editable UX/UY/UZ rows. If a system translation correction exists, list it separately as system-owned rather than hiding it in the player mask.

## 5. Global/local axes and demonstrations

Default global triad is Z up; show actual permitted directions and selected local connection axes. Rotated anisotropic masks can couple global components: disclose coupling/local frame instead of copying local booleans onto global directions. Camera orbit does not change the connection law.

Glyphs remain still normally. A short selected/hover schematic twist may demonstrate released versus stopped rotation; it is not actual structural deformation. Reduced motion uses static marks/text. The same information is keyboard/touch accessible and available with sound/glow off. Selecting or inspecting never calls a solver between checkpoints.

## 6. Independent solver results

Separate permissions from instability modes and from axial flow. Show only valid model/version scope; unsolved current turns and older checkpoint results are explicitly labelled. Mode playback is an illustrative normalized ghost, not a collapse trajectory. Load-path tension vectors move toward endpoints; compression toward the centre, from valid signed axial data, not the rotational mask. No UI gesture/animation creates a penalty, correction or new numerical conclusion.

## 7. Acceptance and open parameters

Check exactly three connector types with correct chosen axes; common-joint compatibility; locked setup read-only; no player translational/elastic law controls; one node-local glyph; individual card provenance; original/effective system override; visible neutral reaction; global/local transforms; no inferred cable bending; selected/all/off and no hidden solve; keyboard/touch/reduced-motion; quit during overlays and truthful checkpoint freshness. Exact sizes/palette/frame tolerances remain review parameters.
