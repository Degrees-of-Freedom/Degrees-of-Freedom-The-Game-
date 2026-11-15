import { useState } from "react";
import { updateSettings } from "../menu/settings";
import type { JointComponents, JointDisplay, JointPermission } from "../viewer/jointPermissions";
import "./jointPermissions.css";

const words = { free: "Free", locked: "Locked", elastic: "Elastic", coupled: "Coupled", unavailable: "Unavailable", conflict: "Conflict", inactive: "Inactive" };
const axes = ["X", "Y", "Z"];
function Components({ values, name }: { values: JointComponents; name: string }) {
  return <table aria-label={name}><caption>{name}</caption>
    <thead><tr><td />{axes.map(axis => <th key={axis} scope="col">{axis}</th>)}</tr></thead>
    <tbody>{["Translation", "Rotation"].map((group, i) => <tr key={group}>
      <th scope="row">{group}</th>{axes.map((axis, j) =>
        <td key={axis} title={`${i ? "R" : "U"}${axis}`}>{words[values[i * 3 + j]]}</td>)}
    </tr>)}</tbody></table>;
}

export function JointPermissions({ joints, selected, mode, select }: {
  joints: JointPermission[]; selected?: JointPermission; mode: JointDisplay; select: (id: string) => void;
}) {
  const [local, setLocal] = useState(false);
  return <section className="joint-permissions" aria-label="Joint permissions">
    <h3>Joint permissions</h3>
    <label>Joint display<select value={mode} onChange={event => updateSettings({ jointDisplay: event.target.value as JointDisplay })}>
      <option value="selected">Selected joint</option><option value="all">All joints</option><option value="off">Off</option>
    </select></label>
    {mode !== "off" && <>
      <label>Inspect joint<select value={selected?.id ?? ""} onChange={event => select(event.target.value)}>
        <option value="">Choose a joint ({joints.length})</option>
        {joints.map(joint => <option key={joint.id} value={joint.id}>
          {joint.id}{joint.id !== joint.point ? ` at (${joint.point})` : ""}{joint.ground ? " · ground" : ""} · {joint.profile}
        </option>)}
      </select></label>
      {selected ? <>
        <p aria-live="polite"><strong>{selected.profile}</strong> · ({selected.point})</p>
        {selected.parent && <p>{selected.parent} Permissions below apply to external attachments.</p>}
        <label>Reference axes<select value={local ? "local" : "global"} onChange={event => setLocal(event.target.value === "local")}>
          <option value="global">Global X / Y / Z</option><option value="local">Local connection axes</option>
        </select></label>
        <p>{local ? selected.frame
          ? "Local connection axes in global coordinates · " + selected.frame.map((axis, i) =>
            axes[i] + " (" + axis.map(n => Number(n.toFixed(3))).join(", ") + ")").join(" · ")
          : "The model has no oriented connection frame. Values below use global axes." : "Global axes · Z up."}</p>
        <Components name="Connection permissions" values={!local && selected.global ? selected.global : selected.components} />
        {!local && selected.global?.includes("coupled") && <p>Coupled axes share an oblique permission. Inspect the local connection axes for its direction.</p>}
        <p>Motion of an attached end relative to its joint.</p>
        {selected.ground && <><Components name="Ground restraints" values={selected.ground} /><p>Motion relative to ground, in global axes.</p></>}
        {selected.attachments.length > 0 && <details><summary>Attached ends ({selected.attachments.length})</summary>
          <ul>{selected.attachments.map(end => <li key={end}>{end}</li>)}</ul></details>}
      </> : <p>Choose a joint to inspect its six motion components.</p>}
      <p className="joint-legend">Straight axes show translation. Curves show rotation. Bars mark locks, arrowheads mark freedom, and zigzags mark springs. The striped base marks ground. Leaders locate each joint.</p>
    </>}
  </section>;
}
