import type { Environment } from "./environment";
import type { CameraView } from "./camera-framing";
import { PushupTracker, type PushupCheck } from "./pushup";
import {
  SquatPreparation,
  plankIsHorizontal,
  continuousPose,
  OCCLUSION_GRACE,
  FRAME_GAP_LIMIT,
  type SquatCheck,
} from "./pose-checks";
import { z } from "zod";
import {
  EXERCISES,
  RepCounter,
  PlankTracker,
  bodyAngles,
  liveFaults,
  Smoother,
  type Exercise,
  type Point,
  type Rep,
  type Angles,
  type BodySide,
} from "./engine";
import {
  AutoDetector,
  frameFeatures,
  velocityLoss,
  resample,
  similarity,
  type Reference,
} from "./analysis";
export const exerciseIds = Object.keys(EXERCISES) as [Exercise, ...Exercise[]];
export const blockSchema = z
  .object({
    exercise: z.enum(exerciseIds),
    sets: z.number().int().min(1).max(20),
    target: z.number().int().min(1).max(600),
    rest: z.number().int().min(0).max(900),
    load: z.number().min(0).max(500),
  })
  .strict();
export type Block = z.infer<typeof blockSchema>;
export const planSchema = z
  .array(blockSchema)
  .min(1)
  .max(20)
  .refine(
    (bs) => bs.every((b) => b.exercise === "plank" || b.target <= 100),
    "次数最多100",
  );
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("new_set"),
      target: z.number().int().min(1).max(600).optional(),
      unit: z.enum(["reps", "seconds"]).optional(),
    })
    .strict(),
  z.object({ type: z.literal("start_program"), blocks: planSchema }).strict(),
  z.object({ type: z.literal("stop_program") }).strict(),
  z.object({ type: z.literal("auto_detect"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("set_hold_goal"),
      seconds: z.number().int().min(1).max(600),
    })
    .strict(),

  z
    .object({
      type: z.literal("set_exercise"),
      exercise: z.enum(exerciseIds),
      restart: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_rep_goal"),
      reps: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("rest_timer"),
      seconds: z.number().min(5).max(900),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_tempo"),
      eccentric_s: z.number().min(0.5).max(10),
    })
    .strict(),
  z
    .object({ type: z.literal("set_load"), kg: z.number().min(0).max(500) })
    .strict(),
  z.object({ type: z.literal("cues"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("session"),
      action: z.enum(["start", "pause", "resume", "end", "cancel_rest"]),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface RecordRow {
  id: string;
  sessionId?: string;
  setIndex?: number;
  blockIndex?: number;
  holdBest?: number;
  source?: string;
  exerciseName?: string;
  interrupted?: boolean;
  exercise: Exercise;
  startedAt: string;
  duration: number;
  reps: Rep[];
  holdSeconds: number;
  load: number;
  goal: number;
}
export interface Snapshot {
  catalogPlan?: import("./catalog-plan").CatalogPlanView;
  timed?: import("./timed-training").TimedSnapshot;
  backgroundBlur?: { enabled: boolean; notice: string };
  exerciseReference?: {
    enabled: boolean;
    size: "medium" | "large";
  };
  voice?: { enabled: boolean; guidance: "quiet" | "balanced" | "active" };
  preparing?: boolean;
  cameraView?: CameraView & { cameraOn: boolean };
  exercise: Exercise;
  goal: number;
  holdGoal: number;
  holdBest: number;
  fatigue: number;
  auto: boolean;
  detected: Exercise | null;
  program: { blocks: Block[]; block: number; set: number } | null;
  status: "ready" | "training" | "paused" | "resting";
  reps: number;
  hold: number;
  phase: string;
  remaining: number;
  elapsed: number;
  load: number;
  tempo: number;
  cues: boolean;
  tracking: boolean;
  environment?: Environment;
  angles: Angles;
  faults: string[];
  last: Rep | null;
  trackingSide?: BodySide;
  trackingNotice?: string;
  squatCheck?: SquatCheck;
  pushupCheck?: PushupCheck;
}
export interface Receipt {
  ok: boolean;
  message: string;
  state: Snapshot;
}
export class SessionEngine {
  planPosition?: import("./catalog-plan").PlanPosition;
  exercise: Exercise = "squat";
  goal = 12;
  holdGoal = 30;
  auto = false;
  detected: Exercise | null = null;
  detector = new AutoDetector();
  program: Snapshot["program"] = null;
  nextSet = false;
  pausedRest = 0;
  sessionId = "";
  recordId = "";
  archived = false;
  references: Partial<Record<Exercise, Reference>> = {};
  trajectory: number[] = [];
  events: {
    type: "start" | "set" | "finish" | "fatigue" | "detected" | "goal";
    row?: RecordRow;
    exercise?: Exercise;
    sessionId: string;
  }[] = [];
  fatigueWarned = false;
  load = 0;
  tempo = 3;
  cues = true;
  active = false;
  paused = false;
  restUntil = 0;
  cameraReady = false;
  started = 0;
  private pausedAt: number | null = null;
  private pausedSeconds = 0;
  startedAt = "";
  counter = new RepCounter(EXERCISES.squat);
  plank = new PlankTracker();
  smoother = new Smoother();
  rows: Rep[] = [];
  pending: RecordRow[] = [];
  angles: Angles = {};
  faults: string[] = [];
  environment?: Environment;
  goalAnnounced = false;
  tracking = false;
  lastFrame = 0;
  lastTracked: number | null = null;
  trackingSide?: BodySide;
  trackingNotice = "";
  missingSince: number | null = null;
  squatPreparation = new SquatPreparation();
  pushup = new PushupTracker();
  lastPoints: Point[] = [];
  recoveryPoints: Point[] | null = null;
  recoveryAt = 0;
  recoveryBudget = OCCLUSION_GRACE;
  motionNotice = "";
  awaitingStart = false;
  preparing = true;
  private preparedSince: number | null = null;
  sideCandidate?: BodySide;
  sideCandidateSince = 0;
  now = () => performance.now() / 1000;
  private setPaused(paused: boolean) {
    if (paused === this.paused) return;
    if (paused) this.pausedAt = this.now();
    else if (this.pausedAt !== null) {
      this.pausedSeconds += this.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.paused = paused;
  }
  private elapsed() {
    return Math.max(
      0,
      (this.pausedAt ?? this.now()) - this.started - this.pausedSeconds,
    );
  }
  reset() {
    this.preparing = true;
    this.preparedSince = null;
    this.recordId = crypto.randomUUID();
    this.archived = false;
    this.trajectory = [];
    this.fatigueWarned = false;
    this.goalAnnounced = false;
    this.counter = new RepCounter(EXERCISES[this.exercise]);
    this.plank = new PlankTracker();
    this.rows = [];
    this.smoother = new Smoother();
    this.trackingSide = undefined;
    this.lastTracked = null;
    this.missingSince = null;
    this.lastFrame = 0;
    this.lastPoints = [];
    this.recoveryPoints = null;
    this.squatPreparation = new SquatPreparation();
    this.pushup = new PushupTracker();
    this.motionNotice = "";
    this.awaitingStart = false;
    this.sideCandidate = undefined;
    this.angles = {};
    this.tracking = false;
    this.trackingNotice = "";
    this.restUntil = 0;
    this.faults = [];
    this.started = this.now();
    this.pausedSeconds = 0;
    this.pausedAt = this.paused ? this.started : null;
    this.pausedRest = 0;
    this.startedAt = new Date().toISOString();
  }
  currentRecord(): RecordRow {
    return {
      id: this.recordId,
      sessionId: this.sessionId,
      exercise: this.exercise,
      startedAt: this.startedAt,
      duration: this.elapsed(),
      reps: [...this.rows],
      holdSeconds: this.plank.total,
      holdBest: this.plank.best,
      load: this.load,
      goal: this.exercise === "plank" ? this.holdGoal : this.goal,
      setIndex: this.program?.set,
      blockIndex: this.program?.block,
      ...this.planPosition,
    };
  }
  archive() {
    if (!this.active || this.archived) return;
    const row = this.currentRecord();
    this.pending.push(row);
    this.archived = true;
    this.events.push({ type: "set", row, sessionId: this.sessionId });
  }
  applyBlock() {
    const b = this.program!.blocks[this.program!.block];
    this.exercise = b.exercise;
    this.load = b.load;
    if (b.exercise === "plank") this.holdGoal = b.target;
    else this.goal = b.target;
  }
  finishSet(restSeconds?: number) {
    if (!this.program || this.nextSet || !this.active) return;
    this.archive();
    const p = this.program,
      b = p.blocks[p.block];
    if (p.set >= b.sets && p.block === p.blocks.length - 1) {
      this.active = false;
      this.program = null;
      this.restUntil = 0;
      this.events.push({ type: "finish", sessionId: this.sessionId });
      return;
    }
    if (p.set < b.sets) p.set++;
    else {
      p.block++;
      p.set = 1;
    }
    this.nextSet = true;
    this.restUntil = this.now() + (restSeconds ?? b.rest);
    this.counter.resetMotion();
    this.plank.resetMotion();
    this.tick();
  }
  skipRemainingSets() {
    const p = this.program;
    if (!p || !this.nextSet || this.paused || p.set <= 1 || !p.blocks[p.block + 1])
      return { ok: false, message: "只能在同一动作的组间休息时跳过剩余组。" };
    p.block++;
    p.set = 1;
    this.restUntil = 0;
    this.tick();
    return { ok: true, message: "开始" + EXERCISES[this.exercise].label + "第 1 组。" };
  }
  tick() {
    if (
      this.active &&
      !this.paused &&
      this.nextSet &&
      this.restUntil <= this.now()
    ) {
      this.nextSet = false;
      this.applyBlock();
      this.reset();
    }
  }
  checkpoint() {
    return this.active && !this.archived
      ? { ...this.currentRecord(), interrupted: true }
      : null;
  }
  dispatch(raw: unknown): Receipt {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        message: "指令参数无效，未执行。",
        state: this.snapshot(),
      };
    const c = parsed.data;
    const fail = (message: string): Receipt => ({
      ok: false,
      message,
      state: this.snapshot(),
    });
    let message = "";
    if (c.type === "new_set") {
      if (this.program)
        return fail("当前按计划训练；请先结束计划，再单独开始新一组。");
      if (!this.cameraReady) return fail("请先开启摄像头，等待模型就绪。");
      if (c.unit && c.unit !== (this.exercise === "plank" ? "seconds" : "reps"))
        return fail(
          `当前${EXERCISES[this.exercise].label}按${this.exercise === "plank" ? "秒数" : "次数"}设置目标，当前组已保留。`,
        );
      if (this.exercise !== "plank" && c.target !== undefined && c.target > 100)
        return fail("每组次数需在1到100次之间，当前组已保留。");
      const continuing = this.active;
      this.archive();
      this.setPaused(false);
      this.reset();
      if (c.target !== undefined) {
        if (this.exercise === "plank") this.holdGoal = c.target;
        else this.goal = c.target;
      }
      if (!continuing) this.sessionId = crypto.randomUUID();
      this.active = true;
      this.auto = false;
      this.nextSet = false;
      this.events.push({ type: "start", sessionId: this.sessionId });
      message = `${continuing ? "上一组已结束。" : ""}新一组${EXERCISES[this.exercise].label}从零开始，目标${this.exercise === "plank" ? this.holdGoal + "秒" : this.goal + "次"}，就位后开始计数。`;
    }
    if (c.type === "start_program") {
      if (!this.cameraReady) return fail("请先开启摄像头，等待模型就绪。");
      if (this.active) return fail("请先结束当前训练，再启动计划。");
      this.program = { blocks: structuredClone(c.blocks), block: 0, set: 1 };
      this.auto = false;
      this.nextSet = false;
      this.applyBlock();
      this.reset();
      this.sessionId = crypto.randomUUID();
      this.active = true;
      this.setPaused(false);
      this.events.push({ type: "start", sessionId: this.sessionId });
      message = `训练计划已开始，共${c.blocks.length}个动作、${c.blocks.reduce((n, b) => n + b.sets, 0)}组。`;
    }
    if (c.type === "stop_program") {
      if (!this.program) return fail("当前没有训练计划。");
      this.archive();
      this.program = null;
      this.active = false;
      this.setPaused(false);
      this.restUntil = 0;
      this.nextSet = false;
      this.events.push({ type: "finish", sessionId: this.sessionId });
      message = "计划已结束，已完成的训练已归档。";
    }
    if (c.type === "auto_detect") {
      if (c.enabled && this.active)
        return fail("请在开始一组训练前开启自动识别，当前组记录已保留。");
      if (c.enabled && this.program)
        return fail("计划中按指定动作训练，请先结束计划。");
      this.auto = c.enabled;
      this.detector = new AutoDetector();
      this.detected = null;
      message = `自动识别已${c.enabled ? "开启，先识别动作再计次；卧推请手动选择" : "关闭"}。`;
    }
    if (c.type === "set_hold_goal") {
      if (this.exercise !== "plank")
        return fail("当前不是平板支撑，请先切换动作。");
      if (this.nextSet) return fail("组间休息时不能修改下一组目标。");
      this.holdGoal = c.seconds;
      message = `支撑目标已设为${c.seconds}秒。`;
    }
    if (this.program && c.type === "set_exercise")
      return fail("训练计划正在进行，切换动作前请先结束计划。");
    if (this.nextSet && ["set_rep_goal", "set_load"].includes(c.type))
      return fail("请等下一组开始后再修改本组目标或负重。");
    if (c.type === "set_exercise") {
      this.auto = false;
      this.detected = null;
      if (this.exercise === c.exercise && !c.restart)
        message = `当前已是${EXERCISES[this.exercise].label}，保留本组次数。`;
      else {
        this.archive();
        this.exercise = c.exercise;
        this.reset();
        message = `已切换到${EXERCISES[c.exercise].label}，新一组从零开始。`;
      }
    }
    if (c.type === "set_rep_goal") {
      if (this.exercise === "plank")
        return fail("平板支撑使用秒数目标，请设置支撑时长。");
      this.goal = c.reps;
      this.goalAnnounced = this.rows.length >= this.goal;
      message = `本组目标已设为${c.reps}次。`;
    }
    if (c.type === "rest_timer") {
      if (this.program) {
        if (this.snapshot().status !== "training")
          return fail("请在本组训练中开始组间休息。");
        this.finishSet(c.seconds);
        return { ok: true, message: this.program ? "本组完成，开始组间休息。" : "计划已完成。", state: this.snapshot() };
      }
      if (!this.active)
        return {
          ok: false,
          message: "请先开始训练，再设置组间休息。",
          state: this.snapshot(),
        };
      this.setPaused(false);
      this.pausedRest = 0;
      this.restUntil = this.now() + c.seconds;
      this.counter.resetMotion();
      this.plank.resetMotion();
      message = `已开始${c.seconds}秒休息倒计时。`;
    }
    if (c.type === "set_tempo") {
      this.tempo = c.eccentric_s;
      message = `下放节奏已设为${c.eccentric_s}秒。`;
    }
    if (c.type === "set_load") {
      this.load = c.kg;
      message = c.kg
        ? `训练重量已设为${c.kg}公斤。`
        : "已清除负重，按自重记录。";
    }
    if (c.type === "cues") {
      this.cues = c.enabled;
      message = `动作纠错语音提示已${c.enabled ? "开启" : "关闭"}。`;
    }
    if (c.type === "session") {
      if (c.action === "start") {
        if (!this.cameraReady)
          return {
            ok: false,
            message: "请先开启摄像头，等待姿态模型就绪。",
            state: this.snapshot(),
          };
        if (this.active)
          return {
            ok: false,
            message: "训练已在进行中，请继续或结束本组。",
            state: this.snapshot(),
          };
        this.reset();
        this.active = true;
        this.sessionId = crypto.randomUUID();
        this.detector = new AutoDetector();
        this.detected = null;
        this.events.push({ type: "start", sessionId: this.sessionId });
        this.setPaused(false);
        message =
          this.exercise === "squat" && !this.auto
            ? "已开始侧身站位检查，通过后开始计数。"
            : "已开始准备检查，就位后自动计数。";
      }
      if (c.action === "end") {
        if (!this.active)
          return {
            ok: false,
            message: "当前没有进行中的训练。",
            state: this.snapshot(),
          };
        this.archive();
        this.events.push({ type: "finish", sessionId: this.sessionId });
        this.program = null;
        this.nextSet = false;
        this.active = false;
        this.setPaused(false);
        this.restUntil = 0;
        message = "训练已结束。";
      }
      if (c.action === "pause" || c.action === "resume") {
        if (!this.active)
          return {
            ok: false,
            message: "当前没有进行中的训练。",
            state: this.snapshot(),
          };
        if (c.action === "resume" && !this.cameraReady)
          return {
            ok: false,
            message: "摄像头未就绪，不能继续计次。",
            state: this.snapshot(),
          };
        if (
          this.paused === (c.action === "pause") &&
          (this.paused || this.restUntil <= this.now())
        )
          return {
            ok: true,
            message: this.paused ? "训练已暂停。" : "训练正在进行中。",
            state: this.snapshot(),
          };
        if (c.action === "pause")
          this.pausedRest = Math.max(0, this.restUntil - this.now());
        this.setPaused(c.action === "pause");
        this.restUntil = this.paused
          ? 0
          : this.pausedRest > 0
            ? this.now() + this.pausedRest
            : 0;
        if (!this.paused) this.pausedRest = 0;
        this.tick();
        this.counter.resetMotion();
        this.plank.resetMotion();
        this.pushup.resetMotion();
        this.preparing = true;
        this.preparedSince = null;
        message = this.paused ? "训练已暂停。" : "训练已继续。";
      }
      if (c.action === "cancel_rest") {
        if (this.restUntil <= this.now() && this.pausedRest <= 0)
          return fail("当前没有休息倒计时。");
        this.restUntil = 0;
        this.pausedRest = 0;
        this.tick();
        message = this.paused
          ? "休息倒计时已取消，训练仍暂停；说“继续训练”可以恢复。"
          : "休息已结束。";
      }
    }
    return { ok: true, message, state: this.snapshot() };
  }
  /** A new position starts a fresh motion, preserving completed work and session identity. */
  prepareAfterReposition() {
    this.counter.resetMotion();
    this.plank.resetMotion();
    this.pushup.resetMotion();
    this.preparing = true;
    this.preparedSince = null;
    this.awaitingStart = false;
    this.squatPreparation = new SquatPreparation();
    this.detector = new AutoDetector();
    this.smoother = new Smoother();
    this.trajectory = [];
    this.lastFrame = 0;
    this.lastTracked = this.missingSince = null;
    this.lastPoints = [];
    this.recoveryPoints = null;
    this.trackingSide = this.sideCandidate = undefined;
    this.angles = {};
    this.faults = [];
    this.tracking = false;
    this.motionNotice = "位置已重新确认，请回到起始姿势；已完成进度保留";
  }
  frame(points: Point[], t = this.now(), aspect = 1) {
    this.tick();
    if (this.exercise === "pushup" && !(this.auto && !this.detected)) {
      const enabled =
        this.active && !this.paused && this.restUntil <= this.now();
      const row = this.pushup.update(points, t, aspect, enabled);
      this.lastFrame = t;
      this.tracking = this.pushup.angle !== undefined;
      this.trackingSide = this.pushup.side;
      this.trackingNotice = this.pushup.check.message;
      this.preparing = !this.pushup.check.ready;
      this.angles =
        this.pushup.angle === undefined ? {} : { elbow: this.pushup.angle };
      this.faults = enabled ? [...this.pushup.faults] : [];
      this.counter.phase = this.pushup.phase;
      this.counter.count = this.pushup.count;
      if (this.pushup.phase !== "IDLE" && this.pushup.angle !== undefined)
        this.trajectory.push(this.pushup.angle);
      if (row) this.acceptRep(row);
      else if (this.pushup.phase === "IDLE") this.trajectory = [];
      return row;
    }
    const resetMotion = () => {
      if (this.counter.phase !== "IDLE") this.awaitingStart = true;
      this.counter.resetMotion();
      this.plank.resetMotion();
      this.trajectory = [];
      this.detector = new AutoDetector();
      this.smoother = new Smoother();
      this.trackingSide = undefined;
      this.squatPreparation = new SquatPreparation();
      this.recoveryPoints = null;
      this.sideCandidate = undefined;
    };
    const frameGap = this.lastFrame ? t - this.lastFrame : 0;
    if (frameGap > FRAME_GAP_LIMIT) {
      resetMotion();
      this.motionNotice = "画面中断，本次动作已取消；请回到起始位置";
    } else if (frameGap > 0.2) {
      if (this.missingSince === null) this.recoveryBudget = FRAME_GAP_LIMIT;
      this.missingSince ??= this.lastTracked ?? t;
    }
    this.lastFrame = t;
    const exercise = this.auto && !this.detected ? undefined : this.exercise;
    const moving = this.counter.phase !== "IDLE" || this.plank.streak > 0;
    const recoveryLimit = this.recoveryBudget;
    if (this.missingSince !== null && t - this.missingSince > recoveryLimit) {
      resetMotion();
      this.motionNotice = "关键点持续丢失，本次动作已取消；请回到起始位置";
    }
    // Re-evaluate the best side while preparing. Never splice two anatomical
    // sides into a repetition when confidence changes halfway through it.
    let a = bodyAngles(
      points,
      exercise,
      moving ? this.trackingSide : undefined,
    );
    if (!moving && this.trackingSide && a.side !== this.trackingSide) {
      const current = bodyAngles(points, exercise, this.trackingSide);
      if (current.visible) {
        if (!a.visible || a.confidence < current.confidence + 0.1) {
          this.sideCandidate = undefined;
          a = current;
        } else {
          if (this.sideCandidate !== a.side) {
            this.sideCandidate = a.side;
            this.sideCandidateSince = t;
          }
          if (t - this.sideCandidateSince < 0.25) a = current;
        }
      }
    } else this.sideCandidate = undefined;
    this.tracking = a.visible;
    if (!a.visible) {
      this.preparedSince = null;
      this.recoveryBudget = OCCLUSION_GRACE;
      this.missingSince ??= this.lastTracked ?? t;
      this.recoveryPoints = null;
      if (this.lastTracked === null || t - this.missingSince > OCCLUSION_GRACE)
        resetMotion();
      this.angles = {};
      this.plank.previous = null; // Never add occluded time to a hold.
      this.faults = [];
      this.trackingNotice = `未识别到${a.missing.join("、") || "有效关节"}，请调整位置${this.motionNotice ? "；" + this.motionNotice : ""}`;
      return null;
    }
    if (this.missingSince !== null) {
      const gap = t - this.missingSince;
      const sameSide = !this.trackingSide || a.side === this.trackingSide;
      if (
        gap > this.recoveryBudget ||
        !sameSide ||
        !continuousPose(this.lastPoints, points, exercise, a.side)
      ) {
        resetMotion();
        this.motionNotice = "身体位置或站位变化，本次动作已取消；请重新站稳";
      } else if (!this.recoveryPoints) {
        this.recoveryPoints = points.map((p) => ({ ...p }));
        this.recoveryAt = t;
        this.tracking = false;
        this.angles = {};
        this.faults = [];
        this.plank.previous = null;
        this.trackingNotice = "关键点已恢复，正在确认连续画面";
        return null;
      } else if (
        !continuousPose(this.recoveryPoints, points, exercise, a.side)
      ) {
        resetMotion();
        this.motionNotice = "恢复画面不连续，本次动作已取消；请重新站稳";
      } else if (t - this.recoveryAt < 0.08) {
        this.tracking = false;
        this.angles = {};
        return null;
      } else if (this.counter.phase !== "IDLE") {
        this.counter.tStart += gap;
        this.counter.tBottom += gap;
      }
      this.recoveryPoints = null;
      this.smoother = new Smoother();
    }
    this.missingSince = null;
    this.lastTracked = t;
    this.lastPoints = points.map((p) => ({ ...p }));
    this.trackingSide = a.side;
    this.trackingNotice = this.motionNotice;
    const smoothed = this.smoother.update(points, t);
    this.angles = bodyAngles(smoothed, exercise, a.side).angles;
    if (exercise === "squat") {
      const check = this.squatPreparation.update(points, a.side, t, aspect);
      if (!check.ready) {
        this.preparing = true;
        this.counter.resetMotion();
        this.trajectory = [];
        this.faults = [];
        return null;
      }
      this.motionNotice = "";
      this.trackingNotice = "";
      this.preparing = false;
    }
    if (exercise === "plank" && !plankIsHorizontal(points, a.side, aspect)) {
      this.preparing = true;
      this.preparedSince = null;
      this.plank.resetMotion();
      this.faults = [];
      this.trackingNotice = "请俯身支撑，让身体接近水平；站立时不计时";
      return null;
    }
    if (!this.active || this.paused || this.restUntil > this.now()) {
      this.counter.resetMotion();
      this.plank.resetMotion();
      this.faults = [];
      return null;
    }
    if (this.awaitingStart) {
      if (
        this.exercise !== "plank" &&
        !(
          this.angles[EXERCISES[this.exercise].signal] >
          EXERCISES[this.exercise].lockout
        )
      ) {
        this.trackingNotice = "本次动作已中断，请先回到起始位置再做下一次";
        this.faults = [];
        return null;
      }
      this.awaitingStart = false;
    }
    if (this.auto && !this.detected) {
      const detected = this.detector.update(
        frameFeatures(this.angles, smoothed),
        t,
      );
      if (!detected) return null;
      this.exercise = detected;
      this.detected = detected;
      this.reset();
      this.events.push({
        type: "detected",
        exercise: detected,
        sessionId: this.sessionId,
      });
      return null;
    }
    if (this.preparing && this.exercise !== "squat") {
      const angle = this.angles[EXERCISES[this.exercise].signal];
      const ready =
        Number.isFinite(angle) &&
        angle >
          (this.exercise === "plank" ? 160 : EXERCISES[this.exercise].lockout);
      this.preparedSince = ready ? (this.preparedSince ?? t) : null;
      if (this.preparedSince === null || t - this.preparedSince < 0.45) {
        this.trackingNotice =
          this.exercise === "plank"
            ? "肩、髋、踝保持直线，停稳后自动开始计时"
            : "请回到动作起始位置，停稳后自动开始计数";
        this.counter.resetMotion();
        this.plank.resetMotion();
        this.faults = [];
        return null;
      }
      this.preparing = false;
      this.trackingNotice = "";
    }
    this.faults = liveFaults(this.exercise, this.angles, this.counter.phase);
    if (this.exercise === "plank") {
      if (this.plank.update(this.angles.body_line, t))
        this.faults.push("body_sag");
      if (this.plank.total >= this.holdGoal) {
        if (this.program) this.finishSet();
        else this.announceGoal();
      }
      return null;
    }
    for (const f of this.faults)
      if (this.counter.phase !== "IDLE") this.counter.faults.add(f);
    const row = this.counter.update(
      this.angles[EXERCISES[this.exercise].signal],
      t,
    );
    if (this.counter.phase !== "IDLE" || row) {
      this.motionNotice = "";
      this.trackingNotice = "";
    }
    const angle = this.angles[EXERCISES[this.exercise].signal];
    if (this.counter.phase !== "IDLE" || row) this.trajectory.push(angle);
    else this.trajectory = [];
    if (row) this.acceptRep(row);
    return row;
  }
  acceptRep(row: Rep) {
    row.load_kg = this.load;
    row.measured = true;
    if (!row.assessment?.limited)
      row.velocity =
        row.concentric_s > 0
          ? Math.max(0, EXERCISES[this.exercise].lockout - row.min_angle) /
            row.concentric_s
          : 0;
    row.trajectory = resample(this.trajectory);
    this.trajectory = [];
    const reference = this.references[this.exercise];
    if (reference && !row.assessment?.limited)
      row.similarity = similarity(row.trajectory, reference.trajectory);
    this.rows.push(row);
    if (
      !this.fatigueWarned &&
      velocityLoss(this.rows.map((r) => r.velocity ?? 0)) > 0.2
    ) {
      this.fatigueWarned = true;
      this.events.push({ type: "fatigue", sessionId: this.sessionId });
    }
    if (this.rows.length >= this.goal) {
      if (this.program) this.finishSet();
      else this.announceGoal();
    }
  }
  announceGoal() {
    if (this.goalAnnounced || !this.active) return;
    this.goalAnnounced = true;
    this.events.push({
      type: "goal",
      row: this.currentRecord(),
      sessionId: this.sessionId,
    });
  }
  snapshot(): Snapshot {
    this.tick();
    return {
      preparing: this.active && this.preparing,
      holdGoal: this.holdGoal,
      holdBest: this.plank.best,
      fatigue: velocityLoss(this.rows.map((r) => r.velocity ?? 0)),
      auto: this.auto,
      detected: this.detected,
      program: this.program ? structuredClone(this.program) : null,
      exercise: this.exercise,
      goal: this.goal,
      status: !this.active
        ? "ready"
        : this.paused
          ? "paused"
          : this.restUntil > this.now()
            ? "resting"
            : "training",
      reps: this.counter.count,
      hold: this.plank.total,
      phase: this.counter.phase,
      remaining: Math.max(0, Math.ceil(this.restUntil - this.now())),
      elapsed: this.active ? this.elapsed() : 0,
      load: this.load,
      tempo: this.tempo,
      cues: this.cues,
      tracking: this.tracking,
      trackingSide: this.trackingSide,
      trackingNotice: this.trackingNotice,
      squatCheck:
        this.exercise === "squat" && !(this.auto && !this.detected)
          ? this.squatPreparation.state
          : undefined,
      pushupCheck:
        this.exercise === "pushup" && !(this.auto && !this.detected)
          ? { ...this.pushup.check }
          : undefined,
      environment: this.environment,
      angles: { ...this.angles },
      faults: [...this.faults],
      last: this.rows.at(-1) ?? null,
    };
  }
}
