import { type Card, type Configuration, type Play, type Point, type Port } from "./catalogue";

export interface Origin { actor: string; turn: number; modelRevision: number }
export interface Span {
  id: string; a: Point; b: Point; owner: string; setup: boolean;
  variant: Extract<Card, {kind:"member"}>["variant"];
}
export interface OriginalModel {
  foundations: { id: string; owner: string; at: Point; fixed: true }[];
  spans: Span[];
  plays: (Origin & { play: Play })[];
}
export function requireRule(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
export function setup(config: Configuration): OriginalModel {
  const foundations = config.players.map(p => ({
    id: "foundation/" + p.id, owner: p.id, at: [p.x,p.y,0] as Point, fixed: true as const,
  }));
  return { foundations, spans: config.players.map(p => ({
    id: "column/" + p.id, owner: p.id, setup: true, variant: "standard",
    a: [p.x,p.y,0], b: [p.x,p.y,1],
  })), plays: [] };
}
const diff = (a: Point,b: Point): Point => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: Point,b: Point) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: Point,b: Point): Point =>
  [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const along = (a: Point,d: Point,t: number): Point => [a[0]+t*d[0],a[1]+t*d[1],a[2]+t*d[2]];
export function position(model: {spans: Pick<Span,"id"|"a"|"b">[]}, port: Port): Point {
  const span = model.spans.find(s => s.id === port.memberId);
  requireRule(span, "Unknown original member");
  return along(span.a, diff(span.b,span.a), port.quarter/4);
}
// Exact centreline overlap or interior crossing. End contact at an original
// quarter is permitted; contact alone never establishes a shared joint.
function clashes(a: Point,b: Point,s: Span) {
  const u = diff(b,a), v = diff(s.b,s.a), w = diff(s.a,a);
  const n = cross(u,v), denominator = dot(n,n);
  if (!denominator) {
    if (Math.hypot(...cross(w,u))) return false;
    const t = dot(w,u)/dot(u,u), end = dot(diff(s.b,a),u)/dot(u,u);
    return Math.min(1,Math.max(t,end)) > Math.max(0,Math.min(t,end));
  }
  if (dot(w,n) !== 0) return false;
  const t = dot(cross(w,v),n)/denominator, r = dot(cross(w,u),n)/denominator;
  if (Math.min(t,r)<0 || Math.max(t,r)>1) return false;
  return !(((t===0 || t===1) && Number.isInteger(4*r)) ||
    ((r===0 || r===1) && Number.isInteger(4*t)));
}
const portKey = (p: Port) => JSON.stringify([p.memberId,p.quarter]);
export function applyPlay(model: OriginalModel, card: Card, play: Play, origin: Origin, height: number) {
  requireRule(card.kind === play.kind && card.id === play.cardId, "Card does not permit this action");
  if (play.kind === "member" && card.kind === "member") {
    const [a,b] = [play.a,play.b].map(t => Array.isArray(t) ? t : position(model,t));
    for (const p of [a,b]) requireRule(p[0]<=15 && p[1]<=15 && p[2]<=height, "Outside field");
    const length = Math.hypot(...diff(b,a));
    requireRule(length>0 && length<=card.maxLength, "Outside printed span");
    requireRule(!model.spans.some(s=>clashes(a,b,s)), "Member centrelines clash");
    model.spans.push({id:card.id, a,b,owner:origin.actor,setup:false,variant:card.variant});
  } else if (play.kind === "load") {
    position(model,play.at);
  } else if (play.kind === "connection" && card.kind === "connection") {
    requireRule(play.from.memberId !== play.to.memberId && [0,4].includes(play.from.quarter),
      "Attach an end to another original member");
    requireRule(!Math.hypot(...diff(position(model,play.from),position(model,play.to))), "Ports must coincide");
    requireRule(play.mask.toString(2).replace(/0/g,"").length === card.count, "Wrong rotational mask");
    const from = portKey(play.from), to = portKey(play.to);
    // Connected components have one common global rotation profile. Distinct
    // coincident components can be joined only when both profiles agree.
    const component = new Set([from]);
    const edges = model.plays.flatMap(p=>p.play.kind === "connection" ? [p.play] : []);
    for (let size = -1; size !== component.size;) {
      size = component.size;
      for (const edge of edges) {
        const a = portKey(edge.from), b = portKey(edge.to);
        if (component.has(a) || component.has(b)) { component.add(a); component.add(b); }
      }
    }
    requireRule(!component.has(to), "Ports already connected");
    for (const edge of edges) {
      if ([edge.from,edge.to].some(p=>[from,to].includes(portKey(p))))
        requireRule(edge.mask === play.mask, "Existing joint profile is locked");
    }
    if (model.spans.some(s=>s.setup && [play.from.memberId,play.to.memberId].includes(s.id)))
      requireRule(play.mask === 7, "Setup profile is fully fixed");
  }
  model.plays.push({...origin, play});
}
