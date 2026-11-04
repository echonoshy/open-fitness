import type { Movement } from "../../core/movement-library";

export type PracticeCommand =
  | { kind: "pause" | "resume" | "picker" | "next" | "cancel" | "unknown" }
  | { kind: "movement"; item: Movement }
  | { kind: "search"; query: string; matches: Movement[] };

const normalize = (value: string) =>
  value.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”"'‘’]/g, "");
const aliases: Record<string, string> = {
  深蹲: "bodyweight-squat",
  徒手深蹲: "bodyweight-squat",
  俯卧撑: "push-up",
  平板支撑: "front-plank",
  弓步蹲: "forward-lunge",
};

/** Deliberately bounded: unrelated speech and negation must never operate playback. */
export function resolvePracticeCommand(
  transcript: string,
  items: Movement[],
  pickerItems?: Movement[],
): PracticeCommand {
  const text = normalize(transcript).replace(/^(?:请帮我|帮我|请)/, "");
  if (/^(?:暂停|暂停一下|暂停跟练|暂停播放|先暂停|停一下|先停一下)$/.test(text))
    return { kind: "pause" };
  if (/^(?:继续|继续吧|继续练|继续跟练|继续播放|恢复播放|恢复跟练)$/.test(text))
    return { kind: "resume" };
  if (/^(?:切换动作|换个动作|换一个动作|打开动作列表|选择动作)$/.test(text))
    return { kind: "picker" };
  if (
    /^(?:下一个|下一个动作|换下一个|换下一个动作|切换到下一个动作)$/.test(text)
  )
    return { kind: "next" };
  if (pickerItems && /^(?:取消|返回|返回当前动作|取消切换|不换了)$/.test(text))
    return { kind: "cancel" };
  if (pickerItems) {
    const ordinal = text.match(
      /^(?:选|选择)?第([一二三四五六七八九十]|\d{1,2})个(?:动作)?$/,
    );
    if (ordinal) {
      const n =
        Number(ordinal[1]) || "一二三四五六七八九十".indexOf(ordinal[1]) + 1;
      return pickerItems[n - 1]
        ? { kind: "movement", item: pickerItems[n - 1] }
        : { kind: "unknown" };
    }
  }
  const named = text.match(/^(?:切换到|切换成|换成|换到|我想练|开始练)(.+)$/);
  const query = (named?.[1] ?? (pickerItems ? text : "")).replace(
    /(?:这个动作|这个|吧)$/,
    "",
  );
  if (!query || /[不别没吗么]|不要|什么|如何|怎么/.test(query))
    return { kind: "unknown" };
  const exact = items.filter(
    (item) =>
      normalize(item.name) === query || normalize(item.originalName) === query,
  );
  if (exact.length === 1) return { kind: "movement", item: exact[0] };
  const alias = items.find((item) => item.slug === aliases[query]);
  if (!exact.length && alias) return { kind: "movement", item: alias };
  const matches = exact.length
    ? exact
    : items.filter(
        (item) =>
          normalize(item.name).includes(query) ||
          normalize(item.originalName).includes(query),
      );
  if (matches.length === 1) return { kind: "movement", item: matches[0] };
  return named || matches.length
    ? { kind: "search", query, matches }
    : { kind: "unknown" };
}
