import { useGameStore } from '../game/store';
import { ITEMS, MEMBER_TYPES, costOf } from '../game/inventory';
import { LEVELS } from '../game/levels';
import { type MemberType } from '../game/model';
import type { ReactNode } from 'react';
import type { VoxelAnalysis } from '../solver/voxel';
type Game = ReturnType<typeof useGameStore.getState>;
export function StructureInspector({
  game,
  result,
  setMessage,
  children,
}: {
  game: Game;
  result: VoxelAnalysis | null;
  setMessage: (message: string) => void;
  children: ReactNode;
}) {
  const level = LEVELS[game.levelId];
  const selectedId =
    game.selected?.type === 'member' ? game.selected.id : undefined;
  const selected = game.model.members.find((m) => m.id === selectedId);
  return (
    <aside className="panel inspector">
      <div className="panel-title">02 &nbsp; STRUCTURE</div>
      <h2>The details</h2>
      <div className="stat">
        <span>Members</span>
        <b>{game.model.members.length}</b>
      </div>
      <div className="stat">
        <span>Cost</span>
        <b>${costOf(game.model).toLocaleString()}</b>
      </div>
      <div className="stat">
        <span>Budget</span>
        <b>
          {Number.isFinite(level.budget)
            ? `$${level.budget.toLocaleString()}`
            : 'Unlimited'}
        </b>
      </div>
      {selected && (
        <div className="selection">
          <h3>Member #{selected.id}</h3>
          <p>
            {ITEMS[selected.type].label} · {selected.a} → {selected.b}
          </p>
          {game.mode !== 'multiplayer' && <><label>
            Swap to{' '}
            <select
              value={selected.type}
              onChange={(e) => {
                const issue = game.swapMember(
                  selected.id,
                  e.target.value as MemberType,
                );
                setMessage(issue ?? '');
              }}
            >
              {MEMBER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEMS[t].label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => game.removeMember(selected.id)}>
            Remove member
          </button>
          </>}
          {result?.members[selected.id] && (
            <>
              <h3>Design checks</h3>
              {Object.entries(result.members[selected.id].checks).map(
                ([name, value]) => (
                  <div className="stat" key={name}>
                    <span>{name}</span>
                    <b>
                      {Number.isFinite(value)
                        ? `${(value * 100).toFixed(0)}%`
                        : '—'}
                    </b>
                  </div>
                ),
              )}
              {result.members[selected.id].slack && (
                <p>Cable is slack in at least one load case.</p>
              )}
            </>
          )}
        </div>
      )}
      {game.selected?.type === 'node' && (
        <div className="selection">
          <h3>Node {game.selected.key}</h3>
          <p>
            Attachments:{' '}
            {Object.entries(game.model.attrs[game.selected.key] ?? {})
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(', ') || 'none'}
          </p>
          {game.mode !== 'multiplayer' && !!game.model.attrs[game.selected.key]?.load && !game.model.attrs[game.selected.key]?.locked && <label>Gravity load (kN)<input aria-label="Gravity load magnitude" type="number" min="0.001" step="1" value={game.model.attrs[game.selected.key].load} onChange={(event) => {
            if (game.selected?.type === 'node') setMessage(game.setNodeLoad(game.selected.key, Number(event.target.value)) ?? '');
          }} /></label>}
        </div>
      )}
      {children}
    </aside>
  );
}
