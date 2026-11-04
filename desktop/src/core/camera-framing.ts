import { z } from "zod";
import { bodyAngles, type Exercise, type Point } from "./engine";

export const cameraCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("camera"), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("camera_view"),
      action: z.enum([
        "auto",
        "full",
        "lock",
        "zoom_in",
        "zoom_out",
        "zoom_to",
        "zoom_by",
        "undo",
        "left",
        "right",
      ]),
      adjustment: z.enum(["smart", "fine", "step"]).optional(),
      zoom: z.number().positive().optional(),
      factor: z.number().positive().optional(),
    })
    .strict(),
]);
export type CameraCommand = z.infer<typeof cameraCommandSchema>;
export type CameraViewCommand = Extract<CameraCommand, { type: "camera_view" }>;
export interface CameraView {
  automatic: boolean;
  zoom: number;
  x: number;
  y: number;
  maxZoom: number;
  hint: string;
  targetLost: boolean;
  framingReason?: string;
  targetZoom?: number;
  subjectRatio?: number;
  targetSubjectRatio?: number;
  canUndo?: boolean;
}
type Box = { left: number; right: number; top: number; bottom: number };
type FramingExercise = Exercise | "general";
type Context = {
  exercise: FramingExercise;
  training: boolean;
  activeSet?: boolean;
  moving?: boolean;
  aspect?: number;
  set: string;
};
export const MANUAL_MAX_ZOOM = 3;
export const AUTO_MAX_ZOOM = 3;
export const TARGET_SUBJECT_RATIO = 0.65;
const MIN_SUBJECT_RATIO = 0.1;
const MAX_SUBJECT_RATIO = 0.8;
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const wide = () => ({ zoom: 1, x: 0.5, y: 0.5 });
const valid = (p?: Point) =>
  !!p &&
  (p.visibility ?? 0) >= 0.55 &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x > 0.01 &&
  p.x < 0.99 &&
  p.y > 0.01 &&
  p.y < 0.99;

/** Source coordinates only. Cropping never changes the points used for counting. */
export function bodyBounds(
  points: Point[],
  exercise: FramingExercise,
): Box | null {
  const group = (ids: number[]) => ids.some((i) => valid(points[i]));
  if (
    !group([0, 7, 8]) ||
    !group([27, 28, 31, 32]) ||
    !group([11, 12]) ||
    !group([23, 24])
  )
    return null;
  const p = points.filter(valid);
  // Padding follows body size: a distant person should not inherit the same
  // source-frame margin as a nearby person, which would prevent useful zoom.
  const padding = Math.min(1, subjectSpan(points, exercise) / 0.5);
  const side =
    (exercise === "lunge" || exercise === "general" ? 0.11 : 0.065) * padding;
  const b = {
    left: Math.min(...p.map((v) => v.x)) - side,
    right: Math.max(...p.map((v) => v.x)) + side,
    top: Math.min(...p.map((v) => v.y)) - 0.075 * padding,
    bottom: Math.max(...p.map((v) => v.y)) + 0.065 * padding,
  };
  // Reserve the reach of the whole movement, not just the current pose.
  if (
    exercise === "shoulder_press" ||
    exercise === "pullup" ||
    exercise === "general"
  ) {
    const shoulders = [points[11], points[12]].filter(valid);
    const hips = [points[23], points[24]].filter(valid);
    const shoulder = Math.min(...shoulders.map((p) => p.y));
    const hip = Math.max(...hips.map((p) => p.y));
    b.top = Math.min(
      b.top,
      shoulder - Math.abs(hip - shoulder) * 1.3 - 0.06 * padding,
    );
  }
  return b;
}
function fit(b: Box, cap = AUTO_MAX_ZOOM) {
  const zoom = clamp(
    Math.min(1 / (b.right - b.left), 1 / (b.bottom - b.top)),
    1,
    cap,
  );
  const half = 0.5 / zoom;
  return {
    zoom,
    x: clamp((b.left + b.right) / 2, half, 1 - half),
    y: clamp((b.top + b.bottom) / 2, half, 1 - half),
  };
}
function subjectSpan(points: Point[], exercise: FramingExercise) {
  // Hands can disappear when turning sideways without changing body distance.
  const core = points.filter(
    (p, i) =>
      [0, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28, 31, 32].includes(i) && valid(p),
  );
  if (!core.length) return 0;
  const height =
    Math.max(...core.map((p) => p.y)) - Math.min(...core.map((p) => p.y));
  // Floor exercises occupy width rather than standing height. Full-body bounds
  // still constrain both axes, including the arms and movement headroom.
  return ["pushup", "plank", "bench", "general"].includes(exercise)
    ? Math.max(
        height,
        Math.max(...core.map((p) => p.x)) - Math.min(...core.map((p) => p.x)),
      )
    : height;
}
function framingPosture(
  points: Point[],
  exercise: FramingExercise,
  aspect: number,
) {
  if (["pushup", "plank", "bench"].includes(exercise)) return true;
  // A smaller head-to-foot span while bending is not a new camera distance.
  // This applies before training and while paused as well as during a rep.
  return [0, 1].some((side) => {
    const p = [11, 23, 25, 27].map((i) => points[i + side]);
    if (!p.every(valid)) return false;
    const [shoulder, hip, knee, ankle] = p;
    const length = (a: Point, b: Point) =>
      Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    return (
      shoulder.y < hip.y &&
      hip.y < knee.y &&
      knee.y < ankle.y &&
      (hip.y - shoulder.y) / Math.max(length(shoulder, hip), 0.001) > 0.8 &&
      (ankle.y - hip.y) /
        Math.max(length(hip, knee) + length(knee, ankle), 0.001) >
        0.85
    );
  });
}
function safeView(b: Box, view: ReturnType<typeof wide>) {
  // Padding may cross the source edge. Preserve all available body/margin pixels,
  // without claiming that a digital crop can recover pixels outside the source.
  const visible = {
    left: clamp(b.left, 0, 1),
    right: clamp(b.right, 0, 1),
    top: clamp(b.top, 0, 1),
    bottom: clamp(b.bottom, 0, 1),
  };
  const zoom = fit(visible, view.zoom).zoom;
  const half = 0.5 / zoom;
  return {
    zoom,
    x: clamp(
      view.x,
      Math.max(half, visible.right - half),
      Math.min(1 - half, visible.left + half),
    ),
    y: clamp(
      view.y,
      Math.max(half, visible.bottom - half),
      Math.min(1 - half, visible.top + half),
    ),
  };
}
function contained(b: Box, v: ReturnType<typeof wide>, margin = 0) {
  const half = 0.5 / v.zoom - margin;
  return (
    b.left >= v.x - half &&
    b.right <= v.x + half &&
    b.top >= v.y - half &&
    b.bottom <= v.y + half
  );
}
export function cameraTransform(v: Pick<CameraView, "zoom" | "x" | "y">) {
  // Preview is mirrored: positive source x translates the image to the right.
  return `translate(${(v.x - 0.5) * v.zoom * 100}%, ${(0.5 - v.y) * v.zoom * 100}%) scale(${-v.zoom}, ${v.zoom})`;
}

export class CameraFramer {
  private view = wide();
  private target = wide();
  private automatic = true;
  private bounds: Box | null = null;
  private envelope: Box | null = null;
  private anchor: { x: number; y: number } | null = null;
  private missingSince: number | null = null;
  private canRelocate = false;
  private reacquireRequested = false;
  private relocation: { x: number; y: number; since: number } | null = null;
  /** True only on the frame that accepts a new position after losing the target. */
  reacquiredTarget = false;
  private lastSeen = -Infinity;
  private lastAt = 0;
  private candidate: {
    span: number;
    x: number;
    y: number;
    since: number;
  } | null = null;
  private driftSince: number | null = null;
  private key = "";
  private acquired = false;
  private reason = "waiting_body";
  private span = 0;
  private hint = "";
  private lost = false;
  private limitedSince: number | null = null;
  private targetRatio = TARGET_SUBJECT_RATIO;
  private stableSpan = 0;
  private pendingZoom: number | null = null;
  private movementStarted = false;
  private requestedZoom = false;
  private previous: {
    view: ReturnType<typeof wide>;
    target: ReturnType<typeof wide>;
    automatic: boolean;
    ratio: number;
    pendingZoom: number | null;
  } | null = null;
  reset() {
    this.view = wide();
    this.target = wide();
    this.automatic = true;
    this.bounds = this.envelope = null;
    this.anchor = null;
    this.missingSince = null;
    this.canRelocate = this.reacquireRequested = this.reacquiredTarget = false;
    this.relocation = null;
    this.lastSeen = -Infinity;
    this.lastAt = 0;
    this.candidate = null;
    this.driftSince = null;
    this.key = "";
    this.acquired = false;
    this.reason = "waiting_body";
    this.span = 0;
    this.hint = "";
    this.lost = false;
    this.limitedSince = null;
    this.targetRatio = TARGET_SUBJECT_RATIO;
    this.stableSpan = 0;
    this.pendingZoom = null;
    this.movementStarted = this.requestedZoom = false;
    this.previous = null;
  }
  snapshot(): CameraView {
    return {
      ...this.view,
      automatic: this.automatic,
      maxZoom: MANUAL_MAX_ZOOM,
      hint:
        this.hint ||
        (!this.automatic && this.view.zoom > 1
          ? "手动取景可显示局部；点击“恢复全身”查看完整画面。"
          : ""),
      targetLost: this.lost,
      framingReason: this.automatic ? this.reason : "manual",
      targetZoom: this.target.zoom,
      subjectRatio: this.span * this.view.zoom,
      targetSubjectRatio: this.targetRatio,
      canUndo: this.previous !== null,
    };
  }
  command(input: CameraViewCommand | CameraViewCommand["action"]) {
    const c: CameraViewCommand =
      typeof input === "string"
        ? { type: "camera_view", action: input }
        : input;
    const { action } = c;
    const done = (message: string) => ({ ok: true, message });
    const fail = (message: string) => ({ ok: false, message });
    if (
      (c.zoom !== undefined && action !== "zoom_to") ||
      (c.factor !== undefined && action !== "zoom_by") ||
      (c.adjustment !== undefined && !["zoom_in", "zoom_out"].includes(action))
    )
      return fail("取景参数不匹配，画面未调整。");
    if (
      (action === "zoom_to" && (!Number.isFinite(c.zoom) || c.zoom! <= 0)) ||
      (action === "zoom_by" && (!Number.isFinite(c.factor) || c.factor! <= 0))
    )
      return fail("请说明有效倍率，例如“放大到2倍”。");
    if (action === "undo") {
      if (!this.previous) return fail("还没有可以撤销的取景调整。");
      const previous = this.previous;
      this.view = { ...previous.view };
      this.target = { ...previous.target };
      this.automatic = previous.automatic;
      this.targetRatio = previous.ratio;
      this.pendingZoom = previous.pendingZoom;
      this.requestedZoom = previous.automatic;
      this.previous = null;
      this.acquired = false;
      this.envelope = null;
      this.hint = "";
      return done(
        `已恢复上一次取景，${this.automatic ? "继续跟随" : "保持固定"}。`,
      );
    }
    const remember = () => {
      this.previous = {
        view: { ...this.view },
        target: { ...this.target },
        automatic: this.automatic,
        ratio: this.targetRatio,
        pendingZoom: this.pendingZoom,
      };
    };
    if (action === "auto") {
      remember();
      this.automatic = true;
      this.targetRatio = TARGET_SUBJECT_RATIO;
      this.pendingZoom = null;
      this.requestedZoom = false;
      this.acquired = false;
      this.envelope = null;
      // Retain the old anchor long enough to notify counting of a real relocation.
      this.reacquireRequested = true;
      this.relocation = null;
      this.candidate = null;
      this.driftSince = null;
      this.hint = "";
      this.reason = "stabilizing";
      this.limitedSince = null;
      return done("已恢复自动取景，会跟随你的位置，并优先保留全身和动作空间。");
    }
    if (action === "full") {
      remember();
      this.automatic = false;
      this.pendingZoom = null;
      this.view = this.target = wide();
      this.hint = "";
      return done("已恢复完整画面，并固定取景。");
    }
    if (action === "lock") {
      remember();
      this.automatic = false;
      this.pendingZoom = null;
      this.target = { ...this.view };
      return done("已固定当前画面；说“恢复自动取景”可以重新跟随。");
    }
    const zooming = ["zoom_in", "zoom_out", "zoom_to", "zoom_by"].includes(
      action,
    );
    const step = c.adjustment === "step";
    const base = step ? this.view : this.target;
    let next = { ...base };
    let limit = "";
    if (zooming) {
      const reference = this.bounds ? this.stableSpan || this.span : 0;
      const ratio =
        reference && (!this.automatic || this.acquired)
          ? reference * base.zoom
          : this.targetRatio;
      const enlarge = action === "zoom_in";
      let requestedRatio = this.targetRatio;
      let wanted: number;
      if (action === "zoom_to") wanted = c.zoom!;
      else if (action === "zoom_by")
        wanted = (this.pendingZoom ?? base.zoom) * c.factor!;
      else if (step) wanted = base.zoom + (enlarge ? 0.1 : -0.1);
      else if (c.adjustment === "fine") {
        requestedRatio = clamp(
          ratio * (enlarge ? 1.1 : 1 / 1.1),
          0.01,
          MAX_SUBJECT_RATIO,
        );
        wanted =
          this.automatic && reference
            ? requestedRatio / reference
            : base.zoom * (enlarge ? 1.1 : 1 / 1.1);
      } else {
        requestedRatio = clamp(
          enlarge ? Math.max(0.7, ratio + 0.1) : ratio - 0.15,
          MIN_SUBJECT_RATIO,
          MAX_SUBJECT_RATIO,
        );
        wanted = reference
          ? requestedRatio / reference
          : base.zoom * (enlarge ? 1.4 : 1 / 1.4);
      }
      const precise = action === "zoom_to" || action === "zoom_by";
      if (
        wanted < base.zoom &&
        this.view.zoom <= 1.001 &&
        this.target.zoom <= 1.001 &&
        (this.pendingZoom ?? 1) <= 1.001
      )
        return fail(
          "当前已是摄像头的完整画面，无法再缩小。可以后退一些或调整摄像头位置。",
        );
      if (this.automatic && !step) {
        // Without a stable complete body, record intent rather than zooming into
        // a crouch or a partial person. Resolve an explicit multiplier on recovery.
        const stable =
          this.bounds &&
          this.candidate &&
          this.lastAt - this.candidate.since >= 1.4;
        if (!stable) {
          const pending = precise ? clamp(wanted, 1, AUTO_MAX_ZOOM) : null;
          if (!precise && Math.abs(requestedRatio - this.targetRatio) < 0.005)
            return fail(
              enlarge
                ? "取景目标已到最大；请全身入镜并站稳后查看效果。"
                : "取景目标已到最小；请全身入镜并站稳后查看效果。",
            );
          remember();
          this.pendingZoom = pending;
          this.requestedZoom = true;
          this.targetRatio = requestedRatio;
          this.acquired = false;
          return done(
            `已记住${precise ? `约${pending!.toFixed(1)}倍的` : enlarge ? "更近的" : "更远的"}取景要求，等全身入镜并站稳后调整，继续跟随。`,
          );
        }
        const bounded = clamp(
          wanted * this.span,
          precise || c.adjustment === "fine" ? 0.01 : MIN_SUBJECT_RATIO,
          MAX_SUBJECT_RATIO,
        );
        next = fit(this.bounds!, Math.min(AUTO_MAX_ZOOM, bounded / this.span));
        const delta = next.zoom - base.zoom;
        if (
          (!precise && (enlarge ? delta <= 0.005 : delta >= -0.005)) ||
          (precise && Math.abs(delta) < 0.005)
        )
          return fail(this.limitMessage(wanted, base.zoom));
        remember();
        this.targetRatio = bounded;
        this.requestedZoom = true;
        this.pendingZoom = null;
        this.target = next;
        this.envelope = { ...this.bounds! };
        this.acquired = true;
        const limited = Math.abs(next.zoom - wanted) > 0.02;
        return done(
          `正在调整到约${next.zoom.toFixed(1)}倍，继续跟随。${limited ? this.limitMessage(wanted, next.zoom) : ""}`,
        );
      }
      next.zoom = clamp(wanted, 1, MANUAL_MAX_ZOOM);
      if (
        Math.abs(next.zoom - base.zoom) < 0.005 ||
        (!precise && (enlarge ? next.zoom < base.zoom : next.zoom > base.zoom))
      )
        return fail(this.limitMessage(wanted, base.zoom));
      if (Math.abs(next.zoom - wanted) > 0.02)
        limit = this.limitMessage(wanted, next.zoom);
      if (!step && this.bounds)
        next = { ...fit(this.bounds, next.zoom), zoom: next.zoom };
      remember();
    } else {
      // Make room for a requested pan at full view, then clamp the last partial
      // step to the source edge. Manual display crops never gate pose input.
      if (next.zoom <= 1.001) next.zoom = 1.1;
      // Left/right means moving the viewport in the mirrored preview.
      next.x += action === "left" ? 0.035 : -0.035;
    }
    const half = 0.5 / next.zoom;
    next.x = clamp(next.x, half, 1 - half);
    next.y = clamp(next.y, half, 1 - half);
    if (
      (action === "left" || action === "right") &&
      Math.abs(next.x - this.view.x) < 0.0001
    )
      return fail(
        `已到原始画面的${action === "left" ? "左" : "右"}边缘；可以向另一侧移动或恢复全身。`,
      );
    if (!zooming) remember();
    this.automatic = false;
    this.pendingZoom = null;
    this.target = next;
    if (step || !zooming) this.view = { ...next };
    this.hint =
      next.zoom > 1 ? "手动取景可显示局部；点击“恢复全身”查看完整画面。" : "";
    const direction =
      action === "left"
        ? "向左取景"
        : action === "right"
          ? "向右取景"
          : action === "zoom_in"
            ? "放大画面"
            : "缩小画面";
    return done(
      zooming && !step
        ? `正在调整到${next.zoom.toFixed(1)}倍，保持固定。${limit}`
        : `已${direction}并固定，当前${next.zoom.toFixed(1)}倍。说“跟着我”可恢复自动取景。`,
    );
  }
  private limitMessage(wanted: number, actual: number) {
    if (wanted < 1 || (actual <= 1.001 && wanted <= actual))
      return "当前已是完整画面，无法再缩小。";
    if (actual >= AUTO_MAX_ZOOM - 0.005 && wanted >= actual)
      return `画面已到${AUTO_MAX_ZOOM}倍放大上限，再靠近一点会更清楚。`;
    if (Math.abs(wanted - actual) < 0.005)
      return `当前已经是约${actual.toFixed(1)}倍。`;
    return "为保留全身和动作空间，已到当前取景边界。";
  }
  private holdEnlargement() {
    if (this.automatic && this.target.zoom > this.view.zoom) {
      this.target = { ...this.view };
      this.acquired = false;
    }
  }
  /** False rejects a discontinuous person candidate before counting as well. */
  update(points: Point[], t: number, context: Context): boolean {
    const dt = Math.max(0, t - this.lastAt);
    this.reacquiredTarget = false;
    if (this.lastAt && dt > 1.5) {
      this.canRelocate = true;
      this.relocation = this.candidate = null;
    }
    this.lastAt = t;
    // Readiness and pause changes are not new sets. Preserve framing through them.
    const key = `${context.exercise}:${context.set}`;
    if (key !== this.key) {
      this.key = key;
      this.envelope = null;
      this.acquired = false;
      this.candidate = null;
      this.driftSince = null;
      this.movementStarted = false;
    }
    if (context.exercise !== "plank" && context.moving)
      this.movementStarted = true;
    const holdSetScale =
      (context.activeSet ?? context.training) &&
      this.movementStarted &&
      !this.requestedZoom;
    if ((context.exercise !== "plank" && context.moving) || holdSetScale)
      this.holdEnlargement();
    // Shoulders alone avoid false jumps when hips become occluded.
    const torso = [11, 12].map((i) => points[i]).filter(valid);
    const center = torso.length
      ? {
          x: torso.reduce((s, p) => s + p.x, 0) / torso.length,
          y: torso.reduce((s, p) => s + p.y, 0) / torso.length,
        }
      : null;
    let accepted = !!center;
    if (!center) {
      this.missingSince ??= t;
      if (t - this.missingSince >= 1.5) this.canRelocate = true;
      this.relocation = null;
    } else this.missingSince = null;
    if (center && this.anchor) {
      const distance = Math.hypot(
        center.x - this.anchor.x,
        center.y - this.anchor.y,
      );
      if (distance > 0.2) {
        accepted = false;
        if (this.reacquireRequested) accepted = true;
        else if (
          this.canRelocate ||
          (!context.training && t - this.lastSeen >= 2.5)
        ) {
          // A passing person cannot replace the target immediately. After genuine
          // loss, require a stable, usable pose, then restart only preparation.
          if (
            context.exercise !== "general" &&
            !bodyAngles(points, context.exercise).visible
          )
            this.relocation = null;
          else {
            const old = this.relocation;
            if (!old || Math.hypot(center.x - old.x, center.y - old.y) > 0.025)
              this.relocation = { ...center, since: t };
            accepted = !!this.relocation && t - this.relocation.since >= 0.8;
          }
        }
        this.reacquiredTarget = accepted;
      }
    }
    this.hint = "";
    if (accepted && center) {
      if (this.reacquiredTarget) {
        this.envelope = null;
        this.acquired = false;
        this.candidate = null;
        this.stableSpan = 0;
        this.driftSince = null;
      }
      this.canRelocate = this.reacquireRequested = false;
      this.relocation = null;
      this.anchor = center;
      this.lastSeen = t;
      this.lost = false;
      this.bounds = bodyBounds(points, context.exercise);
      if (this.bounds) {
        this.limitedSince = null;
        const b = this.bounds;
        this.span = subjectSpan(points, context.exercise);
        this.envelope = this.envelope
          ? {
              left: b.left,
              right: b.right,
              top: Math.min(this.envelope.top, b.top),
              bottom: Math.max(this.envelope.bottom, b.bottom),
            }
          : { ...b };
        const candidate = this.candidate;
        const positionTolerance = Math.max(0.012, this.span * 0.06);
        const holding =
          (context.exercise !== "plank" && !!context.moving) ||
          !framingPosture(points, context.exercise, context.aspect ?? 16 / 9);
        if (holding) this.candidate = null;
        else if (
          !candidate ||
          Math.abs(this.span - candidate.span) >
            Math.max(0.008, candidate.span * 0.04) ||
          Math.hypot(center.x - candidate.x, center.y - candidate.y) >
            positionTolerance
        ) {
          this.candidate = {
            span: this.span,
            x: center.x,
            y: center.y,
            since: t,
          };
        }
        const stable =
          this.candidate !== null && t - this.candidate.since >= 1.4;
        if (stable) this.stableSpan = this.span;
        if (this.automatic) {
          if (holding) this.holdEnlargement();
          if (stable && this.pendingZoom !== null) {
            this.targetRatio = clamp(
              this.pendingZoom * this.span,
              0.01,
              MAX_SUBJECT_RATIO,
            );
            this.pendingZoom = null;
          }
          const wanted = this.targetRatio / Math.max(this.span, 0.08);
          const desired = fit(
            b,
            Math.min(
              AUTO_MAX_ZOOM,
              wanted,
              holdSetScale ? this.view.zoom : AUTO_MAX_ZOOM,
            ),
          );
          this.reason = holding
            ? "motion_hold"
            : holdSetScale
              ? "set_hold"
              : stable
                ? "tracking"
                : "stabilizing";
          // A stable new distance may shrink the old movement envelope. Do not
          // treat bending during a repetition as a new camera distance.
          if (
            stable &&
            (!this.acquired ||
              Math.abs(desired.zoom / this.target.zoom - 1) > 0.05)
          ) {
            this.target = desired;
            if (!holdSetScale) this.envelope = { ...b };
            this.acquired = true;
          }
          if (this.acquired && !holding) {
            const offCenter =
              Math.abs((b.left + b.right) / 2 - this.target.x) >
              0.08 / this.target.zoom;
            this.driftSince = offCenter ? (this.driftSince ?? t) : null;
            if (this.driftSince !== null && t - this.driftSince > 1.1) {
              this.target.x = fit(this.envelope, this.target.zoom).x;
            }
          }
          // Widen whenever the body or movement headroom reaches the crop edge,
          // including before initial acquisition and while a rep is in progress.
          if (!contained(b, this.target)) {
            const h = Math.max(
              Math.abs(b.left - this.target.x),
              Math.abs(b.right - this.target.x),
              Math.abs(this.envelope.top - this.target.y),
              Math.abs(this.envelope.bottom - this.target.y),
            );
            this.target.zoom = Math.max(1, Math.min(this.target.zoom, 0.5 / h));
            const half = 0.5 / this.target.zoom;
            this.target.x = clamp(this.target.x, half, 1 - half);
            this.target.y = clamp(this.target.y, half, 1 - half);
          }
          if (
            this.span > this.targetRatio + 0.08 &&
            this.target.zoom <= 1.001
          ) {
            this.reason = "source_limit";
            this.hint = "已经是完整画面；稍微后退，可以留出更舒服的全身空间。";
          } else if (
            stable &&
            wanted > AUTO_MAX_ZOOM &&
            this.target.zoom >= AUTO_MAX_ZOOM - 0.01
          ) {
            this.reason = "zoom_limit";
            this.hint = "自动取景已到3倍；再靠近一些，人物会更清楚。";
          }
        } else if (!contained(b, this.view)) {
          this.hint =
            "当前显示局部，识别仍使用完整画面；可恢复全身或自动取景。";
        }
      } else {
        this.candidate = null;
        this.limitedSince ??= t;
        this.reason = "occlusion_hold";
        // Hold through brief occlusions. A missing far hand alone never enters
        // this branch. Persistent missing head/feet returns to the source view.
        if (this.automatic && t - this.limitedSince > 1.5) {
          this.target = wide();
          this.acquired = false;
          this.envelope = null;
          this.span = 0;
          this.reason = "waiting_body";
          this.hint = "请让头部和脚部完整入镜；如果站得太近，请后退一些。";
        }
      }
    } else {
      this.bounds = null;
      this.candidate = null;
      this.reason = "occlusion_hold";
      if (t - this.lastSeen > 1.5) {
        this.lost = true;
        this.span = 0;
        this.reason = "waiting_body";
        if (this.automatic) {
          this.target = wide();
          this.acquired = false;
          this.envelope = null;
        }
        if (center)
          this.hint = this.canRelocate
            ? "已检测到新位置，请完整入镜并稍作停留，重新确认起始姿势"
            : "位置变化较大，请回到原位，或点“恢复自动取景”重新取景";
      }
    }
    {
      const a =
        1 - Math.exp(-dt / (this.target.zoom < this.view.zoom ? 0.45 : 1.1));
      for (const k of ["zoom", "x", "y"] as const)
        this.view[k] += (this.target[k] - this.view[k]) * a;
      if (Math.abs(this.view.zoom - this.target.zoom) < 0.002)
        this.view.zoom = this.target.zoom;
      const half = 0.5 / this.view.zoom;
      this.view.x = clamp(this.view.x, half, 1 - half);
      this.view.y = clamp(this.view.y, half, 1 - half);
      // Safety applies to the displayed window, not only its animation target.
      // Manual crops deliberately remain untouched, including during recovery.
      if (this.automatic && this.bounds)
        this.view = safeView(this.bounds, this.view);
      if (
        this.requestedZoom &&
        this.acquired &&
        this.pendingZoom === null &&
        Math.abs(this.view.zoom - this.target.zoom) < 0.002
      )
        this.requestedZoom = false;
    }
    return !center || accepted;
  }
}
