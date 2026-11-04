import type { Receipt, Snapshot } from "./session";
import { isCurrentProgressQuestion } from "./training-status";

export interface ServiceMetric {
  kind: string;
  ms: number;
  firstMs?: number;
  outcome: "ok" | "error" | "cancelled";
}
export function metricSummary(rows: ServiceMetric[]) {
  const percentile = (xs: number[], p: number) =>
    xs.length
      ? [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1]
      : null;
  return ["asr", "llm", "tts"].map((kind) => {
    const rs = rows.filter((r) => r.kind === kind),
      ok = rs.filter((r) => r.outcome === "ok");
    return {
      kind,
      requests: rs.length,
      errors: rs.filter((r) => r.outcome === "error").length,
      cancelled: rs.filter((r) => r.outcome === "cancelled").length,
      totalP50Ms: percentile(
        ok.map((r) => r.ms),
        0.5,
      ),
      totalP95Ms: percentile(
        ok.map((r) => r.ms),
        0.95,
      ),
      firstP50Ms: percentile(
        ok.map((r) => r.firstMs!).filter(Number.isFinite),
        0.5,
      ),
      firstP95Ms: percentile(
        ok.map((r) => r.firstMs!).filter(Number.isFinite),
        0.95,
      ),
    };
  });
}
export const falseExecution =
  /(已(?:经)?(?:帮你|为你|给你)?(?:把[^，,。！？\n]{1,16})?(?:切换|设置|设为|改成|开始|启动|停止|暂停|继续|关闭|开启|清零|调整|完成|记住|保存|遗忘)|(?:切换|设置|调整|开始).{0,12}(?:好了|完成|成功))/;
export interface ReplyGrounding {
  state: Snapshot;
  receipts?: Receipt[];
  queries?: { name: string; data: any }[];
  question?: string;
}
const normalizeClaim = (s: string) => s.replace(/[\s，,。！？!?；;]/g, "");

/** A state observation is not a claim that the assistant performed an action. */
function supportedObservation(clause: string, g?: ReplyGrounding) {
  if (!g) return false;
  const s = g.state;
  if (
    g.receipts?.some(
      (r) => r.ok && normalizeClaim(r.message).includes(normalizeClaim(clause)),
    )
  )
    return true;
  if (/(?:我|教练)(?:已|刚|帮|为|给|替)/.test(clause)) return false;
  if (/动作参考|参考动作|参考视频|动作示范|示范视频/.test(clause)) {
    const size =
      /已(?:经)?(?:设为|设置为|调整为).*(标准|放大|小号|中号|大号)/.exec(
        clause,
      );
    if (size)
      return (
        s.exerciseReference?.size ===
        (
          {
            标准: "medium",
            放大: "large",
            小号: "small",
            中号: "medium",
            大号: "large",
          } as const
        )[size[1] as "标准" | "放大" | "小号" | "中号" | "大号"]
      );
  }
  const completed =
    /已(?:经)?完成(?:了)?\s*(\d+(?:\.\d+)?)\s*(次|个|秒|组)/.exec(clause);
  if (completed) {
    const value = Number(completed[1]),
      unit = completed[2];
    const historical =
      /今天|昨天|前天|上次|此前|之前|最近|本周|上周|这周|历史|累计|本月|上月|本次训练|这次训练|上[一]?组/;
    if (
      historical.test(clause) ||
      (!/当前|现在|目前|这组|本组/.test(clause) &&
        !isCurrentProgressQuestion(g.question ?? "") &&
        historical.test(g.question ?? ""))
    ) {
      return !!g.queries?.some(
        (q) =>
          q.name === "history_query" &&
          (/上[一]?组|最近一组/.test(clause + (g.question ?? ""))
            ? ["次", "个"].includes(unit) &&
              q.data?.recent?.at(-1)?.summary?.reps === value
            : (unit === "组" && q.data?.overview?.sets === value) ||
              (["次", "个"].includes(unit) &&
                q.data?.overview?.reps === value)),
      );
    }
    return unit === "秒"
      ? s.exercise === "plank" && value === Math.floor(s.hold)
      : ["次", "个"].includes(unit) && value === s.reps;
  }
  if (/已(?:经)?完成/.test(clause))
    return (
      /目标/.test(clause) &&
      (s.exercise === "plank" ? s.hold >= s.holdGoal : s.reps >= s.goal)
    );
  const enabled = /已(?:经)?(?:开启|开始)/.test(clause);
  const disabled = /已(?:经)?(?:关闭|停止)/.test(clause);
  if (enabled || disabled) {
    const want = enabled;
    if (/动作要点|参考字幕|参考视频.{0,2}字幕/.test(clause)) return false;
    if (/动作参考|参考动作|参考视频|动作示范|示范视频/.test(clause))
      return s.exerciseReference?.enabled === want;
    if (/背景虚化/.test(clause))
      return (
        s.backgroundBlur?.enabled === want &&
        (!want || !s.backgroundBlur.notice)
      );
    if (/摄像头/.test(clause)) return s.cameraView?.cameraOn === want;
    if (/纠错/.test(clause)) return s.cues === want;
    if (/语音播报|教练声音/.test(clause)) return s.voice?.enabled === want;
    if (/休息|倒计时/.test(clause)) {
      const seconds = /(\d+(?:\.\d+)?)\s*秒/.exec(clause);
      return (
        want &&
        s.status === "resting" &&
        (!seconds || Math.abs(Number(seconds[1]) - s.remaining) <= 1)
      );
    }
    if (/计划/.test(clause)) return want && !!s.program;
    if (/已(?:经)?开始/.test(clause))
      return (
        s.status === "training" &&
        (!s.preparing || !/计数|计次/.test(clause)) &&
        !/新一组|下一组|播放|录音|录制/.test(clause) &&
        (/训练|计数|计次|这组|本组/.test(clause) ||
          /^已(?:经)?开始了?$/.test(clause.trim()))
      );
  }
  if (/已(?:经)?暂停/.test(clause))
    return s.status === "paused" && !/摄像头|语音|跟随/.test(clause);
  if (/已(?:经)?继续/.test(clause))
    return s.status === "training" && !/休息|摄像头|语音/.test(clause);
  return false;
}
export function replyChecks(
  reply: string,
  evidence: string,
  grounding?: ReplyGrounding,
) {
  const flags: string[] = [];
  if (!reply.trim()) flags.push("empty_reply");
  if (reply.length > 220) flags.push("too_long");
  if (/(?:<tool_call>|function_call|ACTION\s*\{|\[APP)/i.test(reply))
    flags.push("protocol_leak");
  if (
    reply
      .split(/[，,。！？!?\n；;]/)
      .some(
        (clause) =>
          falseExecution.test(clause) &&
          !supportedObservation(clause, grounding),
      )
  )
    flags.push("unconfirmed_execution");
  const known = new Set(
    (evidence.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))),
  );
  // Check factual reports, not numeric suggestions. This is a heuristic, not a proof.
  if (
    /上次|此前|之前|最近|本周|上周|历史|累计|平均|纪录|得分|评分|下降|提升/.test(
      reply,
    ) &&
    (reply.match(/\d+(?:\.\d+)?/g) ?? []).some(
      (n) => !known.has(String(Number(n))),
    )
  )
    flags.push("ungrounded_numbers");
  return flags;
}

/** Keep receipts authoritative while retaining independent answers to compound requests. */
export function mergeCheckedReply(
  raw: string,
  evidence: string,
  grounding: ReplyGrounding,
  diagnose?: (flags: string[]) => void,
) {
  const receipts = grounding.receipts ?? [];
  const prefix = [...new Set(receipts.map((r) => r.message))].join(" ");
  const clauses = raw.match(/[^，,。！？!?\n；;]+[，,。！？!?\n；;]*/g) ?? [];
  let answer = "";
  for (const clause of clauses) {
    const normalized = normalizeClaim(clause);
    if (
      !normalized ||
      (normalized.length >= 3 && normalizeClaim(prefix).includes(normalized))
    )
      continue;
    const flags = replyChecks(clause, evidence, grounding);
    if (flags.length) diagnose?.(flags);
    if (
      flags.some((f) =>
        [
          "protocol_leak",
          "unconfirmed_execution",
          "ungrounded_numbers",
        ].includes(f),
      )
    )
      continue;
    if (answer.length + clause.length <= 220) answer += clause;
  }
  answer = answer.trim().replace(/^[，,。；;\s]+/, "");
  return [prefix, answer].filter(Boolean).join(" ");
}
export function takeSentences(buffer: string, flush = false) {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i],
      fragment = buffer.slice(start, i + 1);
    const listNumber = /^\s*\d+\.$/.test(fragment);
    if (
      /[。！？!?\n]/.test(c) ||
      (/[，；;]/.test(c) && fragment.length >= 24) ||
      (c === "." &&
        !listNumber &&
        i + 1 < buffer.length &&
        !/\d/.test(buffer[i + 1]))
    ) {
      // Keep source whitespace: speech and Markdown need different representations.
      sentences.push(fragment);
      start = i + 1;
    }
  }
  const rest = buffer.slice(start);
  if (flush && rest) sentences.push(rest);
  return { sentences, rest: flush ? "" : rest };
}
