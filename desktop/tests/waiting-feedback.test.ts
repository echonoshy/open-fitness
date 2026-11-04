import test from "node:test";
import assert from "node:assert/strict";
import { WaitingFeedbackPhrases } from "../src/core/waiting-feedback";
import { PreambleStream, safePreamble } from "../src/core/preamble";

test("short conversational intentions pass without admitting results or action claims", () => {
  for (const text of [
    "我查一下。",
    "稍等，我看看。",
    "我想一下。",
    "让我想想。",
    "我算一下怎么配片。",
    "我先查一下最近三次的训练记录。",
  ])
    assert.ok(safePreamble(text), text);
  for (const text of [
    "我查到你完成了十次。",
    "我看看，你上周做了40次。",
    "我已经调整好了。",
    "我来设置，成功了。",
    "我想一下，你的得分是80分。",
    "我来查一下<tool_call>。",
    "我看看\n训练已暂停。",
  ])
    assert.equal(safePreamble(text), "", text);
});

test("comma-delimited intention arrives before the model finishes and cannot leak later results", () => {
  const spoken: string[] = [];
  let cancelled = false;
  const stream = new PreambleStream(
    (text) => spoken.push(text),
    () => cancelled,
  );
  stream.consume("嗯，");
  stream.consume("我查一");
  assert.equal(spoken.length, 0);
  stream.consume("下，");
  assert.deepEqual(spoken, ["我查一下。"]);
  stream.consume("你上周做了40次。", true);
  assert.deepEqual(spoken, ["我查一下。"]);
  const interrupted = new PreambleStream(
    (text) => spoken.push(text),
    () => cancelled,
  );
  interrupted.consume("我想");
  cancelled = true;
  interrupted.consume("一下，", true);
  assert.equal(spoken.length, 1);
});

test("feedback uses requested scope, actual query stage and follow-up context", () => {
  const phrases = new WaitingFeedbackPhrases();
  assert.match(phrases.choose({ request: "上周深蹲练了多少" }), /上周深蹲记录/);
  assert.match(
    phrases.choose({
      request: "画面为什么不能放大",
      stage: "正在查看你的训练记录…",
    }),
    /记录/,
  );
  assert.match(
    phrases.choose({ request: "还是不行", previousRequest: "怎么一直不计数" }),
    /识别|计数|检测/,
  );
  assert.match(
    phrases.choose({ request: "这个动作怎么做", exercise: "squat" }),
    /深蹲/,
  );
  assert.match(phrases.choose({ request: "换成深蹲" }), /要求|设置|状态/);
  assert.match(phrases.choose({ request: "饮食怎么搭配" }), /饮食/);
  assert.match(phrases.choose({ request: "50公斤怎么配片" }), /配片|杠铃片/);
  assert.doesNotMatch(
    phrases.choose({ request: "不要放大画面" }),
    /已|正在放大|我来放大/,
  );
});

test("only heard feedback enters recent history and repeated turns vary without another model call", () => {
  const phrases = new WaitingFeedbackPhrases();
  const context = { request: "为什么不计数" };
  const first = phrases.choose(context);
  assert.equal(
    phrases.choose(context),
    first,
    "unheard/cancelled audio must not consume a variant",
  );
  const spoken: string[] = [];
  for (let i = 0; i < 8; i++) {
    const text = phrases.choose(context);
    assert.notEqual(text, spoken.at(-1));
    spoken.push(text);
    phrases.remember(text);
  }
  assert.equal(new Set(spoken.slice(0, 4)).size, 4);
  phrases.remember("我查一下。");
  assert.equal(phrases.allows("我查一下，"), false);
  assert.equal(phrases.allows("我先核对一下你的记录。"), true);
});
