import { type Port, type Point, type Play } from "./catalogue";
import { position, type OriginalModel, type Span } from "./geometry";

/** Labels name the original port even where several members meet at one point. */
export function loadTargets(model: OriginalModel, drafts: Play[]) {
  const targets: {at:Port; point:Point; label:string}[]=[];
  const geometry: {spans: Pick<Span,"id"|"a"|"b">[]}={spans:[...model.spans]};
  for (const p of drafts) {
    if (p.kind!=="member") continue;
    const point=(t:typeof p.a)=>Array.isArray(t) ? t : position(geometry,t);
    geometry.spans.push({id:p.cardId,a:point(p.a),b:point(p.b)});
  }
  for(const span of geometry.spans) {
    for(const quarter of [0,1,2,3,4] as const) {
      const at={memberId:span.id,quarter};
      const point=position(geometry,at);
      const station=["end A","¼","midpoint","¾","end B"][quarter];
      targets.push({at,point,label:span.id+" · "+station+" ("+point.join(", ")+")"});
    }
  }
  return targets;
}
