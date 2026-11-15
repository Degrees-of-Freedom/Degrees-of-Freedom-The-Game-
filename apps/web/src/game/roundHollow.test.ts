import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../solver/voxelSections';
import { roundHollowGeometry } from '../viewer/sectionGeometry';
import { HOLLOW_CATALOGUE, printedCards } from './cardCatalogue';
import { findMaterialClash } from './materialClashes';
import type { Member } from './model';

describe('CHS 100×6 physical printing', () => {
  it('uses the area, bending and torsional constants of a round annulus', () => {
    const s = ITEMS.chs;
    expect(s.A).toBeCloseTo(Math.PI/4 * (0.1**2 - 0.088**2), 14);
    expect(s.Iy).toBeCloseTo(Math.PI/64 * (0.1**4 - 0.088**4), 16);
    expect(s.Iz).toBe(s.Iy);
    expect(s.J).toBe(2*s.Iy);
    expect(printedCards(0,HOLLOW_CATALOGUE).element).toMatchObject({type:'chs',kind:'element'});
  });
  it('permits an axial cable in the bore and rejects a cable running in the wall', () => {
    const tube: Member = {id:1,type:'chs',a:'1,0,0',b:'3,0,0'};
    const cable: Member = {id:2,type:'cable',a:'0,0,0',b:'4,0,0'};
    expect(findMaterialClash(cable,[tube])).toBeNull();
    expect(findMaterialClash({...cable,a:'0,0.023,0',b:'4,0.023,0'},[tube])).toMatch(/intersect/);
    expect(findMaterialClash({...cable,a:'0,0.04,0',b:'4,0.04,0'},[tube])).toBeNull();
  });
  it('leaves the hollow centre open at both ends and renders the annular rim', () => {
    const mesh = new THREE.Mesh(roundHollowGeometry(), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    const hits = (x: number, sign: number) => new THREE.Raycaster(new THREE.Vector3(x,0,sign),new THREE.Vector3(0,0,-sign)).intersectObject(mesh).length;
    for (const sign of [-1,1]) {
      expect(hits(0,sign)).toBe(0);
      expect(hits(.047,sign)).toBeGreaterThan(0);
      expect(hits(.051,sign)).toBe(0);
    }
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});
