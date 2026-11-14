import { useMemo } from 'react';
import { analyzeConnectivity } from '../game/connectivity';
import type { GameModel } from '../game/model';
import type { TurnState } from '../game/turns';

export function ConnectivityPanel({ model, turn, onSelectMember, onSelectNode }: {
  model: GameModel;
  turn?: TurnState | null;
  onSelectMember: (id: number) => void;
  onSelectNode: (key: string) => void;
}) {
  const report = useMemo(() => analyzeConnectivity(model, turn), [model, turn]);
  return <details className="model-io">
    <summary>Support reachability · {report.unsupportedMembers.length} unsupported members</summary>
    <p>{report.memberCount} members · {report.lengthMetres.toFixed(1)} m total length · {report.totalLoadKilonewtons.toFixed(1)} kN placed load</p>
    <p>{turn ? 'Paths follow deployed and staged member-end connections.' : 'Paths follow members between shared endpoints.'} This check measures graph reachability. Structural stability requires analysis.</p>
    {report.unsupportedMembers.length > 0 && <div className="workspace-actions">{report.unsupportedMembers.map((id) =>
      <button key={id} onClick={() => onSelectMember(id)}>Member {id}</button>)}</div>}
    {report.unsupportedNodes.length > 0 && <div className="workspace-actions">{report.unsupportedNodes.map((key) =>
      <button key={key} onClick={() => onSelectNode(key)}>Node {key}</button>)}</div>}
  </details>;
}
