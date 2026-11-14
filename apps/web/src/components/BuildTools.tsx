import { useGameStore } from '../game/store';
import { ITEMS, MEMBER_TYPES, remaining } from '../game/inventory';
import { LEVELS } from '../game/levels';
import { type MemberType, type Tool } from '../game/model';
type Game = ReturnType<typeof useGameStore.getState>;
const tools: { id: Tool; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'delete', label: 'Remove' },
  { id: 'swap', label: 'Swap' },
  ...Object.entries(ITEMS).map(([id, item]) => ({
    id: id as Tool,
    label: item.label,
  })),
];
export function BuildTools({ game }: { game: Game }) {
  const level = LEVELS[game.levelId];
  return (
    <aside className="panel">
      <div className="panel-title">01 &nbsp; BUILD TOOLS</div>
      <h2>Your toolkit</h2>
      <p className="muted">{level.desc}</p>
      <div className="tool-list">
        {tools
          .filter((t) => t.id !== 'load' || level.type === 'sandbox')
          .map((t) => {
            const item =
              t.id in ITEMS ? ITEMS[t.id as keyof typeof ITEMS] : null;
            const count = item
              ? remaining(level, game.model, t.id as keyof typeof ITEMS)
              : null;
            return (
              <button
                className={game.tool === t.id ? 'active-tool' : ''}
                key={t.id}
                onClick={() => game.setTool(t.id)}
              >
                <b style={{ color: item?.color }}>✳</b>
                <span>
                  {t.label}
                  <small>
                    {count === null
                      ? 'Select tool'
                      : count === Infinity
                        ? 'Unlimited'
                        : `${count} available`}
                  </small>
                </span>
              </button>
            );
          })}
      </div>
      {game.tool === 'swap' && (
        <label className="control-label">
          Swap to{' '}
          <select
            value={game.swapTarget}
            onChange={(e) => game.setSwapTarget(e.target.value as MemberType)}
          >
            {MEMBER_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEMS[t].label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="note">
        Click to build; drag to orbit. Shift chooses a horizontal build plane.
        Select Inspect to examine members. R runs analysis; D toggles
        deformation.
      </div>
    </aside>
  );
}
