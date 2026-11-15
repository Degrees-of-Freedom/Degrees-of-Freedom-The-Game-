import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CANTILEVER_CATALOGUE, RELEASE_CATALOGUE, createReleaseDecks } from "../game/cardCatalogue";
import { useGameStore } from "../game/store";
import { createTurnGame, projectTurnModel, stageConnection, stageElement, type TurnCard, type TurnState } from "../game/turns";
import { ElementPlacementControls, StagedAttachmentActions } from "./ReleaseTargets";

const cards = createReleaseDecks().flat();
const frame = cards.find((card): card is Extract<TurnCard, { kind: "element" }> => card.kind === "element" && card.type === "heb" && card.maxSteps === 5)!;
const cable = cards.find((card): card is Extract<TurnCard, { kind: "element" }> => card.kind === "element" && card.type === "cable")!;
const fixed = cards.find(card => card.kind === "connection" && card.profile === "fixed")!;
const partial = cards.find(card => card.kind === "connection" && card.rotationsToLock === 2)!;

function gameFor(turn: TurnState, selected = frame.id) {
  return { ...useGameStore.getState(), mode: "multiplayer" as const, turn, model: projectTurnModel(turn), selectedCardId: selected,
    chainStart: "5,7,1", attachmentSite: "a" as const, placementPlane: "horizontal" as const };
}
function fixture(catalogue: typeof CANTILEVER_CATALOGUE | typeof RELEASE_CATALOGUE = CANTILEVER_CATALOGUE) {
  const turn = createTurnGame(41, catalogue);
  turn.players[0].hand = [frame, cable, fixed, partial];
  return turn;
}
function accepted(next: ReturnType<typeof stageElement>) {
  if (!next.ok) throw new Error(next.reason);
  return next.state;
}

describe("Shared table cantilever targeting", () => {
  it("offers optional interior stations only for supported new-match frame cards", () => {
    const turn = fixture();
    const html = renderToStaticMarkup(<ElementPlacementControls game={gameFor(turn)} card={frame} notify={() => {}} />);
    expect(html).toContain('aria-label="Attach at Middle"');
    expect(html).toContain('aria-pressed="true" aria-label="Attach at End A"');
    expect(html).toContain('aria-label="Element build plane"');
    expect(html).toContain('aria-label="Element free tip"');
    expect(html).toContain("Stage element");
    const old = renderToStaticMarkup(<ElementPlacementControls game={gameFor(fixture(RELEASE_CATALOGUE))} card={frame} notify={() => {}} />);
    expect(old).not.toContain('aria-label="Attach at Middle"');
    const axial = renderToStaticMarkup(<ElementPlacementControls game={gameFor(turn, cable.id)} card={cable} notify={() => {}} />);
    expect(axial).not.toContain('aria-label="Attach at Middle"');
  });

  it("keeps a staged collar visibly unconnected until a real fixed card is spent", () => {
    const placed = accepted(stageElement(fixture(), frame.id, "4,7,1", "8,7,1", { quarter: 1, target: "5,7,1" }));
    const html = renderToStaticMarkup(<StagedAttachmentActions game={gameFor(placed)} notify={() => {}} />);
    expect(html).toContain("Unconnected");
    expect(html).toContain(`data-attachment-card-id="${fixed.id}"`);
    expect(html).toContain("Attach with Fixed connector");
    expect(html).not.toContain(`data-attachment-card-id="${partial.id}"`);
    const joined = accepted(stageConnection(placed, fixed.id, 3, "q1", "5,7,1"));
    const attached = renderToStaticMarkup(<StagedAttachmentActions game={gameFor(joined)} notify={() => {}} />);
    expect(attached).toContain("Attached");
    expect(attached).not.toContain("Unconnected");
    expect(attached).not.toContain("Attach with");
  });

  it("does not invent an attachment action when no compatible card is in hand", () => {
    const turn = fixture();
    turn.players[0].hand = [frame, partial];
    const placed = accepted(stageElement(turn, frame.id, "4,7,1", "8,7,1", { quarter: 1, target: "5,7,1" }));
    const html = renderToStaticMarkup(<StagedAttachmentActions game={gameFor(placed)} notify={() => {}} />);
    expect(html).toContain("Unconnected");
    expect(html).toContain("No compatible fixed connector is available");
    expect(html).not.toContain("data-attachment-card-id");
  });
});
