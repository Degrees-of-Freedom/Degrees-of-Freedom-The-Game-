import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DISPLACEMENT_RAMP, displacementColor, displacementGradient } from "./contourRamp";

const hex = (fraction: number) => "#" + displacementColor(fraction).getHexString();

describe("SAP-style displacement contour", () => {
  it("runs dark blue → cyan → green → yellow → orange → red at evenly spaced stops", () => {
    DISPLACEMENT_RAMP.forEach((stop, i) => expect(hex(i / (DISPLACEMENT_RAMP.length - 1))).toBe(stop));
  });
  it("clamps out-of-range and non-finite fractions to the ends", () => {
    expect(hex(-1)).toBe(DISPLACEMENT_RAMP[0]);
    expect(hex(7)).toBe(DISPLACEMENT_RAMP.at(-1));
    expect(hex(Number.NaN)).toBe(DISPLACEMENT_RAMP[0]);
  });
  it("interpolates between neighbouring stops and writes into a supplied colour", () => {
    const target = new THREE.Color();
    const mid = displacementColor(0.1, target);
    expect(mid).toBe(target);
    const expected = new THREE.Color(DISPLACEMENT_RAMP[0]).lerp(new THREE.Color(DISPLACEMENT_RAMP[1]), 0.5);
    expect(mid.getHex()).toBe(expected.getHex());
  });
  it("gives legends the same stops in the same order", () => {
    expect(displacementGradient).toBe(`linear-gradient(90deg, ${DISPLACEMENT_RAMP.join(", ")})`);
  });
});
