import type { CameraCommand } from "./camera-framing";
import { EXERCISES, type Exercise } from "./engine";
import type { Command } from "./session";
import { guidancePreference } from "./interaction";
import { localSpeechCommand, type VoiceCommand } from "./voice-controls";

/** A whole negative reference command preserves the saved setting, even when it is already hidden. */
export function isReferenceDisplayNegation(text: string) {
  const match = /^(?:请)?(?:先别|不要|别)(.+)$/.exec(text.trim());
  if (!match) return false;
  const command = localVoiceCommand(match[1]);
  return (
    command?.type === "exercise_reference" ||
    command?.type === "exercise_reference_size"
  );
}

// Only complete, unambiguous commands bypass the model. Questions, negations,
// conditions and compound requests must not be matched by a substring.
export function localVoiceCommand(
  text: string,
): Command | CameraCommand | VoiceCommand | null {
  const t = text
    .trim()
    .replace(/[。！!，,\s]+$/g, "")
    .replace(/^(?:我想要|我想|我要)/, "")
    .replace(/^(?:麻烦帮我|请帮我|麻烦|帮我|请)/, "");
  const guidance = guidancePreference(text);
  if (guidance) return { type: "set_guidance", level: guidance };
  const speech = localSpeechCommand(t);
  if (speech) return speech;
  const reference =
    "(?:动作参考(?:视频|窗口)?|参考动作(?:视频)?|参考视频|动作示范(?:视频)?|示范视频)";
  const size = new RegExp(
    `^(?:把|将)?${reference}(?:设为|设置为|调成|调整为|改成|调到|用)(标准|放大|小|中|大)(?:号|尺寸|档)?$`,
  ).exec(t);
  if (size)
    return {
      type: "exercise_reference_size",
      size: (
        {
          标准: "medium",
          放大: "large",
          小: "medium",
          中: "medium",
          大: "large",
        } as const
      )[size[1] as "标准" | "放大" | "小" | "中" | "大"],
    };
  if (
    new RegExp(
      `^(?:(?:把)?${reference}(?:恢复|重置)(?:为)?(?:默认|中等)(?:大小|尺寸)|恢复${reference}(?:的)?默认(?:大小|尺寸))$`,
    ).test(t)
  )
    return { type: "exercise_reference_size", size: "medium" };
  if (
    new RegExp(
      `^(?:(?:把|让)?${reference}(?:再)?(?:放大|调大|变大|大)(?:一点|一些|一档|一下)?|(?:放大|调大)${reference}(?:一点|一些|一档|一下)?)$`,
    ).test(t)
  )
    return { type: "exercise_reference_size", size: "larger" };
  if (
    new RegExp(
      `^(?:(?:把|让)?${reference}(?:再)?(?:缩小|调小|变小|小)(?:一点|一些|一档|一下)?|(?:缩小|调小)${reference}(?:一点|一些|一档|一下)?)$`,
    ).test(t)
  )
    return { type: "exercise_reference_size", size: "smaller" };
  if (
    new RegExp(
      `^(?:(?:打开|开启|显示|恢复)${reference}|(?:把)?${reference}(?:打开|开启|显示))(?:一下)?$`,
    ).test(t)
  )
    return { type: "exercise_reference", enabled: true };
  if (
    new RegExp(
      `^(?:(?:关闭|关掉|隐藏|收起)${reference}|(?:把)?${reference}(?:关闭|关掉|隐藏|收起))(?:一下)?$`,
    ).test(t)
  )
    return { type: "exercise_reference", enabled: false };
  if (
    /^(?:(?:打开|开启|启用)背景虚化|(?:把)?背景(?:虚化|模糊)(?:一下)?|(?:把)?背景虚化(?:打开|开启))$/.test(
      t,
    )
  )
    return { type: "background_blur", enabled: true };
  if (
    /^(?:(?:关闭|关掉|取消)背景虚化|(?:把)?背景虚化(?:关闭|关掉)|恢复(?:清晰背景|背景清晰)|(?:把)?背景恢复清晰)$/.test(
      t,
    )
  )
    return { type: "background_blur", enabled: false };
  if (
    /^(?:先)?(?:停|停止|停下|停下来|暂停)(?:一下|一停|一会儿?)?(?:吧)?$/.test(t)
  )
    return { type: "session", action: "pause" };
  if (/^(?:不做了|不练了|今天就?到这里|今天到此为止|结束本次训练)$/.test(t))
    return { type: "session", action: "end" };
  if (["打开摄像头", "开启摄像头"].includes(t))
    return { type: "camera", enabled: true };
  if (["关闭摄像头", "关掉摄像头"].includes(t))
    return { type: "camera", enabled: false };
  const number = (s: string) => {
    const parts = s.replace(/点/g, ".").split(".");
    const digits: Record<string, string> = {
      零: "0",
      〇: "0",
      一: "1",
      二: "2",
      两: "2",
      三: "3",
      四: "4",
      五: "5",
      六: "6",
      七: "7",
      八: "8",
      九: "9",
    };
    return Number(
      parts
        .map((part) => [...part].map((d) => digits[d] ?? d).join(""))
        .join("."),
    );
  };
  const absolute =
    /^(?:(?:把|让)?(?:画面|镜头|我))?(?:放大|缩小|拉近|拉远|调|调整)(?:到|至)([\d一二两三四五六七八九零〇点.]+)倍$/.exec(
      t,
    );
  if (absolute && number(absolute[1]) > 0)
    return {
      type: "camera_view",
      action: "zoom_to",
      zoom: number(absolute[1]),
    };
  const relative =
    /^(?:(?:把|让)?(?:画面|镜头|我))?(?:再)?放大([\d一二两三四五六七八九零〇点.]+)倍$/.exec(
      t,
    );
  if (relative && number(relative[1]) > 0)
    return {
      type: "camera_view",
      action: "zoom_by",
      factor: 1 + number(relative[1]),
    };
  if (
    /^(?:太大了[，,]?\s*)?(?:回到刚才|恢复刚才的画面|撤销(?:刚才|上一次|上次)的?(?:取景|画面|放大|缩小)?(?:调整)?)$/.test(
      t,
    )
  )
    return { type: "camera_view", action: "undo" };
  const fine =
    /^(?:(?:把|让)?(?:画面|镜头|我))?(?:稍微|微微)(?:再)?(放大|缩小|拉近|拉远|大|小)(?:画面|镜头)?(?:一点|一些|一下)?$/.exec(
      t,
    );
  if (fine)
    return {
      type: "camera_view",
      action: ["放大", "拉近", "大"].includes(fine[1]) ? "zoom_in" : "zoom_out",
      adjustment: "fine",
    };
  if (
    [
      "放大",
      "放大一点",
      "把我放大",
      "把我放大一点",
      "让我大一点",
      "再大一点",
      "再放大",
      "再放大一点",
      "还是太小了",
      "太小了",
      "拉近一些",
      "放大一些",
    ].includes(t)
  )
    return { type: "camera_view", action: "zoom_in" };
  if (
    [
      "缩小",
      "缩小一点",
      "把我缩小",
      "再小一点",
      "再缩小",
      "再缩小一点",
      "还是太大了",
      "太大了",
      "拉远一些",
      "缩小一些",
    ].includes(t)
  )
    return { type: "camera_view", action: "zoom_out" };
  const views = {
    跟着我: "auto",
    开启跟随: "auto",
    恢复自动取景: "auto",
    自动取景: "auto",
    固定画面: "lock",
    固定当前画面: "lock",
    别跟着我: "lock",
    关闭跟随: "lock",
    不要跟随: "lock",
    恢复全身: "full",
    看全身: "full",
    恢复完整画面: "full",
    拉近一点: "zoom_in",
    放大一点: "zoom_in",
    拉远一点: "zoom_out",
    缩小一点: "zoom_out",
    画面往左一点: "left",
    画面往右一点: "right",
  } as const;
  if (t in views)
    return { type: "camera_view", action: views[t as keyof typeof views] };
  // Match complete affirmative requests only. Questions/negations/compound
  // requests still go through the model and its state-aware tool decision.
  const pan =
    /^(?:把|让)?(?:画面|镜头)(?:向|往|朝)(左|右)(?:移|移动|挪)?(?:一点|一些|一下)?$/.exec(
      t,
    );
  if (pan)
    return { type: "camera_view", action: pan[1] === "左" ? "left" : "right" };
  const zoom =
    /^(?:(?:把|让)?(?:画面|镜头)(放大|缩小|拉近|拉远)|(放大|缩小|拉近|拉远)(?:画面|镜头))(?:一点|一些|一下)?$/.exec(
      t,
    );
  if (zoom)
    return {
      type: "camera_view",
      action: ["放大", "拉近"].includes(zoom[1] || zoom[2])
        ? "zoom_in"
        : "zoom_out",
    };
  const subjectPan =
    /^(?:把|让)?画面(?:里|中)(?:的)?(?:我|人|人物|人像)(?:向|往|朝)(左|右)(?:移|移动|挪)?(?:一点|一些|一下)?$/.exec(
      t,
    );
  if (subjectPan)
    return {
      type: "camera_view",
      action: subjectPan[1] === "左" ? "right" : "left",
    };
  const newSet =
    /^(?:再来|再做|开始|重新开始|重新定|重新设置|重新设)(?:新)?一组(?:目标)?(?:[，,]?(?:目标(?:设为|是)?|做|设为)?([\d零〇一二两三四五六七八九十百]+)(次|秒))?$/.exec(
      t,
    );
  if (newSet && (!t.endsWith("目标") || newSet[1])) {
    const target = newSet[1] ? spokenNumber(newSet[1]) : undefined;
    if (!newSet[1] || (target !== undefined && target >= 1 && target <= 600))
      return {
        type: "new_set",
        ...(target === undefined
          ? {}
          : { target, unit: newSet[2] === "秒" ? "seconds" : "reps" }),
      };
  }
  const actions = {
    开始训练: "start",
    开始这组: "start",
    暂停训练: "pause",
    暂停: "pause",
    继续训练: "resume",
    继续: "resume",
    恢复训练: "resume",
    结束训练: "end",
    结束并保存: "end",
    停止训练: "end",
    结束休息: "cancel_rest",
  } as const;
  if (t in actions)
    return { type: "session", action: actions[t as keyof typeof actions] };
  if (t === "开始休息" || t === "休息一下")
    return { type: "rest_timer", seconds: 60 };
  for (const [exercise, spec] of Object.entries(EXERCISES)) {
    if (
      [`切换到${spec.label}`, `换成${spec.label}`, `换${spec.label}`].includes(
        t,
      )
    )
      return { type: "set_exercise", exercise: exercise as Exercise };
  }
  const goal =
    /^(?:这组(?:目标)?(?:改成|改为|设为|做)|本组目标(?:改成|改为|设为)|目标设为|设置目标|改成|改为)([\d零〇一二两三四五六七八九十百]+)次$/.exec(
      t,
    );
  const count = goal && spokenNumber(goal[1]);
  if (count && count >= 1 && count <= 100)
    return { type: "set_rep_goal", reps: count };
  return null;
}

function spokenNumber(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number(text);
  const digit: Record<string, number> = {
    零: 0,
    〇: 0,
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
  if (text in digit) return digit[text];
  if (text === "一百") return 100;
  const tens = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(
    text,
  );
  if (tens)
    return (tens[1] ? digit[tens[1]] : 1) * 10 + (tens[2] ? digit[tens[2]] : 0);
}

export function commandClarification(text: string, hold = false) {
  const clean = text
    .trim()
    .replace(/[。！!，,\s]+$/g, "")
    .replace(/^(?:请帮我|帮我|请)/, "");
  if (/^重新(?:定|设|设置)(?:新)?一组目标$/.test(clean))
    return `新一组目标设为多少${hold ? "秒" : "次"}？确认后会保留上一组记录，再从零开始。`;
  if (/^(?:把|让)?(?:画面|镜头)(?:左右移动|移动一下)$/.test(clean))
    return "你想往左看还是往右看？也可以说“让画面里的人往左移”。";
}

export function commandFallback(text: string) {
  if (
    /动作参考|参考动作|参考视频|动作示范|示范视频|动作要点|参考字幕/.test(text)
  )
    return "动作参考设置还没有更改。可以明确说打开、关闭、放大参考视频，或缩小参考视频。";
  if (/背景|虚化/.test(text))
    return "背景虚化设置还没有更改。可以说“打开背景虚化”或“关闭背景虚化”。";
  if (/画面|镜头|取景|放大|缩小|拉近|拉远/.test(text))
    return "画面还没有调整。请告诉我往左、往右、放大还是缩小；也可以说“恢复全身”。";
  if (/一组|目标/.test(text))
    return "目标还没有更改。你是要修改本组目标，还是另开一组？例如“这组改成15次”或“再来一组12次”。";
  return "这次没有执行任何操作。请具体说明想调整什么，也可以询问当前训练状态。";
}

export function isGeneralAdvice(text: string) {
  return (
    /呼吸|饮食|减脂|增肌|蛋白|营养|热身|拉伸|恢复|睡眠|喝水/.test(text) &&
    /怎么|如何|为什么|什么|多少|建议|解释|介绍|[?？]/.test(text) &&
    !/动作参考|参考动作|参考视频|动作示范|示范视频|动作要点|参考字幕|背景|虚化|切换|换成|设置|设为|改成|改为|开始|暂停|继续|结束|停止|开启|关闭|清零|记住|忘记|记录|历史|上次|上周|本周|最近|我的|查|配片|计划/.test(
      text,
    ) &&
    !Object.values(EXERCISES).some((spec) => text.includes(spec.label))
  );
}

export function speechText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}
