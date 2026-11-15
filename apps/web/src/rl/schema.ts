import { z } from "zod";
import { GOAL_SCENARIO_IDS } from "./scenarios";

const point = z.tuple([z.number().int(), z.number().int(), z.number().int()]);

/** Wire format of an action; mirrors `GoalAction`. */
export const GoalActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("foundation"), at: point }),
  z.object({
    kind: z.literal("member"),
    a: point,
    b: point,
    type: z.enum(["shs", "glulam", "ipe", "heb", "cable", "spring"]),
  }),
  z.object({ kind: z.literal("joint"), at: point }),
  z.object({ kind: z.literal("finish") }),
]);

const scenario = z.enum(GOAL_SCENARIO_IDS as [string, ...string[]]);

/** One request line of the agent bridge. */
export const BridgeRequestSchema = z.object({
  /** Echoed in the response so a client can match them up. */
  id: z.union([z.string(), z.number()]).optional(),
  method: z.enum(["reset", "step", "actions"]),
  params: z
    .object({
      scenario: scenario.optional(),
      seed: z.number().int().optional(),
      /** Choose from the last `actions` list. */
      actionIndex: z.number().int().nonnegative().optional(),
      /** Or give an explicit action; it is still checked against the rules. */
      action: GoalActionSchema.optional(),
      /** Include one numeric feature row per legal action. */
      features: z.boolean().optional(),
    })
    .default({}),
});
export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;
