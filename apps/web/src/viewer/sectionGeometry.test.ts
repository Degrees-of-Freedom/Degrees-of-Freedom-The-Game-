import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SECTION_GEOMETRY } from "../solver/voxelSections";
import { poseSection, READABLE_SECTION_SCALE, rectangularHollowGeometry, roundHollowGeometry, wideFlangeGeometry } from "./sectionGeometry";

describe.each(["ipe", "heb"] as const)("%s wide flange", type => {
  const section = SECTION_GEOMETRY[type];
  it("uses the physical width, depth, web and two flange thicknesses with an open profile", () => {
    const geometry = wideFlangeGeometry(type);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(section.width, 7);
    expect(size.y).toBeCloseTo(section.depth, 7);
    expect(size.z).toBe(1);
    expect(geometry.getAttribute("position").count / 3).toBe(44);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    function hits(x: number, y: number) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1));
      return ray.intersectObject(mesh).length > 0;
    }
    expect(hits(section.web / 2 - 1e-5, 0)).toBe(true);
    expect(hits(section.web / 2 + 1e-5, 0)).toBe(false);
    for (const side of [-1, 1]) {
      const flangeEdge = section.depth / 2 - section.flange;
      expect(hits(section.width / 3, side * (flangeEdge + 1e-5))).toBe(true);
      expect(hits(section.width / 3, side * (flangeEdge - 1e-5))).toBe(false);
    }
    geometry.dispose();
    mesh.material.dispose();
  });

  it.each([[2, 0, 0], [-2, 0, 0], [0, 0, 6], [0, 0, -6], [2, 3, 4], [0.01, 0.01, 6]])(
    "preserves endpoints, transverse dimensions and solver roll along (%d,%d,%d)", (x, y, z) => {
      const start = new THREE.Vector3(1, -3, 2);
      const delta = new THREE.Vector3(x, y, z), end = start.clone().add(delta);
      const mesh = new THREE.Mesh(wideFlangeGeometry(type), new THREE.MeshBasicMaterial());
      poseSection(mesh, start, end, delta);
      mesh.updateMatrixWorld();
      expect(mesh.localToWorld(new THREE.Vector3(0, 0, -0.5)).distanceTo(start)).toBeLessThan(1e-10);
      expect(mesh.localToWorld(new THREE.Vector3(0, 0, 0.5)).distanceTo(end)).toBeLessThan(1e-10);
      const width = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      expect(width.dot(delta)).toBeCloseTo(0, 8);
      const nearVertical = Math.abs(z) / delta.length() > 0.999;
      if (nearVertical) expect(width.y).toBeGreaterThan(0.999);
      else expect(width.dot(new THREE.Vector3(-y, x, 0).normalize())).toBeCloseTo(1, 10);
      expect(mesh.scale.toArray()).toEqual([READABLE_SECTION_SCALE, READABLE_SECTION_SCALE, delta.length()]);
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  );
});

describe("hollow physical sections", () => {
  it.each([
    {name:"square", width:.1, depth:.1, wall:.006},
    {name:"rectangular", width:.1, depth:.2, wall:.006},
  ])("keeps both $name tube ends open with real walls and independent readable scale", ({width,depth,wall}) => {
    const geometry = rectangularHollowGeometry({width,depth,wall});
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const fromEnd = (x:number, side:number) => new THREE.Raycaster(
      new THREE.Vector3(x,0,side), new THREE.Vector3(0,0,-side)).intersectObject(mesh);
    for (const side of [-1,1]) {
      expect(fromEnd(0,side)).toHaveLength(0);
      expect(fromEnd(width/2-wall/2,side).length).toBeGreaterThan(0);
      expect(fromEnd(width/2-wall-1e-5,side)).toHaveLength(0);
    }
    const inside = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(1,0,0)).intersectObject(mesh);
    expect(inside[0].distance).toBeCloseTo(width/2-wall,7);
    const start = new THREE.Vector3(2,3,4), end = new THREE.Vector3(4,6,8);
    poseSection(mesh,start,end,end.clone().sub(start),1);
    expect(mesh.scale.x).toBe(1);
    expect(mesh.scale.y).toBe(1);
    poseSection(mesh,start,end,end.clone().sub(start));
    expect(mesh.scale.x).toBe(READABLE_SECTION_SCALE);
    expect(mesh.scale.y).toBe(READABLE_SECTION_SCALE);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual(expect.arrayContaining([
      expect.closeTo(width,7),expect.closeTo(depth,7),1,
    ]));
    geometry.dispose(); material.dispose();
  });

  it("shows the circular bore, annular rims and inner wall from both ends", () => {
    const geometry = roundHollowGeometry();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const {outerDiameter,wall} = SECTION_GEOMETRY.chs;
    for (const side of [-1,1]) {
      const ray = (x:number) => new THREE.Raycaster(new THREE.Vector3(x,0,side),new THREE.Vector3(0,0,-side)).intersectObject(mesh);
      expect(ray(0)).toHaveLength(0);
      expect(ray(outerDiameter/2-wall/2).length).toBeGreaterThan(0);
      expect(ray(outerDiameter/2-wall-1e-5)).toHaveLength(0);
    }
    const inside = new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(1,0,0)).intersectObject(mesh);
    expect(inside[0].distance).toBeCloseTo(outerDiameter/2-wall,6);
    geometry.dispose(); material.dispose();
  });
});
