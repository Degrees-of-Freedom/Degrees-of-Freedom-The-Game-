import * as THREE from "three";
import {expect,it,vi} from "vitest";
import {disposeGroup} from "./sceneGeometry";

it("retires shared sprite geometry listeners as well as each label texture and material", () => {
  const group = new THREE.Group();
  const sprites = Array.from({length:2}, () => {
    const canvas = {dataset:{sceneTexture:"label",sceneTextureState:"active"}};
    const texture = new THREE.Texture();
    texture.image = canvas;
    const material = new THREE.SpriteMaterial({map:texture});
    const sprite = new THREE.Sprite(material);
    group.add(sprite);
    return {sprite,texture,material,canvas,textureDispose:vi.spyOn(texture,"dispose"),materialDispose:vi.spyOn(material,"dispose")};
  });
  expect(sprites[0].sprite.geometry).toBe(sprites[1].sprite.geometry);
  // WebGLGeometries installs this exact event lifetime per rendering context.
  // A shared geometry held by Three's module must release every such closure.
  const geometry = sprites[0].sprite.geometry;
  const survivingGroup = new THREE.Group();
  const survivingSprite = new THREE.Sprite(new THREE.SpriteMaterial());
  survivingGroup.add(survivingSprite);
  const positions = Array.from(survivingSprite.geometry.getAttribute("position").array);
  const retired = vi.fn();
  const releaseRenderer = () => {retired();geometry.removeEventListener("dispose",releaseRenderer);};
  geometry.addEventListener("dispose",releaseRenderer);
  disposeGroup(group);
  expect(retired).toHaveBeenCalledOnce();
  expect(group.children).toEqual([]);
  for (const label of sprites) {
    expect(label.textureDispose).toHaveBeenCalledOnce();
    expect(label.materialDispose).toHaveBeenCalledOnce();
    expect(label.canvas.dataset.sceneTextureState).toBe("disposed");
  }
  disposeGroup(group);
  expect(retired).toHaveBeenCalledOnce();
  // Geometry disposal retires GPU bindings, not the shared CPU attributes.
  // A still-live renderer can upload this same sprite geometry on its next draw.
  expect(Array.from(survivingSprite.geometry.getAttribute("position").array)).toEqual(positions);
  expect(survivingSprite.geometry.index!.count).toBe(6);
  expect(survivingGroup.children).toEqual([survivingSprite]);
  const nextRenderer = vi.fn();
  geometry.addEventListener("dispose",nextRenderer);
  disposeGroup(survivingGroup);
  expect(nextRenderer).toHaveBeenCalledOnce();
  geometry.removeEventListener("dispose",nextRenderer);
});
