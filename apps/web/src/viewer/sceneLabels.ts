import * as THREE from 'three';

type LabelPaint = 'load' | 'reaction' | 'selection';

const PAINT: Record<LabelPaint, [string, string, string]> = {
  load: ['#f2b134', '#22313f', '#704e19'],
  reaction: ['#d2ecc9', '#264a39', '#597965'],
  selection: ['#233442', '#fff6e4', '#ae9c81'],
};

export function addSceneLabel(group: THREE.Group, position: THREE.Vector3, text: string, style: LabelPaint) {
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
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false,
  }));
  label.position.copy(position);
  label.scale.set((canvas.width / canvas.height) * 0.032, 0.032, 1);
  label.center.set(-0.06, 0.22);
  label.renderOrder = 80;
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
