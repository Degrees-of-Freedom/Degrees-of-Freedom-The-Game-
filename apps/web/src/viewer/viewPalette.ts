/**
 * Colours shared by the Grow Dusk board overlays and their legends. The scene
 * builders and the legend cards both import these values, so a legend always
 * describes the colour actually drawn. Hex strings work with both
 * `THREE.Color` and CSS.
 */
export const LOAD_PATH_COLORS = {
  /** Member body colours while the load path is shown. */
  tension: "#4da3ff",
  compression: "#ff6b4a",
  bending: "#c58cff",
  idle: "#5a6370",
} as const;

/** Transfer arrows are lighter than the member bodies they sit on. */
export const LOAD_PATH_ARROWS = {
  tension: "#87caff",
  compression: "#ff9977",
  bending: "#d8b4ff",
} as const;

export const RESULT_ARROWS = {
  /** Applied card gravity in the growth styles. */
  load: "#f2b134",
  reaction: "#3aab72",
} as const;

export const DIAGRAM_COLORS = { shear: "#80e6b6", moment: "#ff94d5" } as const;

export const INSTABILITY_COLOR = "#ff477e";

/** Joint glyph axis paints, X / Y / Z. */
export const JOINT_AXIS_COLORS = ["#ffa48f", "#a1e797", "#9ccfff"] as const;

/** Reference geometry, displacement drop lines and the shadow's outline. */
export const REFERENCE_COLOR = "#ffefd4";
