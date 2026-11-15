import { z } from "zod";
import { CELL_SIZE } from "../../game/model";

export const metresPerUnit = CELL_SIZE;
export const fieldCells = 15;
export const springReference = { id: "k0-v1", unit: "N/m" } as const;
export const members = {
  standard: { law: "axial-and-bending" },
  cable: { law: "tension-only", restState: "unstretched-reference-span" },
  springQuarter: { law: "axial-spring", factor: 0.25 },
  springHalf: { law: "axial-spring", factor: 0.5 },
} as const;
export const maxLength = z.union([z.literal(5), z.literal(7), z.literal(10)]);
export const rotationCount = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const id = z.string().min(1);
export const card = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("member"), id, variant: z.enum(membersKeys()), maxLength }),
  z.strictObject({ kind: z.literal("connection"), id, count: rotationCount }),
  z.strictObject({ kind: z.literal("load"), id, downwardN: z.number().positive() }),
]);
function membersKeys() {
  return ["standard", "cable", "springQuarter", "springHalf"] as const;
}
export type Card = z.infer<typeof card>;
/** k0 is a ruleset input in N/m, independent of current/reference span length. */
export function springStiffnessNPerM(variant:"springQuarter"|"springHalf", k0NPerM:number|null) {
  if(k0NPerM===null) return null;
  return members[variant].factor*z.number().positive().parse(k0NPerM);
}
export const sources = z.enum(["elementsLoads", "connections"]);
export type Source = z.infer<typeof sources>;
export const coordinate = z.tuple([z.int().nonnegative(), z.int().nonnegative(), z.int().nonnegative()]);
export type Point = z.infer<typeof coordinate>;
export const port = z.strictObject({ memberId: id, quarter: z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
]) });
export type Port = z.infer<typeof port>;
export const target = z.union([coordinate, port]);
export const play = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("member"), cardId: id, a: target, b: target }),
  z.strictObject({ kind: z.literal("load"), cardId: id, at: port }),
  z.strictObject({ kind: z.literal("connection"), cardId: id, from: port, to: port,
    mask: z.int().min(1).max(7) }),
]);
export type Play = z.infer<typeof play>;
export const configuration = z.strictObject({
  matchId: id, height: z.int().positive(), rounds: z.int().positive(),
  k0NPerM: z.number().positive().nullable(),
  players: z.array(z.strictObject({ id, x: z.int().min(0).max(15), y: z.int().min(0).max(15) })).min(2),
  // Ordered instances. The caller authors deck composition and shuffle before setup.
  cards: z.array(card),
});
export type Configuration = z.infer<typeof configuration>;
export function sourceOf(c: Card): Source {
  return c.kind === "connection" ? "connections" : "elementsLoads";
}
