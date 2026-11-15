/** Vector and frame-axis helpers shared by the structure evaluator and the
 * legacy voxel kernel. Element end vectors are twelve components: start
 * translation, start rotation, end translation and end rotation. */
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};

export function localAxes(ex: number[]) {
  // Near vertical, project the preferred world-Y reference onto the member's
  // normal plane. A literal Y would cease to be orthogonal on a slight incline.
  let ey = [0, 1, 0];
  if (Math.abs(ex[2]) <= 0.999) ey = norm(cross([0, 0, 1], ex));
  else if (ex[1] !== 0) ey = norm([-ex[0]*ex[1], 1-ex[1]*ex[1], -ex[2]*ex[1]]);
  const ez = cross(ex, ey);
  return [ex, ey, ez];
}
export function vecToLocal(ug: Float64Array, R: number[][]) {
  const ul = new Float64Array(12);
  for (let p = 0; p < 4; p++)
    for (let a = 0; a < 3; a++)
      ul[p * 3 + a] =
        R[a][0] * ug[p * 3] + R[a][1] * ug[p * 3 + 1] + R[a][2] * ug[p * 3 + 2];
  return ul;
}
export function vecToGlobal(fl: Float64Array, R: number[][]) {
  const fg = new Float64Array(12);
  for (let p = 0; p < 4; p++)
    for (let i = 0; i < 3; i++)
      fg[p * 3 + i] =
        R[0][i] * fl[p * 3] + R[1][i] * fl[p * 3 + 1] + R[2][i] * fl[p * 3 + 2];
  return fg;
}
