import { z } from "zod";
import { type GameModel, type LevelId } from "./model";
import { type VoxelLevel, type VoxelModel } from "../solver/voxelInput";
import { ITEMS, S } from "../solver/voxelSections";
import { COMBOS, GAMMA } from "../solver/voxelLoads";

// This format captures the existing voxel solver, not the proposed general FEA model.
const gridKey = z.string().regex(/^(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*)$/);
const number = z.number().finite();
const memberType = z.enum(["shs", "glulam", "ipe", "heb", "cable"]);
const attrs = z
  .strictObject({
    found: z.boolean().optional(),
    joint: z.boolean().optional(),
    load: number.positive().optional(),
    locked: z.boolean().optional(),
    target: z.boolean().optional(),
    restraint: z
      .tuple([
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
      ])
      .optional(),
    loadDirection: z.enum(["-Z", "+Z", "+X", "-X", "+Y", "-Y"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.restraint && !!value.found !== value.restraint.some(Boolean))
      ctx.addIssue({
        code: "custom",
        message: "Support flags do not match restraints.",
      });
    if (value.loadDirection && !value.load)
      ctx.addIssue({
        code: "custom",
        message: "A load direction requires a load.",
      });
  });
const modelSchema = z
  .strictObject({
    members: z.array(
      z.strictObject({
        id: z.number().int().positive().safe(),
        a: gridKey,
        b: gridKey,
        type: memberType,
      }),
    ),
    attrs: z.record(gridKey, attrs),
    nextId: z.number().int().positive().safe(),
  })
  .superRefine((model, ctx) => {
    const ids = new Set<number>();
    for (const member of model.members) {
      if (
        ids.has(member.id) ||
        member.id >= model.nextId ||
        member.a === member.b
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Member IDs must be unique and below nextId; endpoints must differ.",
        });
      ids.add(member.id);
    }
  });
const levelId = z.enum([
  "library",
  "tower1",
  "tower2",
  "bridge1",
  "bridge2",
  "pickup1",
  "pickup2",
  "pickupR",
  "sandbox",
  "environment",
]);
const gameSaveSchema = z.strictObject({
  format: z.literal("dof-voxel-save"),
  version: z.literal(1),
  levelId,
  model: modelSchema,
});
const inventory = z.strictObject({
  shs: number.optional(),
  glulam: number.optional(),
  ipe: number.optional(),
  heb: number.optional(),
  cable: number.optional(),
  joint: number.optional(),
  found: number.optional(),
});
const solverLevel = z
  .strictObject({
    type: z.enum(["tower", "bridge", "pickup", "sandbox"]),
    q0: number,
    loadCase: z.enum(['applied', 'design']).optional(),
    budget: number.nullable(),
    inv: inventory.nullable(),
    target: number.optional(),
    payload: number.optional(),
    cliffL: number.optional(),
    cliffR: number.optional(),
    cliffH: number.optional(),
    ys: z.array(number).optional(),
    traffic: number.optional(),
    groundHeights: z.record(gridKey, number).optional(),
  })
  .superRefine((level, ctx) => {
    if (
      (level.type === "tower" && level.payload === undefined) ||
      (level.type === "bridge" &&
        (level.cliffL === undefined ||
          level.cliffR === undefined ||
          level.cliffH === undefined ||
          level.traffic === undefined))
    )
      ctx.addIssue({
        code: "custom",
        message: "Missing level-specific solver inputs.",
      });
  });
const analysisSchema = z.strictObject({
  format: z.literal("dof-voxel-analysis"),
  version: z.literal(1),
  solverProfile: z.string(),
  model: modelSchema,
  level: solverLevel,
});

export type GameSave = z.infer<typeof gameSaveSchema>;
export type VoxelAnalysisSnapshot = z.infer<typeof analysisSchema>;

/** Create a detached and validated save; JSON output is portable and versioned. */
export function createGameSave(id: LevelId, model: GameModel): GameSave {
  return gameSaveSchema.parse({
    format: "dof-voxel-save",
    version: 1,
    levelId: id,
    model,
  });
}

/** Accept v1 or the old unversioned model. Never interpret a future envelope as legacy. */
export function readGameSave(
  value: unknown,
  id: LevelId,
): { save: GameSave; migrated: boolean } {
  if (
    typeof value === "object" &&
    value !== null &&
    ("format" in value || "version" in value)
  ) {
    const save = gameSaveSchema.parse(value);
    if (save.levelId !== id)
      throw new Error("Saved level does not match its storage key.");
    return { save, migrated: false };
  }
  return { save: createGameSave(id, modelSchema.parse(value)), migrated: true };
}

// The current voxel solver reads these constants directly. Record them and reject
// replay if they change; increment the algorithm version when its semantics change.
function currentProfile(): string {
  return JSON.stringify({
    algorithm: "voxel-experimental-2",
    cellSize: S,
    sections: ITEMS,
    combinations: COMBOS,
    factors: GAMMA,
  });
}

/** Freeze the actual inputs and solver profile required by the experimental solver. */
export function createVoxelAnalysisSnapshot(
  model: VoxelModel,
  level: VoxelLevel,
): VoxelAnalysisSnapshot {
  return analysisSchema.parse({
    format: "dof-voxel-analysis",
    version: 1,
    solverProfile: currentProfile(),
    model,
    level: {
      ...level,
      budget: level.budget === Infinity ? null : level.budget,
    },
  });
}

/** Validate and detach a snapshot before passing it to the matching solver. */
export function recomposeVoxelAnalysis(value: unknown): {
  model: VoxelModel;
  level: VoxelLevel;
} {
  const snapshot = analysisSchema.parse(value);
  if (snapshot.solverProfile !== currentProfile())
    throw new Error("Snapshot requires a different voxel solver profile.");
  return {
    model: snapshot.model,
    level: { ...snapshot.level, budget: snapshot.level.budget ?? Infinity },
  };
}
