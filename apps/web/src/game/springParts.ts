import { localAxes } from '../solver/frameMath';
import { SPRING } from '../solver/voxelSections';
import { CELL_SIZE, parseNodeKey, type GridPoint, type Member } from './model';

/** The eight turns join five solid square collars on the original line. The
 * wire centreline is sampled at sixteen pieces per revolution. Metre dimensions
 * and normalized parent stations serve both the clearance check and the mesh. */
export function springParts(member: Pick<Member, 'a' | 'b'>) {
  const start = parseNodeKey(member.a), end = parseNodeKey(member.b);
  const delta = end.map((n, i) => (n-start[i])*CELL_SIZE);
  const length = Math.hypot(...delta);
  if (!length) return [];
  const [, side, up] = localAxes(delta.map(n => n/length));
  const point = (station: number, angle?: number) => start.map((value,i) => {
    const radial = angle === undefined ? 0 : SPRING.coilDiameterM/2*(Math.cos(angle)*side[i]+Math.sin(angle)*up[i]);
    return value + (delta[i]*station + radial)/CELL_SIZE;
  }) as GridPoint;
  const pieces: {a: GridPoint; b: GridPoint; from: number; to: number; width: number; collar: boolean}[] = [];
  const halfCollar = Math.min(SPRING.wireDiameterM/length, 1/32);
  for (let q = 0; q <= 4; q++) {
    const station = q/4, from = Math.max(0,station-halfCollar), to = Math.min(1,station+halfCollar);
    pieces.push({a:point(from),b:point(to),from,to,width:SPRING.coilDiameterM+SPRING.wireDiameterM,collar:true});
    if (q === 4) break;
    const next = (q+1)/4-halfCollar;
    const divisions = SPRING.turns/4*16;
    for (let i=0; i<divisions; i++) {
      const f = to+(next-to)*i/divisions, t = to+(next-to)*(i+1)/divisions;
      pieces.push({a:point(f,2*Math.PI*i/16),b:point(t,2*Math.PI*(i+1)/16),from:f,to:t,width:SPRING.wireDiameterM,collar:false});
    }
  }
  return pieces;
}
