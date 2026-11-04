import {
  FAULTS,
  landmarkVisible,
  type BodySide,
  type Phase,
  type Point,
  type Rep,
} from "./engine";

export type PushupView = "front" | "oblique" | "side" | "unknown";
export const PUSHUP_VIEW_LABELS: Record<PushupView, string> = {
  front: "正面",
  oblique: "斜侧面",
  side: "侧面",
  unknown: "待识别",
};
export interface PushupCheck {
  view: PushupView;
  ready: boolean;
  message: string;
  assessment: string;
  bodyLineVisible: boolean;
}
type Vector = { x: number; y: number; z: number };
type Arm = {
  side: BodySide;
  angle: number;
  height: number;
  wrist: Vector;
  scale: number;
  confidence: number;
};
type Sample = {
  arms: Arm[];
  yaw: number;
  view: PushupView;
  supported: boolean;
  source: "world" | "image";
  bodyLineVisible: boolean;
  sag: boolean;
};
const sub = (a: Vector, b: Vector): Vector => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const length = (v: Vector) => Math.hypot(v.x, v.y, v.z);
const distance = (a: Vector, b: Vector) => length(sub(a, b));
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
function joint(a: Vector, b: Vector, c: Vector) {
  const u = sub(a, b),
    v = sub(c, b),
    d = length(u) * length(v);
  return d < 1e-8
    ? NaN
    : (Math.acos(
        Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / d)),
      ) *
        180) /
        Math.PI;
}
const visible = (p: Point | undefined, confidence = 0.6) =>
  landmarkVisible(p) && (p!.visibility ?? 0) >= confidence;
const validWorld = (p: Point) =>
  p.world && [p.world.x, p.world.y, p.world.z].every(Number.isFinite);

/** Camera-relative orientation, not a medical joint-angle measurement. Other
 * exercises retain their original coordinate convention and thresholds. */
export function pushupSample(points: Point[], aspect = 1): Sample | null {
  if (points.length !== 33 || !Number.isFinite(aspect) || aspect <= 0)
    return null;
  const sides = [0, 1].filter((o) =>
    [11, 13, 15, 23].every((i) => visible(points[i + o])),
  );
  if (!sides.length) return null;
  const source = sides.every((o) =>
    [11, 13, 15, 23].every((i) => validWorld(points[i + o])),
  )
    ? "world"
    : "image";
  const camera = (i: number): Vector => ({
    x: points[i].x * aspect,
    y: points[i].y,
    z: points[i].z * aspect,
  });
  const metric = (i: number): Vector =>
    source === "world" ? points[i].world! : camera(i);
  const arms: Arm[] = [];
  const depths: number[] = [];
  const yaws: number[] = [],
    supported: boolean[] = [];
  for (const o of sides) {
    const s = metric(11 + o),
      e = metric(13 + o),
      w = metric(15 + o),
      h = metric(23 + o);
    const torso = sub(h, s),
      size = length(torso);
    const upper = distance(s, e),
      lower = distance(e, w);
    const angle = joint(s, e, w);
    const scale =
      distance(camera(11 + o), camera(13 + o)) +
      distance(camera(13 + o), camera(15 + o));
    if (
      !Number.isFinite(angle) ||
      size < 0.035 ||
      upper < 0.025 ||
      lower < 0.025 ||
      upper / lower > 3 ||
      lower / upper > 3 ||
      scale < 0.05
    )
      continue;
    // The torso points away from the camera in a head-on push-up, and across
    // the frame in a side view. Only visible torso landmarks contribute.
    yaws.push(
      (Math.atan2(Math.abs(torso.x), Math.abs(torso.z)) * 180) / Math.PI,
    );
    depths.push(torso.z);
    supported.push(
      Math.abs(torso.y) / size < 0.7 &&
        points[15 + o].y - points[11 + o].y > 0.025,
    );
    arms.push({
      side: o ? "right" : "left",
      angle,
      height: (points[15 + o].y - points[11 + o].y) / scale,
      // Landmark z is relative to the moving hip origin, so it cannot be
      // used as a fixed-camera wrist anchor across a repetition.
      wrist: { ...camera(15 + o), z: 0 },
      scale,
      confidence: Math.min(
        ...[11, 13, 15, 23].map((i) => points[i + o].visibility ?? 0),
      ),
    });
  }
  if (!arms.length) return null;
  const yaw = mean(yaws);
  const view: PushupView =
    yaw < 30
      ? mean(depths) > 0
        ? "front"
        : "unknown"
      : yaw > 65
        ? "side"
        : "oblique";
  // A head-on cycle needs both arms. A side or oblique cycle can use a
  // continuously visible near arm; it never switches arms mid-repetition.
  if (view === "front" && arms.length !== 2) return null;
  const best = arms.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  const o = best.side === "left" ? 0 : 1;
  let bodyLineVisible =
    view === "side" && [11, 23, 27].every((i) => visible(points[i + o], 0.75));
  let sag = false;
  if (bodyLineVisible) {
    const s = camera(11 + o),
      h = camera(23 + o),
      a = camera(27 + o);
    const dx = a.x - s.x;
    bodyLineVisible =
      Math.abs(dx) > 0.18 && Math.abs(dx) > Math.abs(a.y - s.y) * 1.5;
    if (bodyLineVisible) {
      const lineY = s.y + ((a.y - s.y) * (h.x - s.x)) / dx;
      sag = h.y - lineY > Math.hypot(h.x - s.x, h.y - s.y) * 0.12;
    }
  }
  return {
    arms,
    yaw,
    view,
    source,
    supported: view !== "unknown" && supported.every(Boolean),
    bodyLineVisible,
    sag,
  };
}

/** A complete, observed top-bottom-top cycle. No prediction across occlusion. */
export class PushupTracker {
  count = 0;
  phase: Phase = "IDLE";
  angle?: number;
  side?: BodySide;
  faults: string[] = [];
  check: PushupCheck = {
    view: "unknown",
    ready: false,
    message: "镜头放低，让肩、肘、手腕和髋部入镜",
    assessment: "等待识别后确定可评估项目",
    bodyLineVisible: false,
  };
  private baseline: Sample | null = null;
  private pendingTop: number | null = null;
  private candidate: PushupView = "unknown";
  private candidateSince = 0;
  private lastTime: number | null = null;
  private missingSince: number | null = null;
  private recoveredSince: number | null = null;
  private lastSample: Sample | null = null;
  private filtered: Sample | null = null;
  private bottomSince: number | null = null;
  private returnSince: number | null = null;
  private startTime = 0;
  private bottomTime = 0;
  private minAngle = 180;
  private minHeight = 1;
  private reachedBottom = false;
  private sagSince: number | null = null;
  private repFaults = new Set<string>();
  resetMotion() {
    this.phase = "IDLE";
    this.baseline = null;
    this.pendingTop = null;
    this.bottomSince = this.returnSince = null;
    this.reachedBottom = false;
    this.repFaults.clear();
    this.faults = [];
    this.sagSince = null;
    this.check.ready = false;
    this.filtered = null;
  }
  private block(message: string) {
    this.resetMotion();
    this.angle = undefined;
    this.check = {
      ...this.check,
      ready: false,
      message,
      bodyLineVisible: false,
      assessment: "暂停姿态评价",
    };
  }
  update(points: Point[], t: number, aspect = 1, enabled = true): Rep | null {
    if (!Number.isFinite(t) || (this.lastTime !== null && t <= this.lastTime))
      return null;
    const dt = this.lastTime === null ? 0 : t - this.lastTime;
    this.lastTime = t;
    if (dt > 0.8) this.block("画面中断，请重新推起停稳；已完成次数保留");
    const raw = pushupSample(points, aspect);
    if (!raw || !raw.supported) {
      this.missingSince ??= t;
      this.recoveredSince = null;
      this.angle = undefined;
      this.faults = [];
      this.sagSince = null;
      this.check = {
        ...this.check,
        ready: false,
        bodyLineVisible: false,
        assessment: "遮挡或姿态未确认，暂停评价",
        message: raw
          ? raw.view === "unknown"
            ? "请将镜头移到头部前方、身体侧面或斜侧面"
            : "请先做好俯卧撑支撑姿态，双手放在肩下方"
          : "请让肩、肘、手腕和髋部入镜；正面需看清双臂",
      };
      if (t - this.missingSince > 0.35) this.resetMotion();
      return null;
    }
    if (this.missingSince !== null) {
      const gap = t - this.missingSince;
      const old = this.lastSample;
      const continuous =
        old &&
        raw.source === old.source &&
        Math.abs(raw.yaw - old.yaw) < 15 &&
        old.arms.every((a) => {
          const b = raw.arms.find((b) => b.side === a.side);
          return b && distance(a.wrist, b.wrist) / a.scale < 0.25;
        });
      if (gap > 0.35 || !continuous) this.resetMotion();
      else {
        this.recoveredSince ??= t;
        if (t - this.recoveredSince < 0.08) {
          this.check.message = "画面已恢复，正在确认连续动作";
          return null;
        }
        this.startTime += gap;
        this.bottomTime += gap;
      }
      this.missingSince = this.recoveredSince = null;
      this.filtered = null;
      this.bottomSince = this.returnSince = null;
    }
    this.lastSample = raw;
    if (raw.view !== this.candidate) {
      this.candidate = raw.view;
      this.candidateSince = t;
    }
    if (t - this.candidateSince >= 0.25) this.check.view = raw.view;
    if (
      this.baseline &&
      (raw.source !== this.baseline.source ||
        Math.abs(raw.yaw - this.baseline.yaw) > 22 ||
        this.baseline.arms.some(
          (a) => !raw.arms.some((b) => b.side === a.side),
        ))
    ) {
      this.block("拍摄方向或可见手臂变化，请推起停稳后继续；已完成次数保留");
      this.check.view = "unknown";
      this.candidateSince = t;
      return null;
    }
    const alpha = 1 - Math.exp(-Math.min(dt || 0.05, 0.2) / 0.07);
    const sample: Sample = {
      ...raw,
      arms: raw.arms.map((a) => {
        const p = this.filtered?.arms.find((b) => b.side === a.side);
        return p
          ? {
              ...a,
              angle: p.angle + alpha * (a.angle - p.angle),
              height: p.height + alpha * (a.height - p.height),
            }
          : { ...a };
      }),
    };
    this.filtered = sample;
    const best = sample.arms.reduce((a, b) =>
      a.confidence >= b.confidence ? a : b,
    );
    this.side = this.baseline?.arms[0].side ?? best.side;
    const arms = this.baseline
      ? this.baseline.arms.map((a) =>
          sample.arms.find((b) => b.side === a.side)!,
        )
      : sample.view === "front"
        ? sample.arms
        : [best];
    this.angle = mean(arms.map((a) => a.angle));
    this.check.bodyLineVisible =
      raw.bodyLineVisible && this.check.view === "side";
    this.check.assessment = this.check.bodyLineVisible
      ? "可观察腰背直线；手肘外展暂不评价"
      : "当前腰背看不清，暂停腰背和手肘外展评价";
    if (!enabled) {
      this.resetMotion();
      this.check.message = "正面、侧面、斜侧面均可；开始后先推起停稳";
      return null;
    }
    if (!this.baseline) {
      const top =
        this.check.view !== "unknown" &&
        arms.every((a) => a.angle >= 145 && a.height >= 0.45);
      if (!top) this.pendingTop = null;
      else this.pendingTop ??= t;
      if (this.pendingTop === null || t - this.pendingTop < 0.25) {
        this.check.ready = false;
        this.check.message = "请先推起至手臂伸展，并稍作停留";
        return null;
      }
      this.baseline = { ...sample, arms: arms.map((a) => ({ ...a })) };
      this.check.ready = true;
      this.check.message = "准备就绪，完整下放再推起后计数";
      return null;
    }
    this.check.ready = true;
    const base = this.baseline;
    const ratios = arms.map((a, i) => a.height / base.arms[i].height);
    const height = mean(ratios);
    const bent = arms.every((a, i) => base.arms[i].angle - a.angle > 18);
    const top = arms.every(
      (a, i) =>
        a.angle >= Math.max(140, base.arms[i].angle - 12) && ratios[i] >= 0.87,
    );
    const bottom = arms.every(
      (a, i) =>
        base.arms[i].angle - a.angle >= 35 &&
        ((a.angle < 115 && ratios[i] < 0.78) ||
          // Deep shoulder travel can corroborate a noisier 3D elbow estimate.
          // An ideal half-rep cannot satisfy this stronger travel threshold.
          (a.angle < 130 && ratios[i] < 0.55)),
    );
    if (
      this.phase !== "IDLE" &&
      (t - this.startTime > 30 ||
        arms.some(
          (a, i) =>
            distance(a.wrist, base.arms[i].wrist) / base.arms[i].scale > 0.35,
        ))
    ) {
      this.block("动作中断或机位移动，请重新推起停稳");
      return null;
    }
    // Form cues require current observable evidence, never a cached hidden joint.
    if (this.phase !== "IDLE" && this.check.bodyLineVisible && raw.sag)
      this.sagSince ??= t;
    else this.sagSince = null;
    this.faults =
      this.sagSince !== null && t - this.sagSince >= 0.25 ? ["body_sag"] : [];
    this.faults.forEach((f) => this.repFaults.add(f));
    if (this.phase === "IDLE") {
      if (bent && height < 0.9) {
        this.phase = "DESCENT";
        this.startTime = t;
        this.minAngle = this.angle;
        this.minHeight = height;
        this.reachedBottom = false;
        this.repFaults.clear();
        this.bottomSince = this.returnSince = null;
      }
    } else {
      this.minAngle = Math.min(this.minAngle, this.angle);
      this.minHeight = Math.min(this.minHeight, height);
      if (bottom) this.bottomSince ??= t;
      else this.bottomSince = null;
      if (
        this.bottomSince !== null &&
        t - this.bottomSince >= 0.08 &&
        t - this.startTime >= 0.18 &&
        !this.reachedBottom
      ) {
        this.reachedBottom = true;
        this.bottomTime = t;
        this.phase = "BOTTOM";
      }
      if (this.reachedBottom && height > this.minHeight + 0.08)
        this.phase = "ASCENT";
      if (top) this.returnSince ??= t;
      else this.returnSince = null;
      if (this.returnSince !== null && t - this.returnSince >= 0.1) {
        const duration = t - this.startTime;
        const complete =
          this.reachedBottom && duration >= 0.65 && t - this.bottomTime >= 0.18;
        const faults = [...this.repFaults];
        const rep: Rep | null = complete
          ? {
              count: ++this.count,
              duration,
              eccentric_s: this.bottomTime - this.startTime,
              concentric_s: t - this.bottomTime,
              min_angle: this.minAngle,
              full_depth: true,
              faults,
              score: Math.max(
                0,
                100 - faults.reduce((s, f) => s + (FAULTS[f]?.penalty ?? 0), 0),
              ),
              assessment: {
                view: this.check.view,
                limited: true,
                note: this.check.assessment,
              },
            }
          : null;
        this.phase = "IDLE";
        this.repFaults.clear();
        this.bottomSince = this.returnSince = null;
        this.check.message = complete
          ? "已完成一次完整往返"
          : "本次未确认完整下放，不计数；请完整下放再推起";
        return rep;
      }
    }
    this.check.message =
      this.phase === "IDLE"
        ? "准备下一次完整动作"
        : this.phase === "DESCENT"
          ? "正在下放，完整下放后再推起"
          : this.phase === "BOTTOM"
            ? "已确认下放，请推起"
            : "正在推起，回到起始高度后 +1";
    return null;
  }
}
