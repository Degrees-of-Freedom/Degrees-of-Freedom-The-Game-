import { useId, useMemo, useState } from "react";
import type { VoxelAnalysis } from "../evaluator/results";
import { cutActions, sectionCuts } from "../viewer/sectionCuts";

const short = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 });

/** The chart and its accessible station table consume the same local +x-face
 * samples. Axial-only members have no section shear or bending diagram. */
export function MemberDiagram({ result, parent }: { result: VoxelAnalysis; parent: number }) {
  const [selected, setSelected] = useState(0);
  const [part, setPart] = useState("");
  const title = useId();
  const all = useMemo(() => sectionCuts(result, parent), [result, parent]);
  const branches = [...new Set(all.flatMap(s => s.part ? [s.part] : []))];
  const current = branches.includes(part) ? part : branches[0];
  const series = current ? all.filter(s => s.part === current) : all;
  const axialOnly = series.length > 0 && series.every(s => s.axialOnly);
  const index = axialOnly ? 0 : selected;
  const action = cutActions[index], unit = index < 3 ? "kN" : "kN·m";
  const points = series.flatMap(s => s.cuts);
  const values = points.map(p => p.forces[index]);
  const lower = Math.min(0, ...values), upper = Math.max(0, ...values);
  const extent = upper-lower;
  const x = (t: number) => 44 + 228*t;
  const y = (f: number) => extent ? 102 - 82*(f-lower)/extent : 61;
  return <section className="release-diagram" aria-label="Section force diagrams">
    <h4>Section force diagrams</h4>
    {!!branches.length && <label>Assembly part<select value={current} onChange={e => setPart(e.target.value)}>
      {branches.map(name => <option key={name}>{name}</option>)}
    </select></label>}
    <label>Section action<select value={index} onChange={e => setSelected(Number(e.target.value))}>
      {cutActions.map((text, i) => <option key={text} value={i} disabled={axialOnly && i > 0}>{text}</option>)}
    </select></label>
    {axialOnly && <p>This axial member carries tension or compression along its chord. Section shear, torsion and bending are unavailable.</p>}
    {points.length > 0 ? <>
      <svg viewBox="0 0 286 132" role="img" aria-labelledby={title}>
        <title id={title}>{action} from {short.format(lower)} to {short.format(upper)} {unit}, local positive cut face</title>
        <path d={`M44 15V108M44 ${y(0)}H272`} fill="none" stroke="currentColor" strokeWidth="1" />
        <text x="40" y={y(upper)+3} textAnchor="end">{short.format(upper)}</text>
        {extent > 0 && <text x="40" y={y(lower)+3} textAnchor="end">{short.format(lower)}</text>}
        {series.map(s => <g key={s.key}>
          <polyline points={s.cuts.map(c => x(c.at)+","+y(c.forces[index])).join(" ")} fill="none" stroke="#ffcc84" strokeWidth="2.4" />
          {s.cuts.map((cut, i) => <circle key={i} cx={x(cut.at)} cy={y(cut.forces[index])} r="2.3" fill="#ffcc84" />)}
        </g>)}
        <text x="44" y="125">A · 0%</text><text x="272" y="125" textAnchor="end">100% · B</text>
      </svg>
      <p>{action} ({unit}) · member-local positive X face. Axial tension is positive. Lines join the evaluated cuts from A to B.</p>
      <details><summary>Signed station readings</summary><table>
        <thead><tr><th>Span</th><th>Station</th><th>{action} ({unit})</th></tr></thead>
        <tbody>{series.flatMap(s => s.cuts.map((cut, i) => <tr key={s.key+"/"+i}>
          <td>{s.key}</td><td>{short.format(cut.at*100)}%</td><td>{short.format(cut.forces[index])}</td>
        </tr>))}</tbody>
      </table></details>
    </> : <p>No verified station readings for this member.</p>}
    {series.filter(s => s.reason).map(s => <p key={s.key}>Span {s.key} · {s.reason}</p>)}
    {result.reference && <small>Rust {result.reference.solverVersion} · {result.reference.fidelity} · committed card gravity</small>}
  </section>;
}
