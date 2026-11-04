import { EXERCISES, FAULTS } from "./engine";
import type { Snapshot } from "./session";

export function motionFeedback(state: Snapshot, cameraOn: boolean) {
  const spec = EXERCISES[state.exercise];
  const angle =
    state.tracking && cameraOn ? state.angles[spec.signal] : undefined;
  const curling = ["curl", "pullup"].includes(state.exercise);
  const stages =
    state.exercise === "plank"
      ? ["保持直线", "累计时长"]
      : curling
        ? ["起始位", "弯曲", "回位", "计次"]
        : ["起始位", "下放", "回位", "计次"];
  const stage =
    state.exercise === "plank"
      ? angle !== undefined && angle >= 160
        ? 1
        : 0
      : state.phase === "IDLE"
        ? 0
        : state.phase === "ASCENT"
          ? 2
          : 1;
  let title = "",
    detail = "";
  if (!cameraOn) {
    title =
      state.status === "paused"
        ? "摄像头已关闭 · 已暂停"
        : "开启摄像头后检查动作";
    detail =
      state.status === "paused" ? "重新开启摄像头后，点击继续训练" : spec.hint;
  } else if (!state.tracking) {
    title = "识别中 · 暂不计数";
    detail = state.environment?.missing.length
      ? `请让${state.environment.missing.join("、")}入镜`
      : state.trackingNotice || "请调整镜头，让动作所需关节入镜";
  } else if (state.status === "ready") {
    title = state.pushupCheck
      ? "俯卧撑拍摄准备"
      : state.squatCheck && !state.squatCheck.ready
        ? "侧身站位检查"
        : "动作已识别 · 尚未开始";
    detail = state.pushupCheck
      ? "正面、侧面、斜侧面均可；开始后先推起停稳"
      : state.squatCheck && !state.squatCheck.ready
        ? state.squatCheck.message
        : "点击开始训练，或说“开始训练”";
  } else if (state.status === "paused") {
    title = "已暂停计数";
    detail = "点击继续训练，或说“继续训练”";
  } else if (state.status === "resting") {
    title = "休息中 · 暂不计数";
    detail = "休息结束后继续本组";
  } else if (state.auto && !state.detected) {
    title = "正在识别动作类型";
    detail = "锁定后，从下一次完整动作开始计数";
  } else if (state.squatCheck && !state.squatCheck.ready) {
    title = "侧身站位检查 · 暂不计数";
    detail = state.squatCheck.message;
  } else if (state.pushupCheck) {
    title = !state.pushupCheck.ready
      ? "支撑就位检查 · 暂不计数"
      : state.phase === "IDLE"
        ? "准备下一次动作"
        : state.phase === "DESCENT"
          ? "正在下放"
          : state.phase === "BOTTOM"
            ? "已确认下放 · 请推起"
            : "等待推起回位 · 完成后 +1";
    detail = state.faults.length
      ? FAULTS[state.faults[0]]?.text
      : state.pushupCheck.message;
  } else if (state.preparing) {
    title = "准备检查中 · 就位后自动计数";
    detail = state.trackingNotice || spec.hint;
  } else if (state.exercise === "plank") {
    title =
      angle !== undefined && angle >= 160
        ? "姿态有效 · 正在累计"
        : "调整姿态后累计";
    detail = "肩、髋、踝保持直线；有效角度 ≥ 160°";
  } else {
    title =
      state.phase === "IDLE"
        ? "准备下一次动作"
        : state.phase === "ASCENT"
          ? "等待回位 · 完成后 +1"
          : state.phase === "BOTTOM"
            ? "幅度已到位 · 请回位"
            : curling
              ? "正在弯曲"
              : "正在下放";
    detail =
      state.phase === "ASCENT" || state.phase === "BOTTOM"
        ? "回到起始位置，完成这一次"
        : "按自己的节奏完成完整动作";
    if (state.faults.length) detail = FAULTS[state.faults[0]]?.text || detail;
    else if (state.trackingNotice) detail = state.trackingNotice;
  }
  return {
    angle,
    title,
    detail,
    stages,
    stage,
    joint:
      state.exercise === "pushup"
        ? "参考肘角"
        : spec.signal === "knee"
          ? "膝关节"
          : spec.signal === "hip"
            ? "髋关节"
            : spec.signal === "body_line"
              ? "身体夹角"
              : "肘关节",
  };
}
