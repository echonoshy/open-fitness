import type { Point } from "./engine";
import type { Movement } from "./movement-library";
import calibration from "./movement-calibration.json";

export type StatisticMode = "reps" | "hold" | "activity" | "timer";
export type MotionMetric =
  | "elbow"
  | "knee"
  | "hip"
  | "shoulder"
  | "spread"
  | "legs"
  | "ankle"
  | "twist"
  | "bend"
  | "shrug";
export type MovementProfile = {
  mode: StatisticMode;
  family: string;
  metric: MotionMetric;
  minRange: number;
  minPeriod: number;
  hint: string;
  reason?: string;
  aggregation?: "mean" | "min" | "max";
};
const side = "侧前方拍摄，相关关节完整入镜";
const front = "正面或侧前方拍摄，双手双脚完整入镜";
const rule = (
  family: string,
  metric: MotionMetric,
  minRange = 24,
  hint = side,
): MovementProfile => ({
  mode: "reps",
  family,
  metric,
  minRange,
  minPeriod: 0.65,
  hint,
});

/** Ordered families: compound and small-joint exceptions precede broad matches. */
export function movementProfile(
  movement: Pick<Movement, "slug">,
): MovementProfile {
  const s = movement.slug;
  if (
    /swim|wrist|forearm-pronation|^neck|lateral-neck|chin-tuck|plate-pinch/.test(
      s,
    )
  )
    return {
      ...rule("手动记录", "elbow"),
      mode: "timer",
      reason: /swim/.test(s)
        ? "水下姿态容易被遮挡"
        : "手指、腕部或颈部幅度较小",
      hint: "使用训练计时，也可以填写完成次数",
    };
  if (
    /plank|wall-sit|isometric|dead-hang|prying-hold|single-leg-balance$|stretch/.test(
      s,
    ) &&
    !/plank-lateral/.test(s)
  )
    return {
      ...rule(
        "静态保持",
        /plank/.test(s)
          ? "hip"
          : /squat|wall-sit/.test(s)
            ? "knee"
            : "shoulder",
      ),
      mode: "hold",
      hint: "按示范保持动作，身体离开画面时暂停累计",
    };
  if (
    /cycling|bike|bicycle$|treadmill|running|(?:^|-)run(?:$|-)|rowing-(machine|sprint|interval)|ski-erg|elliptical|arc-trainer|stair-climber|versaclimber|ride|hill-climb|hiking|carry|sled-|ropes|jump-rope|bear-crawl|heel-and-toe-walk|shadow-box|turkish|get-up|man-maker|clean|snatch|jerk|thruster|burpee|wall-ball|medicine-ball|squat-thrusts|muscle-up|halo|cuban|bradford|raise-to-front|raise-and-pullover|side-plank-lateral|prone-y-t|hip-circles|arm-circles|90-90|open-book|cat-camel|thoracic|pelvic-tilt|ankle-circles|shoulder-roll|snap-down|balance-reach|dislocates|pass-through|mobilization/.test(
      s,
    )
  )
    return {
      ...rule("连续活动", "hip"),
      mode: "activity",
      hint: "全身入镜，检测到持续活动时累计；停下或离开画面暂停累计",
    };
  if (/calf|soleus|tibialis|pogo|eccentric-calf/.test(s))
    return rule("踝部提踵", "ankle", 12, "侧面低机位，膝、踝、脚尖完整入镜");
  if (/shrug|scapular-pull/.test(s))
    return rule("耸肩提拉", "shrug", 10, front);
  if (
    /lateral-raise|lateral-raises|rear-delt-fly|reverse-fly|reverse-pec|rear-lateral|front-raise|anti-gravity/.test(
      s,
    )
  )
    return rule("肩部抬举", "shoulder", 28, front);
  if (/fly|external-rotation/.test(s))
    return rule("肩部开合", "spread", 22, front);
  if (/hip-abduction|hip-adduction|clamshell|fire-hydrant|jumping-jack/.test(s))
    return rule("髋部开合", "legs", 18, front);
  if (/wood-chop|wood-chopper|cable-chop|russian-twist|torso-rotation/.test(s))
    return rule("躯干转动", "twist", 20, front);
  if (/side-bend|windmill/.test(s)) return rule("躯干侧屈", "bend", 16, front);
  if (
    /crunch|sit-up|situp|v-up|knee-raise|knee-raises|leg-raise|toes-to-bar|dead-bug|bird-dog|mountain-climber|knee-hugs|leg-swings/.test(
      s,
    )
  )
    return rule("核心收放", "hip", 20);
  if (/pullover|straight-arm/.test(s)) return rule("直臂摆动", "shoulder", 25);
  if (/leg-curl|hamstring-curl|nordic/.test(s))
    return rule("屈膝弯举", "knee", 25);
  if (/leg-extension/.test(s)) return rule("伸膝抬腿", "knee", 25);
  if (
    /deadlift|deadlifts|good-morning|hip-hinge|jefferson|pull-through|back-extension|hyperextension|superman|hip-thrust|glute-bridge|frog-pump|kickback|rock-back|hip-flexor-rock/.test(
      s,
    ) &&
    !/tricep/.test(s)
  )
    return rule("髋部屈伸", "hip", 18);
  if (/squat|lunge|lunges|step-up|step-down|leg-press|bound|hop|jump/.test(s))
    return rule("蹲起蹬伸", "knee", 25);
  if (/curl/.test(s)) return rule("屈肘弯举", "elbow", 28);
  if (
    /tricep|skullcrusher|pushdown|push-down|overhead.*extension|tate-press|jm-press/.test(
      s,
    )
  )
    return rule("肘部伸展", "elbow", 28);
  if (/row|pull-up|pull-ups|chin-up|pulldown|face-pull|high-pull/.test(s))
    return rule("上肢拉动", "elbow", 25);
  if (/press|push-up|push-ups|dips/.test(s))
    return rule("上肢推起", "elbow", 25);
  return {
    ...rule("连续活动", "hip"),
    mode: "activity",
    hint: "全身入镜，按身体活动时间统计；次数可自行填写",
  };
}

export function movementCalibration(slug: string) {
  return (
    calibration as Record<
      string,
      {
        target?: number;
        minRange?: number;
        fallback?: boolean;
        aggregation?: "mean" | "min" | "max";
      }
    >
  )[slug];
}
export function effectiveMovementProfile(movement: Pick<Movement, "slug">) {
  const profile = movementProfile(movement);
  const reference = movementCalibration(movement.slug);
  if (reference?.minRange) profile.minRange = reference.minRange;
  if (reference?.aggregation) profile.aggregation = reference.aggregation;
  if (reference?.fallback && profile.mode === "reps") {
    profile.mode = "activity";
    profile.reason = "演示中的关节往返不够稳定，改用活动时间";
    profile.hint = "全身入镜，按活动时间统计；可自行填写次数";
  }
  return profile;
}

export const statisticLabel = (mode: StatisticMode) =>
  ({
    reps: "估算计数",
    hold: "保持计时",
    activity: "活动计时",
    timer: "计时记录",
  })[mode];
export function visible(p: Point | undefined) {
  return (
    !!p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    (p.visibility ?? 0) >= 0.5 &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}
const degrees = (a: number) => (a * 180) / Math.PI;
function angle(
  p: Point[],
  a: number,
  b: number,
  c: number,
  aspect: number,
): number | null {
  if (![a, b, c].every((i) => visible(p[i]))) return null;
  const u = [(p[a].x - p[b].x) * aspect, p[a].y - p[b].y],
    v = [(p[c].x - p[b].x) * aspect, p[c].y - p[b].y];
  const d = Math.hypot(...u) * Math.hypot(...v);
  return d > 0.00001
    ? degrees(
        Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / d))),
      )
    : null;
}
function mean(values: (number | null)[]) {
  const valid = values.filter((x): x is number => x !== null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
export function motionValue(
  points: Point[],
  metric: MotionMetric,
  aspect = 1,
  aggregation: "mean" | "min" | "max" = "mean",
): number | null {
  if (!Number.isFinite(aspect) || aspect <= 0 || points.length < 33)
    return null;
  const p = points;
  const both = (a: number, b: number, c: number) => {
    const values = [
      angle(p, a, b, c, aspect),
      angle(p, a + 1, b + 1, c + 1, aspect),
    ].filter((v): v is number => v !== null);
    return values.length
      ? aggregation === "min"
        ? Math.min(...values)
        : aggregation === "max"
          ? Math.max(...values)
          : mean(values)
      : null;
  };
  if (metric === "elbow") return both(11, 13, 15);
  if (metric === "knee") return both(23, 25, 27);
  if (metric === "hip") return both(11, 23, 25);
  if (metric === "shoulder") return both(23, 11, 15);
  if (metric === "ankle") return both(25, 27, 31);
  if (metric === "legs")
    return mean([angle(p, 25, 23, 24, aspect), angle(p, 26, 24, 23, aspect)]);
  if (![11, 12, 23, 24].every((i) => visible(p[i]))) return null;
  const shoulder = { x: (p[11].x + p[12].x) / 2, y: (p[11].y + p[12].y) / 2 };
  const hip = { x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 };
  const torso = Math.hypot((shoulder.x - hip.x) * aspect, shoulder.y - hip.y);
  if (torso < 0.04) return null;
  if (metric === "spread")
    return visible(p[15]) && visible(p[16])
      ? (Math.hypot((p[15].x - p[16].x) * aspect, p[15].y - p[16].y) / torso) *
          45
      : null;
  if (metric === "bend")
    return degrees(
      Math.atan2((shoulder.x - hip.x) * aspect, hip.y - shoulder.y),
    );
  if (metric === "twist")
    return visible(p[15]) && visible(p[16])
      ? ((((p[15].x + p[16].x) / 2 - hip.x) * aspect) / torso) * 70
      : null;
  return visible(p[0])
    ? (Math.hypot((p[0].x - shoulder.x) * aspect, p[0].y - shoulder.y) /
        torso) *
        100
    : null;
}

export type StatisticSnapshot = {
  mode: StatisticMode;
  reps: number;
  seconds: number;
  tracking: boolean;
  notice: string;
  family: string;
  hint: string;
  phase: string;
};

/** Complete oscillations with hysteresis. Amplitude adapts to the user's range;
 * missing frames, rest and pause discard incomplete cycles, never saved totals. */
export class MovementStatistics {
  reps = 0;
  seconds = 0;
  private previousTime?: number;
  private smooth?: number;
  private low = Infinity;
  private high = -Infinity;
  private origin: "low" | "high" | null = null;
  private crossed = false;
  private cycleAt = 0;
  private lastCount = -Infinity;
  private samples = 0;
  private first?: number;
  private firstAt = 0;
  private previousPoints?: Point[];
  private movingUntil = -Infinity;
  private validSince?: number;
  tracking = false;
  notice = "全身入镜后开始统计";
  constructor(
    public profile: MovementProfile,
    private holdTarget?: number,
  ) {}
  reset() {
    this.reps = 0;
    this.seconds = 0;
    this.breakContinuity();
  }
  breakContinuity() {
    this.previousTime = undefined;
    this.smooth = undefined;
    this.low = Infinity;
    this.high = -Infinity;
    this.origin = null;
    this.crossed = false;
    this.samples = 0;
    this.previousPoints = undefined;
    this.first = undefined;
    this.movingUntil = -Infinity;
    this.validSince = undefined;
    this.tracking = false;
  }
  snapshot(): StatisticSnapshot {
    return {
      mode: this.profile.mode,
      reps: this.reps,
      seconds: this.seconds,
      tracking: this.tracking,
      notice: this.notice,
      family: this.profile.family,
      hint: this.profile.hint,
      phase: this.crossed ? "完成回程" : "完整往返",
    };
  }
  frame(points: Point[], t: number, aspect = 1) {
    if (
      !Number.isFinite(t) ||
      (this.previousTime !== undefined && t <= this.previousTime)
    )
      return;
    const gap = this.previousTime === undefined ? 0 : t - this.previousTime;
    if (gap > 0.5) this.breakContinuity();
    const dt = gap > 0 && gap <= 0.5 ? gap : 0;
    this.previousTime = t;
    const value = motionValue(
      points,
      this.profile.metric,
      aspect,
      this.profile.aggregation,
    );
    const torsoVisible =
      (visible(points[11]) && visible(points[23])) ||
      (visible(points[12]) && visible(points[24]));
    if (!torsoVisible || (this.profile.mode === "reps" && value === null)) {
      this.breakContinuity();
      this.notice = "关键关节未入镜，统计已等待";
      return;
    }
    this.tracking = true;
    if (this.profile.mode === "timer") {
      this.notice = this.profile.reason ?? "使用训练计时";
      return;
    }
    let speed = 0;
    if (this.previousPoints && dt > 0) {
      const ids = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
      const displacements = ids
        .filter((i) => visible(points[i]) && visible(this.previousPoints![i]))
        .map(
          (i) =>
            Math.hypot(
              (points[i].x - this.previousPoints![i].x) * aspect,
              points[i].y - this.previousPoints![i].y,
            ) / dt,
        );
      const movingJoints = displacements.sort((a, b) => b - a).slice(0, 4);
      speed = movingJoints.length
        ? movingJoints.reduce((a, b) => a + b, 0) / movingJoints.length
        : 0;
    }
    this.previousPoints = points.map((p) => ({ ...p }));
    if (this.profile.mode === "activity") {
      if (speed > 0.055 && speed < 3) this.movingUntil = t + 0.35;
      if (dt && t <= this.movingUntil) this.seconds += dt;
      this.notice =
        t <= this.movingUntil
          ? "检测到活动，正在累计"
          : "等待活动，静止时不累计";
      return;
    }
    if (this.profile.mode === "hold") {
      const matches =
        value !== null &&
        (this.holdTarget === undefined ||
          Math.abs(value - this.holdTarget) <= 38) &&
        speed < 0.4;
      if (matches) this.validSince ??= t;
      else this.validSince = undefined;
      if (this.validSince !== undefined && t - this.validSince >= 0.5)
        this.seconds += dt;
      this.notice = matches ? "保持姿态，正在累计" : "参照小人调整姿态并停稳";
      return;
    }
    if (value === null) return;
    this.smooth =
      this.smooth === undefined
        ? value
        : this.smooth + 0.45 * (value - this.smooth);
    const v = this.smooth;
    if (this.first === undefined) {
      this.first = v;
      this.firstAt = t;
    }
    this.samples++;
    this.low = Math.min(this.low, v);
    this.high = Math.max(this.high, v);
    const range = this.high - this.low;
    if (range < this.profile.minRange || this.samples < 4) {
      this.notice = "先完整做一次，正在适应动作幅度";
      return;
    }
    const zone =
      v <= this.low + range * 0.25
        ? "low"
        : v >= this.high - range * 0.25
          ? "high"
          : null;
    if (!this.origin && zone) {
      this.origin =
        this.first <= this.low + range * 0.25
          ? "low"
          : this.first >= this.high - range * 0.25
            ? "high"
            : zone;
      this.cycleAt = this.firstAt;
    }
    if (zone && this.origin && zone !== this.origin) this.crossed = true;
    if (
      zone &&
      zone === this.origin &&
      this.crossed &&
      t - this.lastCount >= this.profile.minPeriod &&
      t - this.cycleAt >= this.profile.minPeriod
    ) {
      this.reps++;
      this.lastCount = t;
      this.cycleAt = t;
      this.crossed = false;
      // Slowly forget an early outlier without shrinking into camera jitter.
      this.low += range * 0.025;
      this.high -= range * 0.025;
    }
    if (this.origin && t - this.cycleAt > 15) {
      this.origin = zone;
      this.crossed = false;
      this.cycleAt = t;
      this.low = v;
      this.high = v;
    }
    this.notice = this.crossed
      ? "回到起始姿态完成一次"
      : "按自己的节奏完整往返";
  }
}
