import type { useGameStore } from "../game/store";
import { activeTurnHand, type TurnState } from "../game/turns";
import { parseNodeKey } from "../game/model";
import { originalPorts, portLabel } from "../game/turnPorts";
import { connectionLabel } from "../game/jointFreedom";
import { publicTurnReport } from "../game/publicTurnModel";
import { repairReaction } from "../game/publicRepairReport";
import { useSettings } from "../menu/settings";
import type { JointPermission } from "../viewer/jointPermissions";
import type { useReleaseInspection } from "../viewer/useReleaseInspection";
import { CardDefinitionDetails } from "./CardDefinitionDetails";
import { JointPermissions } from "./JointPermissions";
import { RepairHistory } from "./RepairHistory";
import { computeLoadPath } from "../solver/loadPath";

type Layer = "reference" | "shape" | "path";
type Game = ReturnType<typeof useGameStore.getState>;
const units = (n: number) => Number(n.toPrecision(4)).toLocaleString("en", { maximumSignificantDigits: 4 });
const owner = (id: string) => id === "neutral" ? "Neutral repair" : id.replace("player-", "Player ");

export function ReleaseInspection({ game, turn, joints, joint, selectJoint, responseOpen, onResponse, draft,
  reading, layer, peakM, setLayer, scale, amplification, setAmplification }: {
  game: Game; turn: TurnState; joints: JointPermission[]; joint?: JointPermission; selectJoint(id: string): void;
  responseOpen: boolean; onResponse(): void; draft: boolean; reading: ReturnType<typeof useReleaseInspection>;
  layer: Layer; peakM?: number; setLayer(layer: Layer): void; scale: number; amplification: number; setAmplification(n: number): void;
}) {
  const members = [...turn.board.members, ...turn.draft.members];
  const selection = game.selected;
  const member = selection?.type === "member" ? members.find(m => m.id === selection.id) : null;
  const card = activeTurnHand(turn).find(c => c.id === game.selectedCardId);
  const settings = useSettings();
  const response = draft ? undefined : reading?.response;
  const last = turn.reports.at(-1);
  const gravity = turn.board.loads.reduce((sum, load) => sum + load.magnitude, 0);
  const shares = response?.receipt.components.flatMap(scope => scope.foundations);
  const path = layer === "path" && response ? computeLoadPath(response.result, 0) : null;
  const submembers = response?.result.ctx?.els.filter(e => member && (e.m.parentSpan?.memberId ?? e.m.id) === member.id) ?? [];
  return <>
    {card && <CardDefinitionDetails card={card} />}
    <label>Inspect member<select value={member?.id ?? ""} onChange={event =>
      game.setSelected(event.target.value ? { type: "member", id: Number(event.target.value) } : null)}>
      <option value="">Choose a member</option>{members.map(m => <option key={m.id} value={m.id}>
        Member {m.id} · {m.assembly ?? m.type.toUpperCase()} · {owner(m.owner)}
      </option>)}
    </select></label>
    {member && <section aria-label="Member properties"><h3>Member {member.id}</h3>
      <p>{owner(member.owner)} · {turn.draft.members.includes(member) ? "Staged" : "Committed"} · {member.assembly ?? member.type.toUpperCase()}</p>
      <p>{units(2 * Math.hypot(...parseNodeKey(member.a).map((n, i) => n - parseNodeKey(member.b)[i])))} m · ({member.a}) → ({member.b})</p>
      <dl>{(["a", "b"] as const).map(end => {
        const conn = [...turn.board.connections, ...turn.draft.connections].find(c => c.memberId === member.id && c.end === end);
        return <div key={end}><dt>End {end.toUpperCase()}</dt><dd>{conn ? `${connectionLabel(conn.profile)} · ${conn.jointId}` : "Unattached"}</dd></div>;
      })}</dl>
      <details><summary>Original ports</summary>{originalPorts(member).map(p => <p key={p.id}>{portLabel(p)} · ({p.point.join(", ")})</p>)}</details>
      {response && <details><summary>Local end actions</summary>
        {submembers.length ? submembers.map(e => {
          const verified = response.receipt.components.some(s => s.verified && s.memberIds.includes(e.m.id));
          const forces = verified ? response.result.combos[0]?.ef?.get(e)?.f : undefined;
          return <div key={e.m.id}><h4>{e.m.parentSpan ? `Segment ${e.m.parentSpan.fromQuarter * 25}–${e.m.parentSpan.toQuarter * 25}%` : "Member span"}</h4>
            {forces ? <table><caption>Local axes · forces in kN, moments in kN·m</caption>
              <thead><tr><th>Action</th><th>End A</th><th>End B</th></tr></thead>
              <tbody>{["Axial", "Shear Y", "Shear Z", "Torsion", "Moment Y", "Moment Z"].map((axis, i) =>
                <tr key={axis}><th>{axis}</th><td>{units(forces[i])}</td><td>{units(forces[6+i])}</td></tr>)}</tbody></table> : <p>Unavailable for this component.</p>}</div>;
        }) : <p>Member response unavailable.</p>}
      </details>}
    </section>}
    <details open={!!joint || undefined}><summary>Joint freedoms</summary>
      <JointPermissions joints={joints} selected={joint} mode={settings.jointDisplay} select={selectJoint} />
    </details>
    <section><h3>Structural response</h3>
      {draft ? <p>Finish or cancel the draft to inspect committed response.</p>
        : !responseOpen ? <button onClick={onResponse}>Inspect committed response</button>
        : !response ? <p role="status">{reading?.error ?? "Checking the committed structure…"}</p>
        : <>
          <p>Browser solver · committed board after {last ? `turn ${last.turn}` : "setup"} · card gravity {units(gravity)} kN</p>
          <label>Board overlay<select value={layer} onChange={event => setLayer(event.target.value as Layer)}>
            <option value="reference">Reference geometry</option><option value="shape">Deflected shape</option><option value="path">Load transfer</option>
          </select></label>
          {layer === "shape" && <label>Displacement scale · ×{scale}<select value={amplification} onChange={event => setAmplification(Number(event.target.value))}>
            <option value="0">Automatic</option>{[1, 10, 100, 500].map(n => <option key={n} value={n}>×{n}</option>)}
          </select></label>}
          {layer === "shape" && <p>Frame displacement · blue 0 mm to amber {units(1000 * (peakM ?? 0))} mm. Dashed lines show the reference shape.</p>}
          {layer === "path" && <p>Signed gravity transfer along each verified segment, scaled to {units(path?.maxForce ?? 0)} kN. Blue denotes tension, coral compression and violet mixed action. Zero and unavailable transfer have no arrows.</p>}
          {response.receipt.components.map((scope, i) => <p key={i}>{scope.verified ? "Verified" : "Unavailable"} · {scope.reason}</p>)}
          {!!shares?.length && <details><summary>Estimated foundation shares</summary>
            {shares.map(f => <p key={f.jointId}>{owner(turn.board.joints.find(j => j.id === f.jointId)?.foundationOwner ?? "neutral")}
              {" · "}{f.upwardKN === null ? "Unavailable" : `${repairReaction(f.upwardKN)} · ${units(gravity ? 100*f.upwardKN/gravity : 0)}%`}</p>)}
            <p>Upward reactions are positive. Final scoring follows turn 16.</p>
          </details>}
        </>}
    </section>
    {!!last && <details><summary>Turn history</summary>
      {turn.reports.map(publicTurnReport).map(r => <div key={r.turn}><h4>Turn {r.turn} · {owner(r.playerId)}</h4>
        <p>{r.status} · {r.penalty ? "−1 point" : "No deduction"}</p>
        {r.penaltyReasons.map(reason => <p key={reason.id}>Member {reason.memberId} · {reason.reason}</p>)}
      </div>)}<RepairHistory reports={turn.reports} />
    </details>}
  </>;
}
