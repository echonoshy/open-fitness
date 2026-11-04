import {
  angle,
  landmarkVisible,
  requiredJoints,
  type BodySide,
  type Exercise,
  type Point,
} from "./engine";

// These are bounded recovery windows, not permission to count inferred frames.
export const OCCLUSION_GRACE = 0.65;
export const FRAME_GAP_LIMIT = 1;
const indices = {
  shoulder: 11,
  elbow: 13,
  wrist: 15,
  hip: 23,
  knee: 25,
  ankle: 27,
};

/** Reject upright poses before applying the existing body-line timer. Use
 * camera-relative x/y/z, correcting aspect only for this orientation check;
 * the joint-angle convention and other exercise counters stay unchanged. */
export function plankIsHorizontal(points: Point[], side: BodySide, aspect = 1) {
  if (!Number.isFinite(aspect) || aspect <= 0) return false;
  const offset = side === "right" ? 1 : 0;
  const [shoulder, hip, ankle] = [11, 23, 27].map((i) => points[i + offset]);
  if (![shoulder, hip, ankle].every(landmarkVisible)) return false;
  // Include depth so a supported body facing the camera is not rejected merely
  // because its horizontal image projection is short. This is an upright-pose
  // guard, not proof of ground contact or a full posture assessment.
  return [hip, ankle].every((point) => {
    const vertical = Math.abs(point.y - shoulder.y);
    const span = Math.hypot(
      (point.x - shoulder.x) * aspect,
      vertical,
      (point.z - shoulder.z) * aspect,
    );
    return span > 1e-5 && vertical / span < 0.7;
  });
}

export function continuousPose(
  before: Point[],
  after: Point[],
  exercise: Exercise | undefined,
  side: BodySide,
) {
  const ids = requiredJoints(exercise).map(
    (j) => indices[j] + (side === "right" ? 1 : 0),
  );
  if (
    !ids.every((i) => landmarkVisible(before[i]) && landmarkVisible(after[i]))
  )
    return false;
  const span = (points: Point[]) =>
    Math.hypot(
      Math.max(...ids.map((i) => points[i].x)) -
        Math.min(...ids.map((i) => points[i].x)),
      Math.max(...ids.map((i) => points[i].y)) -
        Math.min(...ids.map((i) => points[i].y)),
    );
  const scale = Math.max(span(before), 0.1);
  const ratio = span(after) / scale;
  return (
    ratio > 0.45 &&
    ratio < 1.8 &&
    ids.every(
      (i) =>
        Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y) <
        scale * 0.65,
    )
  );
}

export interface SquatCheck {
  ready: boolean;
  message: string;
  checks: { label: string; ok: boolean }[];
}

export class SquatPreparation {
  since: number | null = null;
  side?: BodySide;
  ready = false;
  previousAngle: number | null = null;
  state: SquatCheck = {
    ready: false,
    message: "请侧身站立，让肩、髋、膝、踝完整入镜",
    checks: [],
  };
  update(p: Point[], side: BodySide, t: number, aspect = 1): SquatCheck {
    const offset = side === "right" ? 1 : 0;
    const [shoulder, hip, knee, ankle] = [11, 23, 25, 27].map(
      (i) => p[i + offset],
    );
    const visible = [shoulder, hip, knee, ankle].every(landmarkVisible);
    let sideOn = false,
      upright = false,
      kneeAngle = 0;
    if (visible) {
      const torso = Math.hypot(
        (shoulder.x - hip.x) * aspect,
        shoulder.y - hip.y,
      );
      const pairWidth = (a: number, b: number) =>
        landmarkVisible(p[a]) && landmarkVisible(p[b])
          ? (Math.abs(p[a].x - p[b].x) * aspect) / Math.max(torso, 0.001)
          : null;
      const shoulders = pairWidth(11, 12),
        hips = pairWidth(23, 24);
      // A visible near side with an occluded far side is usable. Width is a
      // coarse view check, not an exact camera-yaw estimate.
      sideOn =
        torso > 0.04 &&
        (shoulders === null || shoulders < (this.ready ? 0.65 : 0.55)) &&
        (hips === null || hips < (this.ready ? 0.48 : 0.4));
      kneeAngle = angle(hip, knee, ankle);
      upright =
        kneeAngle > 165 &&
        shoulder.y < hip.y &&
        hip.y < knee.y &&
        knee.y < ankle.y;
    }
    if (!visible || !sideOn || this.side !== side) {
      this.since = null;
      this.ready = false;
      this.previousAngle = null;
    }
    this.side = side;
    if (!this.ready) {
      const stable =
        upright &&
        (this.previousAngle === null ||
          Math.abs(kneeAngle - this.previousAngle) < 5);
      if (!visible || !sideOn || !stable) this.since = null;
      else this.since ??= t;
      this.ready = this.since !== null && t - this.since >= 0.6;
      this.previousAngle = kneeAngle;
    }
    this.state = {
      ready: this.ready,
      message: !visible
        ? "请让同一侧肩、髋、膝、踝完整入镜"
        : !sideOn
          ? "请再侧身一些，让镜头从侧面看到腿部弯曲"
          : !this.ready
            ? "侧身自然站直并稍作停留；角度不稳定时请调整镜头"
            : "侧身站位检查通过，可以开始深蹲",
      checks: [
        { label: "肩髋膝踝入镜", ok: visible },
        { label: "侧身拍摄", ok: visible && sideOn },
        { label: "站立状态稳定", ok: this.ready },
      ],
    };
    return this.state;
  }
}
