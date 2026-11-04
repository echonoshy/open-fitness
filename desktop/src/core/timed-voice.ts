import { localVoiceCommand } from "./voice-routing";
import type { TimedSnapshot } from "./timed-training";
import { statisticLabel } from "./movement-statistics";

const numeral = (value: string) => {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value.includes("十")) {
    const [a, b] = value.split("十");
    return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0);
  }
  return digits[value] ?? NaN;
};

export function timedVoiceIntent(text: string) {
  const t = text.trim().replace(/[。！!？?\s]+$/g, "");
  const count =
    /^(?:这组|这一组|本组|我)?(?:做了|完成了|记为|记录为)([\d零一二两三四五六七八九十]+)(?:次|个)$/.exec(
      t,
    );
  if (count) return { kind: "count" as const, value: numeral(count[1]) };
  if (/^(?:暂停训练|暂停计时)$/.test(t))
    return {
      kind: "command" as const,
      command: { type: "session" as const, action: "pause" as const },
    };
  if (/^(?:开始训练|开始计时|开始)$/.test(t))
    return {
      kind: "command" as const,
      command: { type: "session" as const, action: "start" as const },
    };
  if (/^(?:继续训练|继续计时|继续)$/.test(t))
    return {
      kind: "command" as const,
      command: { type: "session" as const, action: "resume" as const },
    };
  if (/^(?:结束训练|结束并保存|结束计时)$/.test(t))
    return {
      kind: "command" as const,
      command: { type: "session" as const, action: "end" as const },
    };
  if (/^(?:再来一组|下一组)$/.test(t))
    return { kind: "command" as const, command: { type: "new_set" as const } };
  const local = localVoiceCommand(text);
  if (local) return { kind: "command" as const, command: local };
  if (
    /^(?:(?:我|这组|本组|现在|当前)(?:已经)?(?:练了多久|做了多久|做了多少(?:次)?|计时多久|什么进度)|还有多久|现在是什么动作|当前动作是什么)$/.test(
      t,
    )
  )
    return { kind: "status" as const };
  if (
    /^(?:讲一下|介绍一下|讲讲|怎么做|动作要领|动作要点)/.test(t) ||
    /(?:怎么做|动作要点|动作要领)$/.test(t)
  )
    return { kind: "introduction" as const };
  return { kind: "advice" as const };
}

export function timedStatusText(state: TimedSnapshot) {
  const status = {
    ready: "尚未开始",
    training: "训练中",
    paused: "已暂停",
    resting: "正在休息",
  }[state.status];
  const auto =
    state.statistics.mode === "reps"
      ? `自动估算 ${state.statistics.reps} 次。`
      : state.cameraStatistics
        ? `${statisticLabel(state.statistics.mode)} ${Math.floor(state.statistics.seconds)} 秒。`
        : "当前仅记录训练时长。";
  return `${state.movement.name}${status}，本组训练时长 ${Math.floor(state.elapsed)} 秒。${auto}${state.manualReps === undefined ? "" : `你填写的次数为 ${state.manualReps} 次，已保留自动估算结果供对照。`}`;
}
