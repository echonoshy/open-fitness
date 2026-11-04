import { EXERCISES, type Exercise } from "./engine";
import {
  filterHistory,
  historyRange,
  progressByExercise,
  muscleCoverage,
} from "./progress";
import { z } from "zod";
import {
  factSchema,
  categories,
  loadLibrary,
  findExercises,
  plates,
  type Fact,
} from "./knowledge";
import { overview, personalRecords, stats, setSummary } from "./history";
import type { RecordRow, Snapshot } from "./session";
import { exerciseReferenceInfo } from "./exercise-reference";
export const querySchemas = [
  z.object({ type: z.literal("session_query") }).strict(),
  z
    .object({
      type: z.literal("exercise_reference_info"),
      exercise: z
        .enum(Object.keys(EXERCISES) as [Exercise, ...Exercise[]])
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("history_query"),
      exercise: z
        .enum(Object.keys(EXERCISES) as [Exercise, ...Exercise[]])
        .optional()
        .describe("只查询这个动作。用户提到深蹲时填squat；省略表示全部动作。"),
      days: z.number().int().min(1).max(3660).optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(
          (v) =>
            Number.isFinite(Date.parse(v)) &&
            new Date(v).toISOString().startsWith(v),
          "日期无效",
        )
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(
          (v) =>
            Number.isFinite(Date.parse(v)) &&
            new Date(v).toISOString().startsWith(v),
          "日期无效",
        )
        .optional(),
      period: z
        .enum(["this_week", "last_week", "this_month", "last_month"])
        .optional(),
      limit: z.number().int().min(1).max(30).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("exercise_lookup"),
      query: z.string().trim().max(300).default(""),
      muscle: z.string().max(60).optional(),
      equipment: z.string().max(60).optional(),
      level: z.enum(["beginner", "intermediate", "expert"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("plate_calc"),
      target: z.number().min(0).max(500),
      bar: z.number().min(0).max(50).optional(),
      plates: z.array(z.number().min(0.1).max(50)).min(1).max(20).optional(),
    })
    .strict(),
  z.object({ type: z.literal("profile_query") }).strict(),
] as const;
export const memorySchemas = [
  z.object({ type: z.literal("remember"), ...factSchema.shape }).strict(),
  z
    .object({
      type: z.literal("forget"),
      category: z.enum(categories),
      key: z.string().min(1).max(80),
    })
    .strict(),
] as const;
export const querySchema = z.discriminatedUnion("type", querySchemas);
export const memorySchema = z.discriminatedUnion("type", memorySchemas);
export async function queryData(
  raw: unknown,
  records: RecordRow[],
  profile: Fact[],
  currentState?: Snapshot,
) {
  const c = querySchema.parse(raw);
  if (c.type === "exercise_reference_info") {
    const exercise = c.exercise ?? currentState?.exercise;
    if (!exercise) throw Error("请指定要讲解的动作");
    return exerciseReferenceInfo(exercise);
  }
  if (c.type === "session_query") {
    if (!currentState) throw Error("当前会话状态尚未提供");
    return { state: currentState };
  }
  if (c.type === "profile_query") return profile;
  if (c.type === "history_query") {
    if (c.from && c.to && c.from > c.to)
      throw Error("开始日期不能晚于结束日期");
    if ((c.days ? 1 : 0) + (c.period ? 1 : 0) + (c.from || c.to ? 1 : 0) > 1)
      throw Error("日期范围、最近天数和相对周期只能选一种");
    const selected = filterHistory(records, c);
    return {
      filter: c,
      range: historyRange(c),
      progress: progressByExercise(selected),
      muscleCoverage: muscleCoverage(selected),
      overview: overview(selected),
      personalRecords: personalRecords(selected),
      recent: selected.slice(-(c.limit ?? 10)).map((r) => ({
        ...r,
        reps: undefined,
        summary: stats(r),
        description: setSummary(r),
      })),
    };
  }
  if (c.type === "exercise_lookup")
    return findExercises(await loadLibrary(), c.query, c, 5).map((r) => ({
      ...r,
      text: r.text?.slice(0, 2500),
    }));
  return plates(c.target, c.bar, c.plates);
}

export function scopedHistoryQuery<
  T extends { type: string; exercise?: string },
>(args: T, text: string): T & { exercise?: string } {
  if (
    args.type !== "history_query" ||
    args.exercise ||
    /除|所有|全部|其他/.test(text)
  )
    return args;
  const aliases: Record<string, string[]> = {
    squat: ["深蹲"],
    pushup: ["俯卧撑"],
    bench: ["卧推"],
    deadlift: ["硬拉"],
    lunge: ["弓步蹲", "弓步"],
    shoulder_press: ["向上推举", "肩上推举", "推肩"],
    curl: ["弯举"],
    pullup: ["引体向上"],
    plank: ["平板支撑"],
  };
  const matches = Object.entries(aliases).filter(([, names]) =>
    names.some((n) => text.includes(n)),
  );
  if (
    matches.length !== 1 ||
    !matches[0][1].some((n) =>
      new RegExp(n + ".{0,4}(记录|历史|表现|成绩)").test(text),
    )
  )
    return args;
  return { ...args, exercise: matches[0][0] };
}
