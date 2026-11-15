import * as THREE from 'three';

type LabelPaint = 'load' | 'reaction' | 'selection';

const PAINT: Record<LabelPaint, [string, string, string]> = {
  load: ['#f2b134', '#22313f', '#704e19'],
  reaction: ['#d2ecc9', '#264a39', '#597965'],
  selection: ['#233442', '#fff6e4', '#ae9c81'],
};

/** Label height as a fraction of the view; the label keeps this size at any zoom. */
const FULL_HEIGHT = 0.032;
/** Force chips are compact so several loads do not hide a small structure. */
const CHIP_HEIGHT = 0.019;

export interface LabelOptions {
  /**
   * Draw at full size and never fade. Used for the selected load, whose label
   * also names its direction. Other force labels are compact chips that fade
   * with distance from the pointer.
   */
  emphasis?: boolean;
}

export function addSceneLabel(group: THREE.Group, position: THREE.Vector3, text: string, style: LabelPaint, options: LabelOptions = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  const font = '700 28px system-ui';
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 34;
  canvas.height = 52;
  const [background, ink, outline] = PAINT[style];
  context.beginPath();
  context.roundRect(3, 3, canvas.width - 6, 42, 14);
  context.fillStyle = background;
  context.strokeStyle = outline;
  context.lineWidth = 2;
  context.fill();
  context.stroke();
  context.fillStyle = ink;
  context.font = font;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  context.fillText(text, canvas.width / 2, 24);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const chip = style !== 'selection' && !options.emphasis;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true,
  }));
  const height = chip ? CHIP_HEIGHT : FULL_HEIGHT;
  label.position.copy(position);
  label.scale.set((canvas.width / canvas.height) * height, height, 1);
  label.center.set(-0.06, 0.22);
  // An emphasised label is drawn over the chips around it.
  label.renderOrder = chip ? 80 : 81;
  if (chip) label.userData.chip = { width: label.scale.x, height };
  group.add(label);
}

export function forceLabel(force: THREE.Vector3) {
  const components = [force.x, force.y, force.z];
  const nonzero = components.flatMap((value, axis) => Math.abs(value) >= 0.005
    ? [{ axis: 'XYZ'[axis], value }] : []);
  const format = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  return nonzero.length === 1
    ? format(Math.abs(nonzero[0].value)) + ' kN ' + (nonzero[0].value < 0 ? '−' : '+') + nonzero[0].axis
    : format(force.length()) + ' kN';
}

/**
 * The chip text of a force. A gravity load shows its magnitude only, because
 * the hanging weight already shows the direction; any other single-axis force
 * keeps its direction.
 */
export function chipLabel(force: THREE.Vector3) {
  const full = forceLabel(force);
  return full.endsWith(' −Z') ? full.slice(0, -3) : full;
}

/** Screen distance within which a chip is fully shown, and beyond which it is fully faded. */
const NEAR_PX = 70, FAR_PX = 280;

/**
 * How strongly a chip is shown, from 0 (far from the pointer) to 1 (at it).
 * Without a pointer over the view, for keyboard and touch use, every chip
 * rests at an even middle value.
 */
export function chipFocus(pointerDistance: number | null): number {
  if (pointerDistance === null) return 0.6;
  return 1 - Math.min(1, Math.max(0, (pointerDistance - NEAR_PX) / (FAR_PX - NEAR_PX)));
}

const projected = new THREE.Vector3();

/**
 * Fade and size the force chips of `group` by their distance from the
 * pointer: bold near it, quiet far from it. A chip never disappears, so the
 * magnitude stays readable without hovering. Call once per frame.
 */
export function updateChipFocus(
  group: THREE.Group, camera: THREE.Camera,
  pointer: { x: number; y: number; inside: boolean }, width: number, height: number,
) {
  for (const child of group.children) {
    const chip = child.userData.chip as { width: number; height: number } | undefined;
    if (!chip || !(child instanceof THREE.Sprite)) continue;
    projected.copy(child.position).project(camera);
    const distance = pointer.inside
      ? Math.hypot(pointer.x - (projected.x * 0.5 + 0.5) * width, pointer.y - (-projected.y * 0.5 + 0.5) * height)
      : null;
    const focus = chipFocus(distance);
    child.material.opacity = 0.45 + 0.55 * focus;
    const grow = 1 + 0.3 * Math.max(0, focus - 0.6) / 0.4;
    child.scale.set(chip.width * grow, chip.height * grow, 1);
  }
}
