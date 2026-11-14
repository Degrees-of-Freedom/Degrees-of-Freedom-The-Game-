import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { forceLabel } from './sceneLabels';

describe('scene force labels', () => {
  it('keeps the sign and axis for directional loads', () => {
    expect(forceLabel(new THREE.Vector3(0, -15.5, 0))).toEqual('15.5 kN −Y');
    expect(forceLabel(new THREE.Vector3(0, 0, 20))).toEqual('20 kN +Z');
  });

  it('uses the magnitude of a multi-axis force', () => {
    expect(forceLabel(new THREE.Vector3(3, 4, 0))).toEqual('5 kN');
  });
});
