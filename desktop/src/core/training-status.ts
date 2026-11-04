import { EXERCISES } from "./engine";
import type { Snapshot } from "./session";

/** Used only to ground a failed answer; tool selection still goes through the model. */
export function isCurrentProgressQuestion(text: string) {
  if (
    /昨天|前天|上周|本周|这周|上月|本月|历史|累计|上[一]?组|上次|下[一]?组|建议|应该|计划/.test(
      text,
    )
  )
    return false;
  if (/今天|本次训练|这次训练/.test(text) && !/这组|本组|当前组/.test(text))
    return false;
  if (/切换|设置|改成|调到|开始|暂停|结束|停止|再来/.test(text)) return false;
  return (
    /多少|几次|几个|进度|次数|达标|够了吗|做完了吗|完成了吗/.test(text) &&
    /做|完成|当前|现在|目前|这组|本组|进度|次数|几次|几个/.test(text)
  );
}

export function trainingProgressSummary(state: Snapshot) {
  const hold = state.exercise === "plank";
  const count = hold ? Math.floor(state.hold) : state.reps;
  const target = hold ? state.holdGoal : state.goal;
  const unit = hold ? "秒" : "次";
  const label = EXERCISES[state.exercise].label;
  if (state.status === "ready" && !count)
    return `当前还没有开始${label}计数，目标${target}${unit}。`;
  const set = state.status === "ready" ? "上一组" : "本组";
  return `${set}${label}已计入${count}${unit}，目标${target}${unit}。${count >= target ? "本组目标已达到。" : state.preparing ? "正在确认站位，已计入的进度保留。" : `还差${target - count}${unit}。`}`;
}
