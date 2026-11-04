import {
  EXERCISES,
  type Exercise,
  type Point,
  poseSelection,
  type BodySide,
} from "./engine";
export interface Environment {
  brightness: number | null;
  fps: number | null;
  visibility: number;
  missing: string[];
  inFrame: boolean;
  cameraHint: string;
}
export function cameraEnvironment(
  points: Point[],
  exercise: Exercise,
  brightness: number | null,
  fps: number | null,
  side?: BodySide,
): Environment {
  const selection = poseSelection(points, exercise, side);
  const { missing } = selection;
  return {
    brightness,
    fps,
    visibility: selection.visibility,
    missing,
    inFrame: selection.visible,
    cameraHint: EXERCISES[exercise].hint,
  };
}
export function countingHints(state: {
  environment?: Environment;
  tracking: boolean;
  status: string;
  exercise: Exercise;
  phase: string;
  squatCheck?: { ready: boolean; message: string };
  pushupCheck?: { ready: boolean; message: string; assessment: string };
}) {
  const e = state.environment;
  const hints: string[] = [];
  if (e?.brightness != null && e.brightness < 0.23)
    hints.push("画面偏暗，请开灯或面向光源");
  if (e?.missing.length)
    hints.push(`请让${e.missing.join("、")}进入画面；可以稍微后退或调整镜头`);
  else if (!state.tracking) hints.push("尚未稳定识别身体，请完整入镜");
  if (e?.fps != null && e.fps > 0 && e.fps < 15)
    hints.push(
      "处理帧率偏低，快速动作可能漏计，请关闭占用摄像头或算力的其他应用",
    );
  if (state.squatCheck && !state.squatCheck.ready)
    hints.push(state.squatCheck.message);
  if (state.pushupCheck) {
    hints.push(state.pushupCheck.message);
    hints.push(state.pushupCheck.assessment);
  }
  if (state.status === "ready") hints.push("点击开始训练后才会计数");
  else if (state.status === "paused") hints.push("训练已暂停，继续后才会计数");
  else if (state.status === "resting")
    hints.push("正在休息，倒计时结束后恢复计数");
  else if (state.tracking && !hints.length)
    hints.push(
      state.exercise === "plank"
        ? "身体保持直线时累计有效支撑时长"
        : state.phase === "IDLE"
          ? "等待完整动作：从起始位置下放，再回到起始位置"
          : "正在识别本次动作，完成回位后计数",
    );
  return hints;
}
