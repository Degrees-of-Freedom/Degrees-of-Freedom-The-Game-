---
title: "Controls and Camera Criteria"
last_validated: 2026-11-14
validated_against:
  - docs/kb/multiplayer-refresh-criteria.md
  - "Project owner completion-criteria request and follow-up decisions, 2026-11-14"
  - docs/kb/placement-criteria.md
  - docs/kb/joint-dof-criteria.md
  - docs/kb/animation-criteria.md
  - docs/kb/multiplayer-criteria.md
owner: project owner
status: needs-review
---

# Controls and Camera Criteria

> **Current target revision:** [Multiplayer simplification](multiplayer-refresh-criteria.md) supersedes conflicting older scope/rules on this page. Multiplayer is the only target; four source-selectable draws and unlimited held-card plays replace 2/2 draws and 1/1/2 caps. Structural work runs at configurable three-turn checkpoints plus match end. Only the standard axial/bending member, cable and two k₀ springs are playable; connectors control 1/2/3 rotational restraints. Minimum local safety constraints replace scaffold columns/extra foundations. Existing-code descriptions below remain implementation history, not proof this revision is shipped.


## 1. Status and scope

**Updated owner scope.** Grow Dusk is the release presenter. Validate the camera and complete input workflow there. The additional four presenters are preserved historical variants. In Creative/editor, the Foundation tool must be reachable and allow placement on the ground grid. Shared table uses preset foundations.

Proposed interaction requirements for future implementation; no new controls are implemented here. All five environments should expose equivalent legal game actions while retaining their distinct placement styles. Creative/editor conveniences must not bypass Shared table card, turn or immutability rules.

## 2. Complete input workflow

Every action has idle, selected, target-preview, valid/invalid, staged, committed and cancelled feedback as applicable. Provide visible instructions and keyboard-accessible equivalents for selecting cards, choosing endpoints/quarter ports, orienting/rolling an element, attaching ends, placing loads, inspecting, cancelling a draft, passing and ending a turn. Keyboard shortcuts are optional accelerators, not the only route. Do not invent final bindings without checking existing environment shortcuts and text-entry behavior.

Proposed primary workflow: choose a card/tool, choose a first target, preview allowed length/orientation, choose the second target, then stage. Connections explicitly identify member end and target joint/port; loads identify their actual target. Cancelling removes only the current operation or staged draft under the turn rules, never the already completed draw. Show remaining independent 1-element/1-load/2-connection allowances throughout.

Pointer drag on empty space or a dedicated camera gesture navigates; a placement click does not also orbit or place twice. Define movement thresholds and touch gestures consistently. On touch, use tap selection and explicit action controls; no required hover, right click, double click or precision drag. Provide accessible numeric coordinate/port selection where supported. Buttons and pick targets should meet at least 24 × 24 CSS pixels, with larger touch targets preferred. Invisible pick enlargement does not change physical geometry or legality.

Escape/Cancel closes the most local operation first, then selection/drawer as appropriate; it must not accidentally commit or discard a whole match. Destructive editor reset/import operations identify scope and preserve recoverability. Shared table has no committed-turn undo unless a future explicit rule authorizes it. Draft undo/redo, where offered, must preserve draws and card instance IDs.

## 3. Precision and crowded scenes

Snap only to legal grid positions or explicitly permitted quarter ports from [placement criteria](placement-criteria.md). Show the exact intended joint/element/port ID, coordinates and connection compatibility before staging. A proximity highlight is not proof of connectivity. Expose ambiguous hits through a cycle/list or disambiguation popup; select coincident independent interfaces individually. Do not pick through controls or let hidden geometry silently steal a placement.

Indicate depth with occlusion cues, working planes, endpoint labels and a selected-target leader. Explain when an object is hidden, off-plane or clipped. Show legal and illegal targets using shape/text as well as colour. Allow browsing the element/joint list and focusing an object when direct picking is impractical. Schematic/readable section enlargement must not alter snapping or collision decisions.

## 4. Camera contract

Provide orbit, pan, zoom, Fit structure, Reset view, and clear top/front/side or equivalent orientation controls. Z remains up; global/local DOF labels follow the model rather than the camera. Orthographic/isometric modes should preserve their promised working-plane precision. Keep near/far clipping and zoom limits usable across the supported board envelope.

Camera movement is presentation-only: no new load, member rotation, roll edit or structural state change. Changing environment preserves the model and staged turn. Preserve a useful selection and working plane or explicitly explain a view-only change. Avoid surprise auto-orbit, camera shake and forced travel; an explicit Focus action may move the camera, with an immediate/reduced-motion alternative.

During validation/analysis freeze incompatible editing while retaining safe view navigation, inspection, help and settings. Show pending state. Large labels, the companion, cards and drawers must yield to essential targets. On resize or orientation change retain the operation and show its current target; do not stage unintended geometry. UI events must not fall through to the board.

## 5. Accessibility and interruption

Support visible focus, logical focus order and readable text for all critical workflows. Announce meaningful errors/results politely and return focus sensibly when a modal closes. Keyboard focus remains stable during animations. With reduced motion, sound off, colour differences unavailable or decorative effects disabled, all decisions and outcomes remain understandable.

A blurred/background tab, lost pointer capture or touch cancellation must stop the current drag safely. Resume with clear draft state, not a queued click or camera jump. Handoff/privacy screens capture board and keyboard input and hide private material, including tooltips and focus labels. Browser shortcuts and typing in form fields must not trigger construction commands.

## 6. Acceptance and unresolved choices

| Walkthrough | Required result |
| --- | --- |
| Mouse, keyboard-only and touch full turn | Same legal staged model and card consumption without hover-only steps. |
| Crowded / coincident / clipped targets | Explicit target identity, no accidental cross-connection or click-through. |
| Orbit, fit, roll preview, environment switch | Camera-only actions preserve physical state; permitted roll changes are explicit draft edits. |
| Cancel, resize, blur, pointer loss | Recoverable draft; no duplicate placement or draw. |
| Analysis pending / reduced motion / muted | Clear progress and usable safe controls without forced camera motion. |
| Quarter attachment and opposite-end selection | Correct original-member reference position and interface, including diagonal elements. |

### Shared table input evidence

In the Grow Dusk Turn details drawer, the private hand labels and card families use dark text on cream. Selection has an amber fill and inset border, and keyboard focus has an external outline. The [Chrome check](../evidence/input-parity/hand-contrast.cjs) measures both text sizes and the End turn action after deliberate reveal, on desktop and touch-emulated layouts. [Desktop comparison](../evidence/input-parity/hand-contrast-after.png) · [Touch layout](../evidence/input-parity/hand-contrast-after-touch.png).

In the scored frame preset, Turn details provides grid and original-quarter element placement, explicit member-end connection choices, and persistent gravity placement on any playable shared joint. Input uses the same stage and commit operations as the board. Browser controls own their keyboard events. Enter opens a disclosure or activates its focused button. At narrow widths the Grow Dusk hand tray leaves the turn controls reachable.

The [seed 1 match runner](../evidence/match/check.mjs) exercises a load on the opposing starting foundation followed by cancellation, a midpoint branch and load, a staged-draft reload, a new unstable member and all 16 turns. Keyboard tests use Tab or Shift+Tab to reach controls and the native selection keys. Chrome touch emulation uses taps for buttons, native select changes and text entry at 412 × 915 CSS pixels. The release matrix tracks hardware touch and screen-reader coverage separately. [Touch layout](../evidence/input-parity/touch-hand-controls.png) · [Keyboard quarter form](../evidence/input-parity/keyboard-quarter-form.png).

Open: final keymap, touch gesture mapping, camera limits/defaults per environment and assistive-technology/device matrix. Validate against [whole-game release gates](release-acceptance-criteria.md); do not claim controls are complete from desktop mouse testing alone.

## 7. Inspector, cursor salience and quit at any time

Inspecting an element opens a persistent property panel with actual/max length, owner/card/family, endpoints/quarter ports, rotation masks, spring multiplier/k₀/k, setup locks, last checkpoint/results and system overrides. Edit only draft printed choices; committed physical properties are read-only and setup is always locked. Nearby legal snap points are bold/opaque; distant points fade smoothly, preserving hit identity, depth cycling and keyboard/touch selection. Do not trigger a solver by inspecting or moving the cursor. Quit/Menu stays reachable during draw/placement/privacy/animation/checkpoint/correction; suspend and save exact state without an implicit commit/pass/final solve or forfeiture.
