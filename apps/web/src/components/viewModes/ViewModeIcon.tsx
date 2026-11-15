import type { ReactElement } from "react";
import type { ViewModeId } from "../../viewer/viewModes";
import { DIAGRAM_COLORS, INSTABILITY_COLOR, JOINT_AXIS_COLORS, LOAD_PATH_ARROWS, RESULT_ARROWS } from "../../viewer/viewPalette";
import { DISPLACEMENT_RAMP } from "../../viewer/contourRamp";

/** 24-unit line icons. Decorative: every use sits beside a text label. */
const glyphs: Record<ViewModeId, ReactElement> = {
  loadPath: <>
    <path d="M12 3v6" stroke={LOAD_PATH_ARROWS.compression} />
    <path d="M12 9 6 15M12 9l6 6" stroke={LOAD_PATH_ARROWS.tension} />
    <path d="m4 13 2 2 2-2M16 13l2 2 2-2" />
    <path d="M3 20h18" />
  </>,
  deflected: <>
    <path d="M4 18V7M20 18V7" />
    <path d="M4 7q8 7 16 0" stroke={DISPLACEMENT_RAMP[4]} />
    <path d="M3 20h18" />
  </>,
  shadow: <>
    <path d="M4 7h16M4 18V7M20 18V7" />
    <path d="M4 9q8 7 16 0" stroke={DISPLACEMENT_RAMP[3]} strokeDasharray="2 2" opacity=".85" />
    <path d="M12 7v5" strokeDasharray="1.5 1.5" />
  </>,
  joints: <>
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 3v5M12 16v5" stroke={JOINT_AXIS_COLORS[2]} />
    <path d="M3 12h5M16 12h5" stroke={JOINT_AXIS_COLORS[0]} />
    <path d="M6.5 6.5a7.8 7.8 0 0 1 4-2" stroke={JOINT_AXIS_COLORS[1]} />
  </>,
  reactions: <>
    <path d="M12 2v7m-3-3 3 3 3-3" stroke={RESULT_ARROWS.load} />
    <path d="M7 11h10" />
    <path d="M12 22v-7m-3 3 3-3 3 3" stroke={RESULT_ARROWS.reaction} />
  </>,
  shear: <>
    <path d="M3 12h18" />
    <path d="M4 12V7h8v10h8v-5" stroke={DIAGRAM_COLORS.shear} />
  </>,
  moment: <>
    <path d="M3 12h18" />
    <path d="M4 12q8 12 16 0" stroke={DIAGRAM_COLORS.moment} />
  </>,
  instability: <>
    <path d="M12 3 2 20h20Z" stroke={INSTABILITY_COLOR} />
    <path d="M12 9v5M12 17v.5" />
  </>,
};

export function ViewModeIcon({ mode }: { mode: ViewModeId }) {
  return <svg className="view-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{glyphs[mode]}</svg>;
}

/** The view panel's eye button. */
export function EyeIcon() {
  return <svg className="view-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}
