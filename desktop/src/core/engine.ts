export type Exercise =
  | "squat"
  | "pushup"
  | "bench"
  | "deadlift"
  | "lunge"
  | "shoulder_press"
  | "curl"
  | "pullup"
  | "plank";
export type Phase = "IDLE" | "DESCENT" | "BOTTOM" | "ASCENT";
export interface Spec {
  label: string;
  signal: string;
  start: number;
  bottom: number;
  lockout: number;
  concentric: "ascent" | "descent";
  minCon: number;
  hint: string;
}
const sp = (
  label: string,
  signal: string,
  start: number,
  bottom: number,
  lockout: number,
  hint = "侧对摄像头，全身入镜",
  concentric: "ascent" | "descent" = "ascent",
  minCon = 0.6,
): Spec => ({
  label,
  signal,
  start,
  bottom,
  lockout,
  hint,
  concentric,
  minCon,
});
export const EXERCISES: Record<Exercise, Spec> = {
  squat: sp("深蹲", "knee", 150, 100, 165, "侧身站立，肩、髋、膝、踝完整入镜"),
  pushup: sp(
    "俯卧撑",
    "elbow",
    140,
    95,
    155,
    "正面、侧面、斜侧面均可；镜头放低，让肩肘腕和髋部入镜",
    "ascent",
    0.4,
  ),
  bench: sp("卧推", "elbow", 140, 90, 160, "侧面拍摄，摄像头与头部等高"),
  deadlift: sp("硬拉", "hip", 150, 100, 165),
  lunge: sp("弓步蹲", "knee", 150, 110, 165, "侧面或前方45°，全身入镜"),
  shoulder_press: sp(
    "肩上推举",
    "elbow",
    150,
    100,
    160,
    "正对摄像头，双手完整入镜",
  ),
  curl: sp(
    "二头弯举",
    "elbow",
    140,
    70,
    155,
    "侧面或略侧面，让肩、肘、手腕入镜",
    "descent",
    0.5,
  ),
  pullup: sp(
    "引体向上",
    "elbow",
    140,
    80,
    160,
    "正对摄像头，双手完整入镜",
    "descent",
  ),
  plank: sp("平板支撑", "body_line", 0, 0, 0),
};
export interface Rep {
  assessment?: {
    view: "front" | "oblique" | "side" | "unknown";
    limited: boolean;
    note: string;
  };
  load_kg?: number;
  velocity?: number;
  similarity?: number;
  trajectory?: number[];
  measured?: boolean;
  count: number;
  duration: number;
  eccentric_s: number;
  concentric_s: number;
  min_angle: number;
  full_depth: boolean;
  faults: string[];
  score: number;
}
export class RepCounter {
  phase: Phase = "IDLE";
  count = 0;
  tStart = 0;
  tBottom = 0;
  minAngle = 180;
  faults = new Set<string>();
  constructor(public spec: Spec) {}
  resetMotion() {
    this.phase = "IDLE";
    this.faults.clear();
  }
  update(angle: number, t: number): Rep | null {
    const s = this.spec;
    if (this.phase === "IDLE") {
      if (angle < s.start) {
        this.phase = "DESCENT";
        this.tStart = t;
        this.tBottom = t;
        this.minAngle = angle;
        this.faults.clear();
      }
    } else if (this.phase === "DESCENT") {
      if (angle <= this.minAngle) {
        this.minAngle = angle;
        this.tBottom = t;
      }
      if (angle < s.bottom) {
        this.phase = "BOTTOM";
      } else if (angle > this.minAngle + 15) {
        this.phase = "ASCENT";
      }
    } else if (this.phase === "BOTTOM") {
      // The reversal is confirmed later by hysteresis; time it at the observed
      // minimum, not when we cross a depth threshold or confirm the ascent.
      if (angle <= this.minAngle) {
        this.minAngle = angle;
        this.tBottom = t;
      }
      if (angle > this.minAngle + 10) this.phase = "ASCENT";
    } else if (angle > s.lockout) {
      this.phase = "IDLE";
      const duration = t - this.tStart;
      if (duration < 0.8) return null;
      this.count++;
      const down = this.tBottom - this.tStart,
        up = t - this.tBottom;
      const ecc = s.concentric === "ascent" ? down : up,
        con = s.concentric === "ascent" ? up : down;
      const faults = [...this.faults];
      if (this.minAngle >= s.bottom) faults.push("shallow");
      if (con < s.minCon) faults.push("too_fast");
      return {
        count: this.count,
        duration,
        eccentric_s: ecc,
        concentric_s: con,
        min_angle: this.minAngle,
        full_depth: this.minAngle < s.bottom,
        faults,
        score: Math.max(
          0,
          100 - faults.reduce((n, f) => n + (FAULTS[f]?.penalty ?? 0), 0),
        ),
      };
    }
    return null;
  }
}
export class PlankTracker {
  total = 0;
  streak = 0;
  best = 0;
  badFor = 0;
  previous: number | null = null;
  resetMotion() {
    this.previous = null;
    this.streak = 0;
    this.badFor = 0;
  }
  update(angle: number, t: number) {
    const dt = this.previous === null ? 0 : Math.max(0, t - this.previous);
    this.previous = t;
    if (angle >= 160) {
      this.total += dt;
      this.streak += dt;
      this.best = Math.max(this.best, this.streak);
      this.badFor = 0;
      return false;
    }
    const wasOK = this.badFor <= 1;
    this.badFor += dt;
    if (this.badFor > 1) {
      this.streak = 0;
      return wasOK;
    }
    return false;
  }
}
export type Point = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  world?: { x: number; y: number; z: number };
};
export type BodySide = "left" | "right";
const joints = {
  shoulder: [11, 12, "肩部"],
  elbow: [13, 14, "肘部"],
  wrist: [15, 16, "手腕"],
  hip: [23, 24, "髋部"],
  knee: [25, 26, "膝盖"],
  ankle: [27, 28, "脚踝"],
} as const;
type Joint = keyof typeof joints;
export function requiredJoints(exercise?: Exercise): Joint[] {
  if (!exercise) return ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"];
  if (exercise === "squat") return ["shoulder", "hip", "knee", "ankle"];
  if (
    ["curl", "shoulder_press", "pushup", "bench", "pullup"].includes(exercise)
  )
    return ["shoulder", "elbow", "wrist"];
  if (exercise === "deadlift") return ["shoulder", "hip", "knee"];
  if (exercise === "plank") return ["shoulder", "hip", "ankle"];
  return ["hip", "knee", "ankle"];
}
export const landmarkVisible = (p: Point | undefined) =>
  !!p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  Number.isFinite(p.z) &&
  (p.visibility ?? 0) > 0.5 &&
  p.x > 0 &&
  p.x < 1 &&
  p.y > 0 &&
  p.y < 1;
export function poseSelection(
  points: Point[],
  exercise?: Exercise,
  preferred?: BodySide,
) {
  const required = requiredJoints(exercise);
  const missingFor = (side: BodySide) =>
    required.filter(
      (j) => !landmarkVisible(points[joints[j][side === "left" ? 0 : 1]]),
    );
  const left = missingFor("left"),
    right = missingFor("right");
  const score = (side: BodySide) =>
    required.reduce(
      (n, j) =>
        n + (points[joints[j][side === "left" ? 0 : 1]]?.visibility ?? 0),
      0,
    );
  const best: BodySide =
    left.length !== right.length
      ? left.length < right.length
        ? "left"
        : "right"
      : score("left") >= score("right")
        ? "left"
        : "right";
  // Keep the same anatomical side during a motion; callers decide when to reacquire.
  const side = preferred ?? best;
  const missing = missingFor(side).map((j) => joints[j][2]);
  return {
    side,
    missing,
    visible: points.length === 33 && missing.length === 0,
    visibility: (required.length - missing.length) / required.length,
    confidence: score(side) / required.length,
  };
}
export type Angles = Record<string, number>;
export function angle(a: Point, b: Point, c: Point) {
  // Match upstream pose_coach.py: landmarks_to_array -> joint_angle uses
  // normalized image x/y/z, including z, with no aspect-ratio rescaling.
  // The exercise thresholds were inherited from that coordinate convention.
  const u = [a.x - b.x, a.y - b.y, a.z - b.z],
    v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const d = Math.hypot(...u) * Math.hypot(...v);
  return d < 1e-9
    ? 180
    : (Math.acos(
        Math.max(-1, Math.min(1, u.reduce((s, x, i) => s + x * v[i], 0) / d)),
      ) *
        180) /
        Math.PI;
}
const vertical = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y) < 1e-9
    ? 0
    : (Math.acos(
        Math.max(
          -1,
          Math.min(1, -(a.y - b.y) / (Math.hypot(a.x - b.x, a.y - b.y) || 1)),
        ),
      ) *
        180) /
      Math.PI;
export function bodyAngles(
  p: Point[],
  exercise?: Exercise,
  preferred?: BodySide,
) {
  const selection = poseSelection(p, exercise, preferred);
  if (p.length !== 33) return { angles: {} as Angles, ...selection };
  const vis = (i: number) => p[i].visibility ?? 0;
  const left = selection.side === "left";
  const [ear, sho, elb, wri, hip, kne, ank] = left
    ? [7, 11, 13, 15, 23, 25, 27]
    : [8, 12, 14, 16, 24, 26, 28];
  const measured = (ids: number[], value: () => number) =>
    ids.every((i) => landmarkVisible(p[i])) ? value() : NaN;
  const angles: Angles = {
    knee: angle(p[hip], p[kne], p[ank]),
    hip: angle(p[sho], p[hip], p[kne]),
    elbow: angle(p[sho], p[elb], p[wri]),
    trunk_lean: vertical(p[sho], p[hip]),
    upper_arm_swing: vertical(p[sho], p[elb]),
    body_line: angle(p[sho], p[hip], p[ank]),
    elbow_flare: angle(p[hip], p[sho], p[elb]),
    neck: vis(ear) > 0.5 ? angle(p[ear], p[sho], p[hip]) : 180,
    valgus_ratio:
      Math.min(...[25, 26, 27, 28].map(vis)) > 0.5
        ? Math.abs(p[25].x - p[26].x) /
          Math.max(Math.abs(p[27].x - p[28].x), 1e-4)
        : 1,
    wrist_y_diff:
      Math.min(vis(15), vis(16)) > 0.5 ? Math.abs(p[15].y - p[16].y) : 0,
    nose_above_wrists:
      Math.min(vis(15), vis(16)) > 0.5 ? (p[15].y + p[16].y) / 2 - p[0].y : 1,
  };
  // Optional form cues must not use inferred or hidden joints.
  const needs: Record<string, number[]> = {
    knee: [hip, kne, ank],
    hip: [sho, hip, kne],
    elbow: [sho, elb, wri],
    trunk_lean: [sho, hip],
    upper_arm_swing: [sho, elb],
    body_line: [sho, hip, ank],
    elbow_flare: [hip, sho, elb],
    neck: [ear, sho, hip],
    valgus_ratio: [25, 26, 27, 28],
    wrist_y_diff: [15, 16],
    nose_above_wrists: [0, 15, 16],
  };
  for (const [key, ids] of Object.entries(needs)) {
    if (!Number.isFinite(measured(ids, () => angles[key]))) delete angles[key];
  }
  for (const key of [
    "knee",
    "hip",
    "elbow",
    "body_line",
    "elbow_flare",
    "neck",
    "trunk_lean",
    "upper_arm_swing",
  ]) {
    const ids = needs[key];
    if (
      ids.some(
        (id, i) =>
          i > 0 &&
          Math.hypot(
            p[id].x - p[ids[i - 1]].x,
            p[id].y - p[ids[i - 1]].y,
            p[id].z - p[ids[i - 1]].z,
          ) < 1e-5,
      )
    )
      delete angles[key];
  }
  return {
    angles,
    ...selection,
    visible:
      selection.visible &&
      (exercise
        ? Number.isFinite(angles[EXERCISES[exercise].signal])
        : ["knee", "hip", "elbow", "trunk_lean"].every((k) =>
            Number.isFinite(angles[k]),
          )),
  };
}
export const FAULTS: Record<string, { text: string; penalty: number }> = {
  back_lean: { text: "稳住背部，胸口抬起", penalty: 25 },
  back_round: { text: "保持背部平直", penalty: 30 },
  body_sag: { text: "收紧核心，让身体保持直线", penalty: 25 },
  knees_cave: { text: "膝盖对准脚尖，避免内扣", penalty: 25 },
  shallow: { text: "在舒适范围内，再做深一点", penalty: 20 },
  elbow_swing: { text: "肘部靠近身体两侧", penalty: 20 },
  elbow_flare: { text: "肘部稍微靠近身体", penalty: 15 },
  torso_lean: { text: "保持躯干直立", penalty: 15 },
  lean_back: { text: "收紧核心，避免向后仰", penalty: 15 },
  uneven: { text: "两侧保持同步", penalty: 15 },
  chin: { text: "继续向上，下巴超过横杆", penalty: 15 },
  shrug_neck: { text: "颈部保持自然位置", penalty: 10 },
  too_fast: { text: "慢一点，控制动作节奏", penalty: 10 },
};
export function liveFaults(ex: Exercise, a: Angles, s: Phase) {
  const moving = s !== "IDLE",
    f: string[] = [];
  const add = (yes: boolean, k: string) => {
    if (yes) f.push(k);
  };
  if (ex === "squat") {
    add(moving && a.trunk_lean > 50, "back_lean");
    // Squats require a side view. Bilateral horizontal spacing in that view
    // cannot support a knee-valgus assessment, so do not turn it into a penalty.
  }
  if (ex === "pushup") {
    add(moving && a.body_line < 155, "body_sag");
    add(s === "BOTTOM" && a.elbow_flare > 100, "elbow_flare");
  }
  if (ex === "bench") add(moving && a.wrist_y_diff > 0.08, "uneven");
  if (ex === "deadlift") add(moving && a.neck < 150, "back_round");
  if (ex === "lunge") add(moving && a.trunk_lean > 30, "torso_lean");
  if (ex === "shoulder_press") {
    add(moving && a.trunk_lean > 20, "lean_back");
    add(moving && a.wrist_y_diff > 0.08, "uneven");
  }
  if (ex === "curl") {
    add(moving && a.upper_arm_swing > 25, "elbow_swing");
    add(moving && a.trunk_lean > 20, "torso_lean");
  }
  if (ex === "pullup") {
    add(s === "BOTTOM" && a.nose_above_wrists < 0, "chin");
    add(moving && a.wrist_y_diff > 0.1, "uneven");
  }
  if (ex === "plank") add(a.neck < 140, "shrug_neck");
  return f;
}
export class OneEuro {
  x: number | null = null;
  dx = 0;
  t = 0;
  update(x: number, t: number) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.max(t - this.t, 1e-6),
      alpha = (c: number) => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const d = (x - this.x) / dt;
    this.dx = alpha(1) * d + (1 - alpha(1)) * this.dx;
    const a = alpha(1 + 0.02 * Math.abs(this.dx));
    this.x = a * x + (1 - a) * this.x;
    this.t = t;
    return this.x;
  }
}
export class Smoother {
  private visible = Array(33).fill(false);
  filters = Array.from({ length: 33 }, () => [
    new OneEuro(),
    new OneEuro(),
    new OneEuro(),
  ]);
  update(p: Point[], t: number) {
    return p.map((v, i) => {
      if (!landmarkVisible(v)) {
        this.visible[i] = false;
        return { ...v };
      }
      if (!this.visible[i])
        this.filters[i] = [new OneEuro(), new OneEuro(), new OneEuro()];
      this.visible[i] = true;
      return {
        ...v,
        x: this.filters[i][0].update(v.x, t),
        y: this.filters[i][1].update(v.y, t),
        z: this.filters[i][2].update(v.z, t),
      };
    });
  }
}
