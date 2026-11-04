import test from "node:test";
import assert from "node:assert/strict";
import { coachTurn } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";
import { localVoiceCommand } from "../src/core/voice-routing";
import { guidancePreference } from "../src/core/interaction";
import { safetyResponse } from "../src/core/knowledge";

const tool = (name: string, args: unknown = {}) => ({
  type: "function_call",
  name,
  arguments: JSON.stringify(args),
  call_id: crypto.randomUUID(),
});
const reply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
function training() {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.preparing = false;
  for (let count = 1; count <= 6; count++)
    e.acceptRep({
      count,
      duration: 3,
      eccentric_s: 1.5,
      concentric_s: 1.5,
      min_angle: 80,
      full_depth: true,
      score: 95,
      faults: [],
    });
  e.counter.count = 6;
  return e;
}
test("complete stop synonyms remain usable with the model unavailable", async () => {
  for (const text of [
    "停",
    "停止",
    "停下来",
    "先停一下",
    "暂停一下",
    "请停下来",
  ]) {
    const e = training();
    await coachTurn(
      text,
      e.snapshot(),
      async (c) => e.dispatch(c),
      async () => {
        throw Error("offline");
      },
    );
    assert.equal(e.snapshot().status, "paused", text);
    assert.equal(e.snapshot().reps, 6, text);
  }
  for (const text of [
    "不做了",
    "不练了",
    "今天就到这里",
    "停止训练",
    "结束并保存",
  ]) {
    const e = training();
    await coachTurn(
      text,
      e.snapshot(),
      async (c) => e.dispatch(c),
      async () => {
        throw Error("offline");
      },
    );
    assert.equal(e.snapshot().status, "ready", text);
    assert.equal(e.pending[0].reps.length, 6);
  }
});
test("stop shortcuts do not swallow negations, targets, quotations or compound requests", () => {
  for (const text of [
    "别停",
    "不要停止训练",
    "不停止",
    "我不是要停止训练",
    "如果累了就停下来",
    "等一下再停止训练",
    "他说停下来",
    "停止是什么意思？",
    "不做深蹲了，换成俯卧撑",
    "停止跟随",
    "暂停，然后告诉我做了几次",
    "请暂停一下好吗？",
  ])
    assert.equal(localVoiceCommand(text), null, text);
});
test("speech requests and reminder levels never turn into disabling correction", () => {
  for (const text of ["停止说话", "别说了", "不要说了"])
    assert.deepEqual(localVoiceCommand(text), {
      type: "speech_control",
      action: "stop",
    });
  for (const text of ["请少说一点", "提醒少一点", "不要一直鼓励我"])
    assert.equal(guidancePreference(text), "quiet", text);
  for (const text of [
    "不要少说一点",
    "少说一点是什么意思",
    "少说一点然后结束训练",
  ])
    assert.equal(guidancePreference(text), undefined, text);
  for (const text of ["不要停止说话", "关闭纠错提示", "如果我累了就少说一点"])
    assert.equal(localVoiceCommand(text), null, text);
});
test("symptom protection distinguishes current complaints from negation, explanation and quotation", () => {
  for (const text of [
    "我没有受伤，可以继续训练吗？",
    "胸痛是什么意思？",
    "如果出现胸痛应该怎么办？",
    "我朋友说他呼吸困难",
    "如果受伤了还能继续练吗？",
    "没有胸痛",
    "我昨天胸痛，今天已经好了",
    "他说“胸痛”，不是我",
    "我没有出现胸痛",
    "我不觉得胸痛",
    "胸痛已经好了",
  ])
    assert.equal(safetyResponse(text), null, text);
  for (const text of [
    "我胸痛还想继续练",
    "胸痛",
    "我现在呼吸困难",
    "没有胸痛，但是呼吸困难",
    "我受伤了还想继续训练",
    "我现在胸痛怎么办",
    "如果出现胸痛要怎么办？我现在就胸痛",
  ])
    assert.ok(safetyResponse(text), text);
});
test("cancelled turns cannot execute a symptom shortcut", async () => {
  const e = training();
  await assert.rejects(
    coachTurn(
      "我胸痛",
      e.snapshot(),
      async () => {
        assert.fail("cancelled operation");
      },
      async () => ({}),
      [],
      () => true,
    ),
    /已取消/,
  );
  assert.equal(e.snapshot().status, "training");
});
test("true current-state answers survive the execution guard, in streaming and nonstreaming paths", async () => {
  for (const direct of [false, true]) {
    for (const text of [
      "你已完成6次，目标12次，还差6次。",
      "训练已经开始，目前完成6次。",
      "摄像头已开启。",
    ]) {
      const e = training();
      let n = 0;
      const spoken: string[] = [];
      const result = await coachTurn(
        "我现在的状态是什么？",
        { ...e.snapshot(), cameraView: { cameraOn: true } as any },
        async (c) => e.dispatch(c),
        async (_p, delta) => {
          if (!n++) return { output: [tool("no_action")] };
          if (!direct) delta?.(text);
          return reply(text);
        },
        [],
        () => false,
        { onSentence: (s) => spoken.push(s) },
      );
      assert.equal(result.text, text);
      assert.equal(spoken.join(""), text);
    }
  }
});
test("observed state cannot justify a fabricated operation or wrong completion count", async () => {
  for (const text of [
    "已切换到深蹲。",
    "已开始100秒休息。",
    "已完成15次。",
    "我已经帮你暂停训练。",
  ]) {
    const e = training();
    let n = 0;
    const spoken: string[] = [];
    const result = await coachTurn(
      "我现在的状态是什么？",
      e.snapshot(),
      async (c) => e.dispatch(c),
      async (_p, delta) => {
        if (!n++) return { output: [tool("no_action")] };
        delta?.(text);
        return reply(text);
      },
      [],
      () => false,
      { onSentence: (s) => spoken.push(s) },
    );
    assert.ok(!spoken.join("").includes(text), text);
    assert.notEqual(result.text, text);
    assert.equal(e.snapshot().status, "training");
  }
});
test("compound operation plus answer retains both the actual receipt and checked answer", async () => {
  const e = training();
  const outputs = [
    { output: [tool("session", { action: "pause" })] },
    reply("训练已暂停。本组深蹲已完成6次，目标12次。"),
  ];
  const result = await coachTurn(
    "帮我暂停训练，然后告诉我现在做了几次",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async () => outputs.shift(),
  );
  assert.equal(e.snapshot().status, "paused");
  assert.match(result.text, /训练已暂停/);
  assert.match(result.text, /6次/);
  assert.equal(result.text.match(/训练已暂停/g)?.length, 1);
});
test("compound query answers are not replaced by a generic historical summary", async () => {
  const e = training();
  const outputs = [
    {
      output: [
        tool("session", { action: "pause" }),
        tool("plate_calc", { target: 60 }),
      ],
    },
    reply("已暂停，20公斤杆，每侧一片20公斤，共60公斤。"),
  ];
  const result = await coachTurn(
    "暂停，然后告诉我60公斤怎么配片",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async () => outputs.shift(),
    [],
    () => false,
    {
      query: async () => ({ target: 60, bar: 20, eachSide: [20], actual: 60 }),
    },
  );
  assert.match(result.text, /训练已暂停/);
  assert.match(result.text, /每侧一片20公斤/);
});
test("a failed tool cannot claim success when its compound explanation is retained", async () => {
  const e = new SessionEngine();
  const outputs = [
    { output: [tool("rest_timer", { seconds: 60 })] },
    reply("已开始60秒休息。你可以先喝水。"),
  ];
  const result = await coachTurn(
    "休息60秒，然后给我个提醒",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async () => outputs.shift(),
  );
  assert.match(result.text, /请先开始训练/);
  assert.doesNotMatch(result.text, /已开始60秒休息/);
});
test("no_action after a compound operation ends decisions and keeps the answer", async () => {
  const e = training();
  const outputs = [
    { output: [tool("session", { action: "pause" })] },
    { output: [tool("no_action")] },
    reply("本组完成6次。"),
  ];
  const result = await coachTurn(
    "暂停并说一下进度",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async () => outputs.shift(),
  );
  assert.match(result.text, /训练已暂停/);
  assert.match(result.text, /6次/);
  assert.equal(outputs.length, 0);
});
test("cancel_rest acknowledges absence and preserves a separate paused state", () => {
  const e = training();
  assert.match(
    e.dispatch({ type: "session", action: "cancel_rest" }).message,
    /没有.*休息/,
  );
  e.dispatch({ type: "rest_timer", seconds: 60 });
  e.dispatch({ type: "session", action: "pause" });
  assert.match(
    e.dispatch({ type: "session", action: "cancel_rest" }).message,
    /暂停/,
  );
  assert.equal(e.snapshot().status, "paused");
  e.dispatch({ type: "session", action: "resume" });
  assert.equal(e.snapshot().status, "training");
});

test("cancelling after a completed tool prevents another model request", async () => {
  const e = training();
  let cancelled = false,
    requests = 0;
  await assert.rejects(
    coachTurn(
      "请暂停并说明进度",
      e.snapshot(),
      async (raw) => {
        const receipt = e.dispatch(raw);
        cancelled = true;
        return receipt;
      },
      async () => {
        requests++;
        return { output: [tool("session", { action: "pause" })] };
      },
      [],
      () => cancelled,
    ),
    /已取消/,
  );
  assert.equal(requests, 1);
  assert.equal(e.snapshot().status, "paused");
  assert.equal(e.snapshot().reps, 6);
});
