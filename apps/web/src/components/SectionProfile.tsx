import { useId } from "react";
import type { EvaluatorMemberType } from "../evaluator/model";
import { SECTION_GEOMETRY } from "../evaluator/sections";

/** An end-on physical section, independent of readable board enlargement.
 * Even-odd fills preserve the bore instead of painting a solid end cap. */
export function SectionProfile({type, assembled = false}: {type: EvaluatorMemberType; assembled?: boolean}) {
  const title = useId();
  const section = SECTION_GEOMETRY[type];
  if (section.kind === "helix") return null;
  const millimetres = (n: number) => Math.round(n * 10000) / 10;
  const width = "width" in section ? section.width : "outerDiameter" in section ? section.outerDiameter : section.diameter;
  const depth = "depth" in section ? section.depth : width;
  const extent = Math.max(width, depth) * .7;
  const rectangle = (w: number, h: number) => `M${-w/2},${-h/2}h${w}v${h}h${-w}Z`;
  let outline: string;
  if (section.kind === "rectangular-hollow") {
    outline = rectangle(width, depth) + rectangle(width - 2 * section.wall, depth - 2 * section.wall);
  } else if (section.kind === "wide-flange") {
    const w = width/2, d = depth/2, f = section.flange, t = section.web/2;
    outline = `M${-w},${-d}H${w}V${-d+f}H${t}V${d-f}H${w}V${d}H${-w}V${d-f}H${-t}V${-d+f}H${-w}Z`;
  } else outline = rectangle(width, depth);
  const circular = section.kind === "round-hollow" || section.kind === "cable";
  const wall = "wall" in section ? section.wall : undefined;
  return <figure className="release-section-profile">
    <figcaption>{assembled ? "Assembly chord section" : "Physical section"} · end-on</figcaption>
    <svg viewBox={`${-extent} ${-extent} ${2*extent} ${2*extent}`} width="150" height="150" role="img" aria-labelledby={title}>
      <title id={title}>{section.kind} section, {millimetres(width)} by {millimetres(depth)} millimetres{wall ? `, ${millimetres(wall)} millimetre wall, open bore` : ""}</title>
      {circular ? <>
        {wall ? <circle r={(width-wall)/2} fill="none" stroke="#d2e4f2" strokeWidth={wall} />
          : <circle r={width/2} fill="#d2e4f2" />}
      </> : <path d={outline} fill="#d2e4f2" fillRule="evenodd" />}
    </svg>
    <p>{millimetres(width)} × {millimetres(depth)} mm{wall !== undefined && ` · wall ${millimetres(wall)} mm`}
      {"web" in section && ` · web ${millimetres(section.web)} mm · flange ${millimetres(section.flange)} mm`}</p>
    <small>Physical dimensions. Board enlargement changes appearance only. Local Y horizontal, local Z vertical.</small>
  </figure>;
}
