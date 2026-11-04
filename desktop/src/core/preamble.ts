import { falseExecution } from "./diagnostics";

// Intention is not evidence of a successful query or command.
export function safePreamble(raw: string) {
  const text = raw.trim();
  if (
    !text ||
    text.length > 42 ||
    /[\n{}<>]|function_call|tool_call/i.test(text)
  )
    return "";
  // A requested scope ("最近三次的记录") is not a reported result.
  const claims = text.replace(
    /(?:最近|过去|前|近)[0-9一二三四五六七八九十两]+(?:次|组|天|周|月)(?:的)?/g,
    "",
  );
  if (
    falseExecution.test(text) ||
    /已经|查到|找到|完成了|成功|好了|数据显示|记录显示|你(?:做了|练了|完成)|[0-9一二三四五六七八九十两]+\s*(?:次|组|秒|公斤|分)/.test(
      claims,
    )
  )
    return "";
  if (
    !/^(?:(?:嗯|好|好的|稍等|等一下)[，,、\s]*)?(?:我(?:先|来|会|帮你|给你|需要)?|先?让我).{0,12}(?:查|看|核对|确认|整理|了解|算|想|理|对照|比较|设置|调整|切换)/.test(
      text,
    )
  )
    return "";
  return text;
}
export class PreambleStream {
  private buffer = "";
  private sent = false;
  constructor(
    private emit: (text: string) => void,
    private cancelled: () => boolean,
  ) {}
  consume(delta: string, flush = false) {
    if (this.sent || this.cancelled()) return;
    this.buffer += delta;
    // A short intention ending in a comma is already speakable. Do not wait
    // for the rest of the model/tool response as the answer sentence splitter does.
    const sentences: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      if (/[。！？!?，,；;\n]/.test(this.buffer[i])) {
        sentences.push(this.buffer.slice(start, i + 1));
        start = i + 1;
      }
    }
    if (flush) sentences.push(this.buffer.slice(start));
    this.buffer = flush ? "" : this.buffer.slice(start).slice(0, 200);
    for (const sentence of sentences) {
      const text = safePreamble(sentence);
      if (text && !this.sent) {
        this.sent = true;
        this.emit(text.replace(/[，,；;]$/, "。"));
      }
    }
  }
}
