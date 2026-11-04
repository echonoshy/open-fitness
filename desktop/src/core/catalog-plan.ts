import { z } from "zod";
import { EXERCISES } from "./engine";
import {
  blockSchema,
  type Command,
  type SessionEngine,
  type Snapshot,
} from "./session";
import { effectiveMovementProfile } from "./movement-statistics";
import type { Movement } from "./movement-library";
import type { TimedTraining } from "./timed-training";

const movementBlockSchema = blockSchema
  .omit({ exercise: true })
  .extend({
    movementSlug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9-]+$/),
    movementName: z.string().min(1).max(200),
    unit: z.enum(["reps", "seconds"]),
  })
  .strict();
const anyBlock = z.union([blockSchema, movementBlockSchema]);
export type PlanBlock = z.infer<typeof anyBlock>;
export const blockUnit = (block: PlanBlock) =>
  "unit" in block
    ? block.unit
    : block.exercise === "plank"
      ? "seconds"
      : "reps";
export const blockName = (block: PlanBlock) =>
  "movementName" in block
    ? block.movementName
    : EXERCISES[block.exercise].label;
export const catalogPlanSchema = z
  .array(anyBlock)
  .min(1)
  .max(20)
  .refine(
    (blocks) =>
      blocks.every((b) => blockUnit(b) === "seconds" || b.target <= 100),
    "每组次数最多 100 次",
  );
export const catalogPlanControl = z.discriminatedUnion("type", [
  blockSchema.pick({ target: true, load: true, rest: true }).extend({
    type: z.literal("adjust_plan_set"),
    setId: z.string().min(1),
  }),
  z
    .object({
      type: z.literal("start_catalog_program"),
      blocks: catalogPlanSchema,
    })
    .strict(),
  z.object({ type: z.literal("complete_plan_set") }).strict(),
  z.object({ type: z.literal("skip_remaining_sets") }).strict(),
]);
export type PlanCommand = z.infer<typeof catalogPlanControl>;
export type PlanSetAdjustment = Extract<PlanCommand, { type: "adjust_plan_set" }>;
export function blockForMovement(
  item: Movement,
  previous?: PlanBlock,
): PlanBlock {
  const exercise = item.trainingExercise;
  const unit = exercise
    ? exercise === "plank"
      ? "seconds"
      : "reps"
    : effectiveMovementProfile(item).mode === "reps"
      ? "reps"
      : "seconds";
  const settings = {
    sets: previous?.sets ?? 3,
    rest: previous?.rest ?? 60,
    load: previous?.load ?? 0,
    target:
      previous && blockUnit(previous) === unit
        ? previous.target
        : unit === "reps"
          ? 12
          : 30,
  };
  return exercise
    ? { ...settings, exercise }
    : {
        ...settings,
        movementSlug: item.slug,
        movementName: item.name,
        unit,
      };
}

export function resolvePlan(blocks: PlanBlock[], library: Movement[]) {
  const checked = catalogPlanSchema.safeParse(blocks);
  if (!checked.success) throw Error("请检查组数、每组目标、休息时间和负重。");
  const bySlug = new Map(library.map((item) => [item.slug, item]));
  return checked.data.map((block) => {
    if ("exercise" in block) return { block, movement: null, camera: true };
    const movement = bySlug.get(block.movementSlug);
    if (!movement)
      throw Error(
        "动作库中找不到「" + block.movementName + "」，请重新选择这个动作。",
      );
    const current = blockForMovement(movement, block);
    if (blockUnit(current) !== block.unit)
      throw Error(
        "「" + movement.name + "」的统计方式已更新，请重新选择动作并设置目标。",
      );
    return {
      block: current,
      movement: "exercise" in current ? null : movement,
      camera:
        !!movement.trainingExercise ||
        effectiveMovementProfile(movement).mode !== "timer",
    };
  });
}
type Resolved = ReturnType<typeof resolvePlan>;
type Result = { ok: boolean; message: string };
const success = (message: string): Result => ({ ok: true, message });
const fail = (message: string): Result => ({ ok: false, message });
export type PlanPosition = {
  sessionId: string;
  blockIndex: number;
  setIndex: number;
};
export type CatalogPlanView = {
  setId: string;
  block: number;
  set: number;
  blocks: number;
  sets: number;
  restSeconds: number;
  next: string;
  skipTo?: string;
  between: boolean;
};

/** Only sequences sets. The same two training engines used for individual
 * movements own the camera frames, measurements and records throughout. */
export class CatalogPlan {
  private items: Resolved = [];
  private block = 0;
  private set = 1;
  private sessionId = "";
  private between = false;
  private paused = false;
  private deadline = 0;
  private restLeft = 0;
  private setRest = 0;
  constructor(
    private engine: SessionEngine,
    private timed: TimedTraining,
  ) {}
  get active() {
    return this.items.length > 0;
  }
  get needsCamera() {
    return this.items.some((item) => item.camera);
  }
  private get current() {
    return this.items[this.block];
  }
  private next() {
    if (this.set < this.current.block.sets)
      return { block: this.block, set: this.set + 1 };
    return this.block + 1 < this.items.length
      ? { block: this.block + 1, set: 1 }
      : null;
  }
  view(): CatalogPlanView | undefined {
    if (!this.active) return;
    const next = this.next();
    return {
      setId: `${this.sessionId}/${this.block}/${this.set}`,
      block: this.block,
      set: this.set,
      blocks: this.items.length,
      sets: this.current.block.sets,
      restSeconds: this.setRest,
      between: this.between,
      next: next
        ? blockName(this.items[next.block].block) + " · 第 " + next.set + " 组"
        : "",
      skipTo: this.between && next?.block === this.block && this.items[this.block + 1]
        ? blockName(this.items[this.block + 1].block)
        : undefined,
    };
  }
  overlay(): Partial<Pick<Snapshot, "status" | "remaining" | "catalogPlan">> {
    if (!this.active) return {};
    const remaining = this.paused
      ? this.restLeft
      : Math.max(0, this.deadline - this.engine.now());
    return {
      catalogPlan: this.view(),
      ...(this.between
        ? {
            status: this.paused ? ("paused" as const) : ("resting" as const),
            remaining,
          }
        : {}),
    };
  }
  start(items: Resolved): Result {
    if (this.active || this.engine.active || this.timed.active)
      return fail("请先结束当前训练，再开始计划。");
    if (!items.length) return fail("请先选择计划动作。");
    if (items.some((i) => i.camera) && !this.engine.cameraReady)
      return fail("摄像头就绪后才能开始这个计划。");
    this.items = items;
    this.block = 0;
    this.set = 1;
    this.sessionId = crypto.randomUUID();
    this.beginSet();
    return success("计划已开始，共 " + items.length + " 个动作。");
  }
  private beginSet() {
    const { movement, block } = this.current;
    this.setRest = block.rest;
    const position = {
      sessionId: this.sessionId,
      blockIndex: this.block,
      setIndex: this.set,
    };
    this.between = false;
    this.paused = false;
    this.restLeft = 0;
    this.timed.select(movement);
    if ("exercise" in block) {
      this.engine.dispatch({
        type: "set_exercise",
        exercise: block.exercise,
        restart: true,
      });
    }
    this.applySetValues(block.target, block.load);
    this.raw({ type: "session", action: "start" });
    if (movement) this.timed.planPosition = position;
    else this.engine.planPosition = position;
  }
  private applySetValues(target: number, load: number): Result {
    const reps = blockUnit(this.current.block) === "reps";
    if (reps && target > 100) return fail("本组目标最多 100 次。");
    const goal = this.raw(reps
      ? { type: "set_rep_goal", reps: target }
      : { type: "set_hold_goal", seconds: target });
    return goal.ok ? this.raw({ type: "set_load", kg: load }) : goal;
  }
  private archive() {
    if (this.timed.active) this.timed.finish();
    else if (this.engine.active) {
      this.engine.dispatch({ type: "session", action: "end" });
      // Finishing a specialist engine session closes one plan set.
      this.engine.events = this.engine.events.filter(
        (event) => event.type !== "finish",
      );
    }
    this.timed.planPosition = undefined;
    this.engine.planPosition = undefined;
    this.applySetValues(this.current.block.target, this.current.block.load);
  }
  private raw(command: Command): Result {
    return this.current.movement
      ? this.timed.dispatch(command)
      : this.engine.dispatch(command);
  }
  complete(restSeconds?: number): Result {
    if (!this.active || this.between || this.paused)
      return fail("请在本组训练中完成当前组。");
    const status = this.current.movement
      ? this.timed.snapshot()?.status
      : this.engine.snapshot().status;
    if (status !== "training") return fail("请先继续训练，再完成本组。");
    this.archive();
    if (!this.next()) {
      this.items = [];
      return success("计划已完成。");
    }
    this.between = true;
    this.deadline = this.engine.now() + (restSeconds ?? this.setRest);
    return success("本组完成，准备下一组。");
  }
  skipRemainingSets(): Result {
    if (!this.active || this.paused || !this.view()?.skipTo)
      return fail("只能在同一动作的组间休息时跳过剩余组。");
    return this.advance({ block: this.block + 1, set: 1 });
  }
  private advance(next = this.next()): Result {
    if (!next) return fail("已没有下一组。");
    if (this.items[next.block].camera && !this.engine.cameraReady) {
      this.restLeft = 0;
      this.paused = true;
      return fail("请开启摄像头后继续计划。");
    }
    this.block = next.block;
    this.set = next.set;
    this.beginSet();
    return success(
      "开始" + blockName(this.current.block) + "第 " + this.set + " 组。",
    );
  }
  tick(): Result | undefined {
    if (!this.active || this.paused) return;
    if (this.between)
      return this.engine.now() >= this.deadline ? this.advance() : undefined;
    const timed = this.timed.snapshot();
    const state = timed ?? this.engine.snapshot();
    if (state.status !== "training") return;
    let value: number;
    if (timed) {
      if (timed.statistics.mode === "reps")
        value = timed.manualReps ?? timed.statistics.reps;
      else
        value = timed.cameraStatistics
          ? timed.statistics.seconds
          : timed.elapsed;
    } else
      value =
        this.engine.exercise === "plank"
          ? this.engine.plank.total
          : this.engine.rows.length;
    const reps = blockUnit(this.current.block) === "reps";
    const target = timed
      ? (reps ? timed.goalReps : timed.goalSeconds)
      : (reps ? this.engine.goal : this.engine.holdGoal);
    if (value >= target) return this.complete();
  }
  pause(): Result {
    if (!this.active) return fail("当前没有训练计划。");
    if (!this.paused) {
      if (this.between)
        this.restLeft = Math.max(0, this.deadline - this.engine.now());
      else this.raw({ type: "session", action: "pause" });
      this.paused = true;
    }
    return success("计划已暂停。");
  }
  stop(): Result {
    if (!this.active) return fail("当前没有训练计划。");
    if (!this.between) this.archive();
    this.items = [];
    return success("计划已结束。");
  }
  command(command: Command | PlanSetAdjustment): Result {
    if (command.type === "adjust_plan_set") {
      if (!this.active || this.between || this.view()?.setId !== command.setId)
        return fail("本组已结束，请在当前组重新调整。");
      const result = this.applySetValues(command.target, command.load);
      if (!result.ok) return result;
      this.setRest = command.rest;
      return this.tick() ?? success("本组设置已生效。");
    }
    if (command.type === "stop_program") return this.stop();
    if (command.type === "session") {
      if (command.action === "end") return this.stop();
      if (command.action === "pause") return this.pause();
      if (command.action === "cancel_rest" && this.between) {
        if (this.paused) {
          this.restLeft = 0;
          return success("继续计划后进入下一组。");
        }
        return this.advance();
      }
      if (command.action === "resume" || command.action === "start") {
        if (!this.paused) return fail("计划正在进行中。");
        if (this.between) {
          this.deadline = this.engine.now() + this.restLeft;
          this.paused = false;
          return success("计划已继续。");
        }
        const result = this.raw({ type: "session", action: "resume" });
        if (result.ok) this.paused = false;
        return result;
      }
      return this.raw(command);
    }
    if (command.type === "rest_timer") return this.complete(command.seconds);
    if (
      !this.between &&
      (command.type === "cues" || command.type === "set_rep_goal" ||
        command.type === "set_hold_goal" || command.type === "set_load" ||
        command.type === "set_tempo")
    )
      return this.raw(command);
    return fail(this.between ? "组间休息中，请在下一组开始后调整。" : "计划进行中，请先结束计划再切换训练。");
  }
}
