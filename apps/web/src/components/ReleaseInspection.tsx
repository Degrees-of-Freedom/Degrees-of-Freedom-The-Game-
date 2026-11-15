import { useState } from "react";
import type { useGameStore } from "../game/store";
import { activeTurnHand, type TurnState } from "../game/turns";
import { parseNodeKey } from "../game/model";
import { originalPorts, portLabel } from "../game/turnPorts";
import { connectionFrameFor, connectionLabel } from "../game/jointFreedom";
import { publicTurnReport } from "../game/publicTurnModel";
import { repairReaction } from "../game/publicRepairReport";
import { useSettings, updateSettings } from "../menu/settings";
import type { JointPermission } from "../viewer/jointPermissions";
import type { useReleaseInspection } from "../viewer/useReleaseInspection";
import { CardDefinitionDetails } from "./CardDefinitionDetails";
import { JointPermissions } from "./JointPermissions";
import { RepairHistory } from "./RepairHistory";
import { MemberDiagram } from "./MemberDiagram";
import { computeLoadPath } from "../evaluator/loadPath";
import { SectionProfile } from "./SectionProfile";
import { effectiveJointConnections, jointCorrectionMask } from "../game/jointCorrections";
import { memberName } from "../game/cardCatalogue";
import { DISPLACEMENT_SCALES, OVERLAY_LAYERS, type OverlayLayer as Layer } from "../viewer/viewModes";

type Game = ReturnType<typeof useGameStore.getState>;
const units = (n: number) => Number(n.toPrecision(4)).toLocaleString("en", { maximumSignificantDigits: 4 });
const owner = (id: string) => id === "neutral" ? "Neutral repair" : id.replace("player-", "Player ");

function DraftMemberEdit({ member, save }: { member: { id: number; a: string; b: string }; save(id: number, a: string, b: string): string | null }) {
  const [a, setA] = useState(member.a);
  const [b, setB] = useState(member.b);
  const [message, setMessage] = useState("");
  return <form className="release-draft-edit" onSubmit={event => {
    event.preventDefault(); setMessage(save(member.id, a, b) ?? "Draft position updated.");
  }}>
    <label>Draft start x,y,z<input value={a} onChange={event => setA(event.target.value)} /></label>
    <label>Draft end x,y,z<input value={b} onChange={event => setB(event.target.value)} /></label>
    <button type="submit">Update draft member</button>
    {message && <p role="status">{message}</p>}
  </form>;
}

export function ReleaseInspection({ game, turn, joints, joint, selectJoint, draft, awaitingCheckpoint, calculatedTurn,
  reading, layer, peakM, setLayer, scale, amplification, setAmplification }: {
  game: Game; turn: TurnState; joints: JointPermission[]; joint?: JointPermission; selectJoint(id: string): void;
  draft: boolean; reading: ReturnType<typeof useReleaseInspection>;
  awaitingCheckpoint: boolean; calculatedTurn?: number;
  layer: Layer; peakM?: number; setLayer(layer: Layer): void; scale: number; amplification: number; setAmplification(n: number): void;
}) {
  const members = [...turn.board.members, ...turn.draft.members];
  const selection = game.selected;
  const member = selection?.type === "member" ? members.find(m => m.id === selection.id) : null;
  const card = activeTurnHand(turn).find(c => c.id === game.selectedCardId);
  const settings = useSettings();
  const response = draft || awaitingCheckpoint ? undefined : reading?.response;
  const last = turn.reports.at(-1);
  const gravity = turn.board.loads.reduce((sum, load) => sum + load.magnitude, 0);
  const shares = response?.receipt.components.flatMap(scope => scope.foundations);
  const pathVisible = layer === "path" || layer === "combined" || layer === "shadow-path";
  const shapeVisible = layer === "shape" || layer === "combined" || layer === "shadow" || layer === "shadow-path";
  const path = pathVisible && response ? computeLoadPath(response.result, 0) : null;
  const pathPeak = path ? Math.max(0, ...Array.from(path.members.values(), member => member.force)) : 0;
  const submembers = response?.result.ctx?.els.filter(e => member && (e.m.parentSpan?.memberId ?? e.m.id) === member.id) ?? [];
  return <>
    {card && <CardDefinitionDetails card={card} localConnectionAxes={!!turn.rulesRevision} />}
    <label>Inspect member<select value={member?.id ?? ""} onChange={event =>
      game.setSelected(event.target.value ? { type: "member", id: Number(event.target.value) } : null)}>
      <option value="">Choose a member</option>{members.map(m => <option key={m.id} value={m.id}>
        Member {m.id} · {m.assembly ?? memberName(m.type)} · {owner(m.owner)}
      </option>)}
    </select></label>
    {member && <section aria-label="Member properties"><h3>Member {member.id}</h3>
      <p>{owner(member.owner)} · {turn.draft.members.includes(member) ? "Staged" : "Committed"} · {member.assembly ?? memberName(member.type)}</p>
      <SectionProfile type={member.type} assembled={!!member.assembly} />
      {turn.draft.members.includes(member) ? <DraftMemberEdit key={member.id} member={member} save={game.editPlacement} /> : <p>Committed member · read only</p>}
      <p>{units(2 * Math.hypot(...parseNodeKey(member.a).map((n, i) => n - parseNodeKey(member.b)[i])))} m · ({member.a}) → ({member.b})</p>
      <dl>{(["a", "b"] as const).map(end => {
        const conn = [...turn.board.connections, ...turn.draft.connections].find(c => c.memberId === member.id && c.end === end);
        const effective = conn && effectiveJointConnections(turn.board).find(c => c.memberId === conn.memberId && c.end === end);
        return <div key={end}><dt>End {end.toUpperCase()}</dt><dd>{conn ? <>
          Original · {connectionLabel(conn.profile)} · {conn.jointId}
          <details><summary>End {end.toUpperCase()} connection axes</summary>
            <p>{conn.axes ? "Member-local axes, expressed in global X, Y, Z" : "Original global connection frame"}</p>
            {connectionFrameFor(conn).map((axis, i) => <p key={i}>{"XYZ"[i]} ({axis.map(value => Number(value.toFixed(3))).join(", ")})</p>)}
          </details>
          {jointCorrectionMask(turn.board, conn.jointId) > 0 && <p>System fitting · effective {connectionLabel(effective?.profile ?? conn.profile)}. Original card retained.</p>}
        </> : "Unattached"}</dd></div>;
      })}</dl>
      <details><summary>Original ports</summary>{originalPorts(member).map(p => <p key={p.id}>{portLabel(p)} · ({p.point.join(", ")})</p>)}</details>
      {response && <MemberDiagram key={member.id} result={response.result} parent={member.id} />}
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
      <JointPermissions joints={joints} selected={joint} mode={settings.releaseJointDisplay} select={selectJoint}
        onModeChange={releaseJointDisplay => updateSettings({ releaseJointDisplay })} />
    </details>
    <section><h3>Structural response</h3>
      {draft || awaitingCheckpoint ? <p>{calculatedTurn ? `Last calculated turn ${calculatedTurn}. ` : "The structure has not been calculated yet. "}Current changes are assessed at the next scheduled checkpoint.</p>
        : !response ? <p role="status">{reading?.error ?? "Checking the committed structure…"}</p>
        : <>
          <p>Browser solver · committed board after {calculatedTurn ? `turn ${calculatedTurn}` : last ? `turn ${last.turn}` : "setup"} · card gravity {units(gravity)} kN</p>
          <details><summary>Analysis source</summary><p>Solver {response.receipt.solver}</p>
            <p>Simultaneous persistent card gravity · self-weight excluded from this scored state.</p>
            <p>Response model {response.receipt.modelId}</p>
          </details>
          <label>Board overlay<select value={layer} onChange={event => setLayer(event.target.value as Layer)}>
            {/* Option order is relied on by the release browser scripts: keep new layers after "combined". */}
            {(Object.keys(OVERLAY_LAYERS) as Layer[]).map(id => <option key={id} value={id}>{OVERLAY_LAYERS[id]}</option>)}
          </select></label>
          {shapeVisible && <label>Displacement scale · ×{scale}<select value={amplification} onChange={event => setAmplification(Number(event.target.value))}>
            <option value="0">Automatic</option>{DISPLACEMENT_SCALES.map(n => <option key={n} value={n}>×{n}</option>)}
          </select></label>}
          {shapeVisible && <p>Frame displacement · dark blue 0 mm through cyan, green, yellow and orange to red {units(1000 * (peakM ?? 0))} mm.
            {layer.startsWith("shadow") ? " Members stay in place; the translucent shadow and dashed joint travel show the deflected shape." : " Dashed lines show the reference shape."}</p>}
          {pathVisible && <p>Illustrative combined gravity transfer along each verified segment, scaled to {units(pathPeak)} kN. Blue denotes tension, coral compression and violet mixed action. Zero and unavailable transfer have no arrows. This view does not attribute forces to individual loads.</p>}
          {response.receipt.components.map((scope, i) => <p key={i}>{scope.verified ? "Verified" : "Unavailable"} · {scope.reason}</p>)}
          {!!shares?.length && <details><summary>Estimated foundation shares</summary>
            {shares.map(f => <p key={f.jointId}>{owner(turn.board.joints.find(j => j.id === f.jointId)?.foundationOwner ?? "neutral")}
              {" · "}{f.upwardKN === null ? "Unavailable" : `${repairReaction(f.upwardKN)} · ${units(gravity ? 100*f.upwardKN/gravity : 0)}%`}</p>)}
            <p>Upward reactions are positive. Final scoring follows turn 16.</p>
          </details>}
          {!!shares?.length && <details><summary>Foundation forces and moments</summary>
            {shares.map(f => {
              const ctx = response.result.ctx;
              const node = ctx?.idx.get(f.jointId);
              const reaction = ctx && node !== undefined && f.upwardKN !== null ? response.result.combos[0]?.reac?.[ctx.aid[node]] : undefined;
              return <section key={f.jointId}><h4>{owner(turn.board.joints.find(j => j.id === f.jointId)?.foundationOwner ?? "neutral")} · {f.jointId}</h4>
                {reaction ? <table><caption>Signed global support reaction</caption>
                  <thead><tr><th>Axis</th><th>Force (kN)</th><th>Moment (kN·m)</th></tr></thead>
                  <tbody>{["X", "Y", "Z"].map((axis, i) => <tr key={axis}><th>{axis}</th><td>{units(reaction[i])}</td><td>{units(reaction[3 + i])}</td></tr>)}</tbody>
                </table> : <p>Unavailable for this foundation.</p>}
              </section>;
            })}
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
