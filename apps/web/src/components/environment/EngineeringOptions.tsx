import { useGameStore } from "../../game/store";
import { ITEMS, MEMBER_TYPES } from "../../game/inventory";
import { autoDesignGame } from "../../game/analysis";
import { LEVELS } from "../../game/levels";

/** The existing engineering tools remain available without replacing the environment HUD. */
export function EngineeringOptions({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const game = useGameStore();
  if (game.mode === "multiplayer") return null;
  const selectedId = game.selected?.type === "member" ? game.selected.id : null;
  const selected = game.model.members.find(
    (member) => member.id === selectedId,
  );
  return (
    <section>
      <h3>Member catalog</h3>
      <div className="catalog-options">
        {MEMBER_TYPES.map((type) => (
          <button
            key={type}
            aria-pressed={game.tool === type}
            onClick={() => game.setTool(type)}
          >
            {ITEMS[type].label}
          </button>
        ))}
      </div>
      {selected && (
        <label>
          Change member {selected.id}
          <select
            value={selected.type}
            onChange={(event) => {
              const type = MEMBER_TYPES.find(
                (type) => type === event.target.value,
              );
              if (type)
                onMessage(
                  game.swapMember(selected.id, type) ?? "Member updated",
                );
            }}
          >
            {MEMBER_TYPES.map((type) => (
              <option key={type} value={type}>
                {ITEMS[type].label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(game.mode === "creative" || game.mode === "challenge") && (
        <button
          onClick={() => {
            try {
              const source = game.model,
                design = autoDesignGame(source, LEVELS[game.levelId]);
              onMessage(
                design.changed && game.applyAutoDesign(design.model, source)
                  ? "Beam sections updated. Run feedback for the revised model."
                  : (design.analysis.error ?? "No beam sections changed."),
              );
            } catch (error) {
              onMessage(
                error instanceof Error
                  ? error.message
                  : "Auto-design unavailable",
              );
            }
          }}
        >
          Auto-design beams
        </button>
      )}
    </section>
  );
}
