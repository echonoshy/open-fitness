import { z } from "zod";
import { catalogPlanSchema } from "./catalog-plan";
import { exerciseIds } from "./session";
import { factSchema } from "./knowledge";
import { timedRecordSchema } from "./timed-training";
const rep = z.object({
  count: z.number().int().nonnegative(),
  duration: z.number().nonnegative(),
  eccentric_s: z.number().nonnegative(),
  concentric_s: z.number().nonnegative(),
  min_angle: z.number(),
  full_depth: z.boolean(),
  faults: z.array(z.string()),
  score: z.number().min(0).max(100),
  load_kg: z.number().min(0).max(500).optional(),
  velocity: z.number().nonnegative().optional(),
  similarity: z.number().min(0).max(100).optional(),
  trajectory: z.array(z.number()).max(100).optional(),
  measured: z.boolean().optional(),
  assessment: z
    .object({
      view: z.enum(["front", "oblique", "side", "unknown"]),
      limited: z.boolean(),
      note: z.string().max(200),
    })
    .optional(),
});
export const recordSchema = z.object({
  id: z.string().min(1),
  exercise: z.enum(exerciseIds),
  startedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  duration: z.number().nonnegative(),
  reps: z.array(rep).max(10000),
  holdSeconds: z.number().nonnegative(),
  holdBest: z.number().nonnegative().optional(),
  load: z.number().min(0).max(500),
  goal: z.number().nonnegative(),
  sessionId: z.string().optional(),
  setIndex: z.number().int().optional(),
  blockIndex: z.number().int().optional(),
  source: z.string().optional(),
  exerciseName: z.string().optional(),
  interrupted: z.boolean().optional(),
});
export const referenceEntrySchema = z.object({
  trajectory: z.array(z.number()).min(2).max(100),
  score: z.number().min(0).max(100),
  recorded: z.string(),
  recordId: z.string().min(1).optional(),
  repIndex: z.number().int().nonnegative().optional(),
  startedAt: z
    .string()
    .refine((s) => Number.isFinite(Date.parse(s)))
    .optional(),
});
export const referenceSchema = z.partialRecord(
  z.enum(exerciseIds),
  referenceEntrySchema,
);
export const planIcons = [
  "calendar", "dumbbell", "biceps", "activity", "heart", "flame", "bolt", "target",
  "footprints", "bike", "mountain", "waves", "stretch", "route", "timer", "flag",
  "sun", "moon", "leaf", "wind", "music", "sparkles", "medal", "trophy",
] as const;
export type PlanIcon = (typeof planIcons)[number];
export const defaultPlanIcon: PlanIcon = "calendar";
export const planColors = ["lime", "amber", "orange", "rose", "violet", "sky", "teal", "silver"] as const;
export type PlanColor = (typeof planColors)[number];
export const defaultPlanColor: PlanColor = "lime";
export const savedPlanSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  blocks: catalogPlanSchema,
  icon: z.enum(planIcons).optional(),
  color: z.enum(planColors).optional(),
});
export type SavedPlan = z.infer<typeof savedPlanSchema>;
const savedFactSchema = factSchema.extend({ updatedAt: z.string() });
const trashMeta = { id: z.string().min(1), deletedAt: z.string() };
export const trashEntrySchema = z.discriminatedUnion("kind", [
  z.object({ ...trashMeta, kind: z.literal("plan"), value: savedPlanSchema }),
  z.object({
    ...trashMeta,
    kind: z.literal("profile"),
    value: savedFactSchema,
  }),
  z.object({
    ...trashMeta,
    kind: z.literal("reference"),
    exercise: z.enum(exerciseIds),
    value: referenceEntrySchema,
  }),
]);
export type TrashEntry = z.infer<typeof trashEntrySchema>;
export const dataSchema = z.object({
  version: z.number().int().min(1).max(6).optional(),
  homeShortcuts: z.array(z.string().min(1).max(160)).max(2000).transform(slugs=>[...new Set(slugs)]).optional(),
  freePractice: z
    .object({
      movementSlugs: z.array(z.string().min(1).max(160)).max(2000),
    })
    .optional(),
  settings: z.object({
    language: z.enum(["zh-CN", "en"]).optional(),
    onboardingSeen: z.boolean().optional(),
    backgroundBlur: z.boolean().optional(),
    exerciseReference: z.boolean().optional(),
    exerciseReferenceSize: z
      .enum(["small", "medium", "large"])
      .transform((size) => (size === "small" ? ("medium" as const) : size))
      .optional(),
    voice: z.boolean().optional(),
    coachVoice: z.string().optional(),
    guidance: z.enum(["quiet", "balanced", "active"]).optional(),
    camera: z.string().optional(),
    microphone: z.string().optional(),
    speaker: z.string().optional(),
    cameraLabel: z.string().optional(),
    microphoneLabel: z.string().optional(),
    speakerLabel: z.string().optional(),
  }),
  records: z.array(recordSchema),
  timedRecords: z.array(timedRecordSchema).optional(),
  timedCheckpoint: timedRecordSchema.nullable().optional(),
  profile: z.array(savedFactSchema).optional(),
  plans: z.array(savedPlanSchema).optional(),
  trash: z.array(trashEntrySchema).optional(),
  references: referenceSchema.optional(),
  checkpoint: recordSchema.nullable().optional(),
});
