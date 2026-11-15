import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chipFocus, chipLabel, forceLabel, updateChipFocus } from './sceneLabels';

describe('scene force labels', () => {
  it('keeps the sign and axis for directional loads', () => {
    expect(forceLabel(new THREE.Vector3(0, -15.5, 0))).toEqual('15.5 kN −Y');
    expect(forceLabel(new THREE.Vector3(0, 0, 20))).toEqual('20 kN +Z');
  });

  it('uses the magnitude of a multi-axis force', () => {
    expect(forceLabel(new THREE.Vector3(3, 4, 0))).toEqual('5 kN');
  });
});

describe('force chips', () => {
  it('drops the direction of a gravity load and keeps it for any other force', () => {
    expect(forceLabel(new THREE.Vector3(0, 0, -50))).toBe('50 kN −Z');
    expect(chipLabel(new THREE.Vector3(0, 0, -50))).toBe('50 kN');
    expect(chipLabel(new THREE.Vector3(0, 0, 12.5))).toBe('12.5 kN +Z');
    expect(chipLabel(new THREE.Vector3(-20, 0, 0))).toBe('20 kN −X');
    expect(chipLabel(new THREE.Vector3(3, 0, 4))).toBe('5 kN');
  });

  it('is bold near the pointer, quiet far from it, and even without a pointer', () => {
    expect(chipFocus(0)).toBe(1);
    expect(chipFocus(70)).toBe(1);
    expect(chipFocus(175)).toBeCloseTo(0.5, 9);
    expect(chipFocus(280)).toBe(0);
    expect(chipFocus(5000)).toBe(0);
    expect(chipFocus(null)).toBe(0.6);
  });

  it('fades and sizes chips by pointer distance without ever hiding one', () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    const group = new THREE.Group();
    const chip = (x: number) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
      sprite.position.set(x, 0, 0);
      sprite.userData.chip = { width: 0.05, height: 0.019 };
      group.add(sprite);
      return sprite;
    };
    // On an 800 px wide view these sit at x = 400 and x = 800.
    const near = chip(0), far = chip(1);
    const other = new THREE.Sprite(new THREE.SpriteMaterial({ opacity: 0.2 }));
    group.add(other);
    updateChipFocus(group, camera, { x: 400, y: 300, inside: true }, 800, 600);
    expect(near.material.opacity).toBe(1);
    expect(near.scale.x).toBeCloseTo(0.065, 9);
    expect(far.material.opacity).toBeCloseTo(0.45, 9);
    expect(far.scale.y).toBeCloseTo(0.019, 9);
    // A sprite that is not a chip is left alone.
    expect(other.material.opacity).toBe(0.2);
    updateChipFocus(group, camera, { x: 400, y: 300, inside: false }, 800, 600);
    expect(near.material.opacity).toBeCloseTo(0.78, 9);
    expect(far.material.opacity).toBeCloseTo(0.78, 9);
    expect(near.scale.x).toBeCloseTo(0.05, 9);
  });
});
