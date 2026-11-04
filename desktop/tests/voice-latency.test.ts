import test from "node:test";
import assert from "node:assert/strict";
import { coachTurn } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";
import {
  localVoiceCommand,
  isGeneralAdvice,
  speechText,
} from "../src/core/voice-routing";
import { ReplySpeechQueue } from "../src/media/speech-queue";
const reply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});

test("exact local commands use real receipts and make no model request", async () => {
  const e = new SessionEngine();
  const request = async () => {
    throw Error("must not request model");
  };
  const denied = await coachTurn(
    "开始训练",
    e.snapshot(),
    async (c) => e.dispatch(c),
    request,
  );
  assert.equal(denied.receipts[0].ok, false);
  assert.match(denied.text, /摄像头/);
  e.cameraReady = true;
  const started = await coachTurn(
    "开始训练",
    e.snapshot(),
    async (c) => e.dispatch(c),
    request,
  );
  assert.equal(started.receipts[0].ok, true);
  assert.equal(e.active, true);
});
test("questions, negations, conditions and compound requests cannot trigger shortcut", () => {
  for (const text of [
    "不要开始训练",
    "开始训练了吗？",
    "等一下再开始训练",
    "开始训练并设十次",
    "如果准备好了就开始训练",
    "他说开始训练",
    "换成深蹲还是硬拉？",
  ])
    assert.equal(localVoiceCommand(text), null, text);
  assert.equal(isGeneralAdvice("饮食怎么安排，然后开始训练"), false);
  assert.equal(isGeneralAdvice("上周减脂训练记录怎么样"), false);
  assert.equal(isGeneralAdvice("深蹲如何呼吸"), false);
  assert.equal(isGeneralAdvice("减脂期饮食有什么建议？"), true);
});
test("streamed Markdown preserves list and paragraph boundaries, speech is plain", async () => {
  const text =
    "**饮食建议**\n\n1. **蛋白质**：均衡摄入。\n2. 多吃蔬菜，保持多样。";
  const e = new SessionEngine();
  let calls = 0;
  const spoken: string[] = [];
  const result = await coachTurn(
    "饮食有什么建议",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async (p: any, delta) => {
      calls++;
      assert.equal(p.tool_choice, "none");
      for (const c of text) delta?.(c);
      return reply(text);
    },
    [],
    () => false,
    { onSentence: (s) => spoken.push(speechText(s)) },
  );
  assert.equal(calls, 1);
  assert.equal(result.text, text);
  assert.doesNotMatch(spoken.join(""), /\*/);
  assert.match(spoken.join(""), /蛋白质/);
});
test("next sentence synthesis starts before earlier audio playback finishes", async () => {
  const synthesized: string[] = [],
    chunks: number[] = [];
  let finishPlayback!: () => void;
  const played = new Promise<void>((resolve) => {
    finishPlayback = resolve;
  });
  const q = new ReplySpeechQueue(
    async (text, _signal, push) => {
      synthesized.push(text);
      push(new Uint8Array([synthesized.length, 0]), 16000);
    },
    async (source) => {
      await source(new AbortController().signal, (bytes) =>
        chunks.push(bytes[0]),
      );
      await played;
    },
  );
  q.enqueue("第一句");
  q.enqueue("第二句");
  const done = q.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(synthesized, ["第一句", "第二句"]);
  assert.deepEqual(chunks, [1, 2]);
  finishPlayback();
  await done;
});
test("cancelling a queue waiting for another sentence aborts without late synthesis", async () => {
  const c = new AbortController();
  let calls = 0;
  const q = new ReplySpeechQueue(
    async (_text, _signal, push) => {
      calls++;
      push(new Uint8Array([1, 0]), 16000);
    },
    (source) => source(c.signal, () => {}),
  );
  q.enqueue("第一句");
  await new Promise((resolve) => setImmediate(resolve));
  c.abort();
  await assert.rejects(q.finish(), { name: "AbortError" });
  q.enqueue("过期句子");
  assert.equal(calls, 1);
});
