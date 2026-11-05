import { z } from "zod";
import type { Movement } from "./movement-library";
import { commandSchema, type Command } from "./session";
import type { Point } from "./engine";
import {
  MovementStatistics,
  movementProfile,
  effectiveMovementProfile,
  movementCalibration,
  statisticLabel,
  type StatisticSnapshot,
} from "./movement-statistics";

const statisticsSchema = z.object({
  mode: z.enum(["reps", "hold", "activity", "timer"]),
  reps: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
  family: z.string(),
  source: z.literal("estimated"),
  ruleVersion: z.literal(1),
  goalReps: z.number().int().min(1).max(100),
});

export const timedRecordSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  planName: z.string().min(1).max(80).optional(),
  setIndex: z.number().int().positive(),
  blockIndex: z.number().int().nonnegative().optional(),
  movementSlug: z.string().min(1).max(160),
  movementName: z.string().min(1).max(200),
  startedAt: z.string().refine((s) => Number.isFinite(Date.parse(s))),
  duration: z.number().nonnegative(),
  goalSeconds: z.number().int().min(1).max(600),
  load: z.number().min(0).max(500),
  manualReps: z.number().int().min(0).max(1000).optional(),
  mode: z.literal("timed"),
  statistics: statisticsSchema.optional(),
  interrupted: z.boolean().optional(),
});
export type TimedRecord = z.infer<typeof timedRecordSchema>;
export type TimedSnapshot = {
  movement: Movement;
  status: "ready" | "training" | "paused" | "resting";
  elapsed: number;
  remaining: number;
  goalSeconds: number;
  load: number;
  manualReps?: number;
  setIndex: number;
  goalReps: number;
  statistics: StatisticSnapshot;
  cameraStatistics: boolean;
  cameraStatisticsAvailable: boolean;
};

/** Shared catalog session: wall clock, estimated pose statistics and correction
 * remain separate so old timers and manual entries never become measured reps. */
export class TimedTraining {
  planPosition?: import("./catalog-plan").PlanPosition;
  movement: Movement | null = null;
  pending: TimedRecord[] = [];
  goalSeconds = 60;
  load = 0;
  manualReps?: number;
  goalReps = 12;
  private statistics = new MovementStatistics(movementProfile({ slug: "" }));
  private cameraEnabled = true;
  get cameraStatistics() {
    return this.cameraEnabled && this.statistics.profile.mode !== "timer";
  }
  setCameraStatistics(enabled: boolean) {
    if (this.active) throw Error("请先结束本组，再切换统计方式。");
    this.cameraEnabled = enabled;
    this.configureStatistics();
  }
  private configureStatistics() {
    if (!this.movement) return;
    const profile = effectiveMovementProfile(this.movement);
    const reference = movementCalibration(this.movement.slug);
    if (!this.cameraEnabled) profile.mode = "timer";
    this.statistics = new MovementStatistics(profile, reference?.target);
  }
  frame(points: Point[], t: number, aspect: number) {
    this.tick();
    if (this.status === "training" && this.cameraStatistics)
      this.statistics.frame(points, t, aspect);
    else this.statistics.breakContinuity();
  }
  cameraLost() {
    this.statistics.breakContinuity();
    this.statistics.notice = "摄像头已关闭，自动统计暂停；训练时长继续记录";
  }
  private status: TimedSnapshot["status"] = "ready";
  private elapsedBefore = 0;
  private runningSince = 0;
  private restUntil = 0;
  private pausedRest = 0;
  private id = "";
  private sessionId = "";
  private startedAt = "";
  private setIndex = 1;
  constructor(private now = () => performance.now() / 1000) {}
  get active() {
    return this.status !== "ready";
  }
  select(movement: Movement | null) {
    this.finish();
    this.movement = movement;
    this.sessionId = "";
    this.setIndex = 1;
    this.goalSeconds = 60;
    this.load = 0;
    this.manualReps = undefined;
    this.goalReps = 12;
    this.cameraEnabled = true;
    this.configureStatistics();
  }
  private tick() {
    if (this.status === "resting" && this.now() >= this.restUntil) {
      this.status = "training";
      // Include elapsed foreground time after the rest deadline, not the rest.
      this.runningSince = this.restUntil;
    }
  }
  private elapsed() {
    this.tick();
    return (
      this.elapsedBefore +
      (this.status === "training"
        ? Math.max(0, this.now() - this.runningSince)
        : 0)
    );
  }
  private freeze() {
    this.elapsedBefore = this.elapsed();
    this.runningSince = this.now();
    this.statistics.breakContinuity();
  }
  private begin() {
    this.sessionId ||= crypto.randomUUID();
    this.id = crypto.randomUUID();
    this.startedAt = new Date().toISOString();
    this.elapsedBefore = 0;
    this.runningSince = this.now();
    this.manualReps = undefined;
    this.pausedRest = 0;
    this.status = "training";
    this.statistics.reset();
  }
  snapshot(): TimedSnapshot | undefined {
    if (!this.movement) return;
    const elapsed = this.elapsed();
    return {
      movement: this.movement,
      status: this.status,
      elapsed,
      remaining:
        this.status === "resting"
          ? Math.max(0, this.restUntil - this.now())
          : 0,
      goalSeconds: this.goalSeconds,
      load: this.load,
      manualReps: this.manualReps,
      setIndex: this.planPosition?.setIndex ?? this.setIndex,
      goalReps: this.goalReps,
      statistics: this.statistics.snapshot(),
      cameraStatistics: this.cameraStatistics,
      cameraStatisticsAvailable: effectiveMovementProfile(this.movement).mode !== "timer",
    };
  }
  checkpoint(): TimedRecord | null {
    if (!this.movement || !this.active || !this.id) return null;
    return {
      id: this.id,
      sessionId: this.sessionId,
      setIndex: this.setIndex,
      ...this.planPosition,
      movementSlug: this.movement.slug,
      movementName: this.movement.name,
      startedAt: this.startedAt,
      duration: this.elapsed(),
      goalSeconds: this.goalSeconds,
      load: this.load,
      manualReps: this.manualReps,
      mode: "timed",
      statistics: {
        mode: this.statistics.profile.mode,
        reps: this.statistics.reps,
        seconds: this.statistics.seconds,
        family: this.statistics.profile.family,
        source: "estimated",
        ruleVersion: 1,
        goalReps: this.goalReps,
      },
    };
  }
  finish(interrupted = false) {
    const record = this.checkpoint();
    if (record)
      this.pending.push({
        ...record,
        ...(interrupted ? { interrupted: true } : {}),
      });
    this.status = "ready";
    this.elapsedBefore = 0;
    this.id = "";
    this.pausedRest = 0;
    this.statistics.reset();
    this.manualReps = undefined;
    return record;
  }
  setManualReps(value: number | undefined) {
    if (!this.active) throw Error("请先开始本组，再填写完成次数。");
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 0 || value > 1000)
    )
      throw Error("完成次数需为 0–1000 的整数。");
    this.manualReps = value;
  }
  dispatch(command: Command): { ok: boolean; message: string } {
    if (!this.movement) return { ok: false, message: "请先选择训练动作。" };
    if (!commandSchema.safeParse(command).success)
      return { ok: false, message: "训练设置超出允许范围。" };
    this.tick();
    if (command.type === "session") {
      if (command.action === "end") {
        if (!this.active)
          return { ok: false, message: "当前没有进行中的训练。" };
        this.finish();
        this.sessionId = "";
        this.setIndex = 1;
        return { ok: true, message: "本次训练已结束。" };
      }
      if (command.action === "pause") {
        if (this.status === "ready")
          return { ok: false, message: "训练尚未开始。" };
        if (this.status !== "paused") {
          this.freeze();
          this.pausedRest =
            this.status === "resting"
              ? Math.max(0, this.restUntil - this.now())
              : 0;
          this.status = "paused";
        }
        return { ok: true, message: "计时已暂停，已记录的时长和次数保留。" };
      }
      if (command.action === "cancel_rest") {
        if (this.status !== "resting" && !this.pausedRest)
          return { ok: false, message: "当前没有休息计时。" };
        this.pausedRest = 0;
        if (this.status === "resting") {
          this.status = "training";
          this.runningSince = this.now();
        }
        return { ok: true, message: "休息已结束。" };
      }
      if (command.action === "start" || command.action === "resume") {
        if (!this.active) this.begin();
        else if (this.status === "paused") {
          this.status = this.pausedRest > 0 ? "resting" : "training";
          this.restUntil = this.now() + this.pausedRest;
          this.runningSince = this.now();
          this.pausedRest = 0;
        }
        return {
          ok: true,
          message: `${this.movement.name}已开始，使用${statisticLabel(this.statistics.profile.mode)}；次数可手动修正。`,
        };
      }
      return { ok: false, message: "计时训练支持开始、暂停、继续和结束。" };
    }
    if (command.type === "new_set") {
      if (this.statistics.profile.mode === "reps" && command.unit === "seconds" && command.target !== undefined)
        return {ok:false,message:"当前动作按次数统计，请设置次数目标；如需秒数目标，可结束本组后在设置中关闭摄像头自动统计。"};
      if (
        command.target !== undefined &&
        command.unit !== "seconds" &&
        command.target > 100
      )
        return { ok: false, message: "次数目标最多 100 次。" };
      if (
        command.target !== undefined &&
        command.unit !== "seconds" &&
        this.statistics.profile.mode !== "reps"
      )
        return {
          ok: false,
          message: "计时动作请设置秒数目标，完成次数可在训练后自行填写。",
        };
      if (this.active) {
        this.finish();
        this.setIndex++;
      }
      if (command.target !== undefined) {
        if (command.unit === "seconds") this.goalSeconds = command.target;
        else this.goalReps = command.target;
      }
      this.begin();
      return { ok: true, message: "上一组已结束，开始新一组计时。" };
    }
    if (command.type === "rest_timer") {
      if (!this.active) return { ok: false, message: "请先开始训练。" };
      this.freeze();
      this.status = "resting";
      this.pausedRest = 0;
      this.restUntil = this.now() + command.seconds;
      return {
        ok: true,
        message: `休息 ${command.seconds} 秒，休息时间不计入训练时长。`,
      };
    }
    if (command.type === "set_hold_goal") {
      if (this.statistics.profile.mode === "reps") return {ok:false,message:"当前动作按次数统计，请设置次数目标。"};
      this.goalSeconds = command.seconds;
      return {
        ok: true,
        message: `本组计时目标已设为 ${command.seconds} 秒。`,
      };
    }
    if (
      command.type === "set_rep_goal" &&
      this.statistics.profile.mode === "reps"
    ) {
      this.goalReps = command.reps;
      return { ok: true, message: `本组目标已设为 ${command.reps} 次。` };
    }
    if (command.type === "set_load") {
      this.load = command.kg;
      return { ok: true, message: `本组负重已设为 ${command.kg} 公斤。` };
    }
    return {
      ok: false,
      message:
        "当前动作支持估算统计、目标、休息和手动修正；暂不提供评分和自动训练计划。",
    };
  }
}

export function mergeTimedRecords(
  local: TimedRecord[],
  incoming: TimedRecord[],
  activeId?: string,
) {
  const ids = new Set(local.map((r) => r.id));
  return [
    ...local,
    ...incoming.filter(
      (r) => r.id !== activeId && !ids.has(r.id) && !!ids.add(r.id),
    ),
  ];
}
export function recoverTimedCheckpoint<
  T extends {
    timedRecords?: TimedRecord[];
    timedCheckpoint?: TimedRecord | null;
  },
>(data: T): T {
  if (!data.timedCheckpoint) return data;
  return {
    ...data,
    timedRecords: mergeTimedRecords(data.timedRecords ?? [], [
      { ...data.timedCheckpoint, interrupted: true },
    ]),
    timedCheckpoint: null,
  };
}
