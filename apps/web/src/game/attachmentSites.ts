import { nodeKey, parseNodeKey, type Member } from "./model";

export type InteriorSite = "q1" | "q2" | "q3";
/** The original member's station. The legacy field name `end` is retained in events. */
export type AttachmentSite = "a" | "b" | InteriorSite;
export interface InteriorContact { quarter: 1 | 2 | 3; target: string }

export function isInteriorSite(site: AttachmentSite): site is InteriorSite {
  return site === "q1" || site === "q2" || site === "q3";
}

export function isAttachmentSite(value: unknown): value is AttachmentSite {
  return value === "a" || value === "b" || value === "q1" || value === "q2" || value === "q3";
}

export function attachmentQuarter(site: AttachmentSite): 0 | 1 | 2 | 3 | 4 {
  if (site === "a") return 0;
  if (site === "b") return 4;
  return site === "q1" ? 1 : site === "q2" ? 2 : 3;
}

export function attachmentPoint(member: Pick<Member, "a" | "b">, site: AttachmentSite): string {
  if (!isInteriorSite(site)) return member[site];
  const a = parseNodeKey(member.a), b = parseNodeKey(member.b), q = attachmentQuarter(site) / 4;
  return nodeKey(...a.map((v, i) => v + (b[i] - v) * q) as [number, number, number]);
}

export function attachmentLabel(site: AttachmentSite): string {
  return isInteriorSite(site) ? `${attachmentQuarter(site) * 25}%` : `end ${site.toUpperCase()}`;
}

export function attachmentId(memberId: number, site: AttachmentSite): string {
  return isInteriorSite(site) ? `port:${memberId}:${attachmentQuarter(site)}` : `endpoint:${memberId}:${site}`;
}

export function supportsInteriorCollar(member: Pick<Member, "type" | "assembly">): boolean {
  return member.type !== "cable" && member.type !== "spring" && !member.assembly;
}
