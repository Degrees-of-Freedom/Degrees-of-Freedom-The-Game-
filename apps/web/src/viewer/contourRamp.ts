import * as THREE from "three";

/**
 * SAP-style displacement contour required by the visualization criteria:
 * dark blue for the least displacement, then cyan, green, yellow and orange to
 * red for the greatest. The 3D geometry and the CSS legend both read these
 * stops so the legend cannot drift from what the board draws.
 */
export const DISPLACEMENT_RAMP = ["#1e40af", "#24c9ed", "#43d68b", "#f5e65b", "#f19c38", "#ef5548"] as const;

const ramp = DISPLACEMENT_RAMP.map(hex => new THREE.Color(hex));

/** Colour for a displacement fraction of the displayed peak, clamped to [0, 1]. Non-finite input reads as zero. */
export function displacementColor(fraction: number, target = new THREE.Color()) {
  const t = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const scaled = t * (ramp.length - 1);
  const low = Math.min(ramp.length - 2, Math.floor(scaled));
  return target.copy(ramp[low]).lerp(ramp[low + 1], scaled - low);
}

/** CSS gradient of the same stops, for legends. */
export const displacementGradient = `linear-gradient(90deg, ${DISPLACEMENT_RAMP.join(", ")})`;
