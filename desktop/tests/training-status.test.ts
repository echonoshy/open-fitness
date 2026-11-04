import test from "node:test";
import assert from "node:assert/strict";
import { SessionEngine } from "../src/core/session";
import { coachTurn } from "../src/core/coach";
import { replyChecks } from "../src/core/diagnostics";
import {
  isCurrentProgressQuestion,
  trainingProgressSummary,
} from "../src/core/training-status";

const call = (name: string) => ({
  type: "function_call",
  name,
  call_id: name,
  arguments: "{}",
});
const answer = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
const state = () => ({
  ...new SessionEngine().snapshot(),
  exercise: "shoulder_press" as const,
  status: "training" as const,
  reps: 27,
  goal: 12,
  tracking: true,
  preparing: false,
  squatCheck: undefined,
});

test("current progress intent is distinct from history, advice and compound controls", () => {
  for (const text of [
    "我做了多少了？",
    "这组做完了吗？",
    "我一共做了几次了",
    "还差几次？",
  ])
    assert.equal(isCurrentProgressQuestion(text), true, text);
  for (const text of [
    "今天一共做了多少次？",
    "上周做了多少？",
    "下一组应该做几次？",
    "暂停再说做了几次",
  ])
    assert.equal(isCurrentProgressQuestion(text), false, text);
});
test("live status tool reads the current set even before it has been saved", async () => {
  let turns = 0;
  const spoken: string[] = [];
  const r = await coachTurn(
    "这组做了多少了？",
    { ...state(), reps: 0 },
    async () => {
      throw Error("read-only");
    },
    async (_p, delta) => {
      if (!turns++) return { output: [call("session_query")] };
      if (turns === 2) return { output: [call("no_action")] };
      delta?.("本组已经完成27次，目标12次。");
      return answer("本组已经完成27次，目标12次。");
    },
    [],
    () => false,
    { currentState: state, onSentence: (t) => spoken.push(t) },
  );
  assert.equal(turns, 3);
  assert.match(r.text, /27次/);
  assert.equal(spoken.join(""), r.text);
  assert.equal(r.receipts.length, 0);
});
test("a rejected count answer falls back to live facts instead of an operation error", async () => {
  let turns = 0;
  const r = await coachTurn(
    "我做了多少了？",
    state(),
    async () => {
      throw Error("read-only");
    },
    async () => {
      return !turns++
        ? { output: [call("no_action")] }
        : answer("你已完成12次。");
    },
  );
  assert.match(r.text, /27次/);
  assert.doesNotMatch(r.text, /没有执行|查不到|请查看实际记录/);
});
test("today's saved count is grounded in history separately from the ongoing set", () => {
  const grounding = {
    state: state(),
    question: "今天已经完成多少次？",
    queries: [
      { name: "history_query", data: { overview: { sets: 1, reps: 12 } } },
    ],
  };
  assert.deepEqual(replyChecks("今天已经完成12次。", "12", grounding), []);
  assert.deepEqual(replyChecks("已经完成12次。", "12", grounding), []);
  assert.ok(
    replyChecks("今天已经完成28次。", "12", grounding).includes(
      "unconfirmed_execution",
    ),
  );
  assert.ok(
    replyChecks("我已帮你完成12次。", "12", grounding).includes(
      "unconfirmed_execution",
    ),
  );
});
test("read-only history fallback uses actual query results rather than a command failure", async () => {
  let turns = 0;
  const r = await coachTurn(
    "今天已经完成多少次？",
    state(),
    async () => {
      throw Error("read-only");
    },
    async () => {
      return !turns++
        ? { output: [call("history_query")] }
        : answer("今天已经完成28次。");
    },
    [],
    () => false,
    {
      query: async () => ({
        overview: { sets: 1, reps: 12 },
        range: { from: "2026-10-27", to: "2026-10-27" },
      }),
    },
  );
  assert.match(r.text, /1组、12次/);
  assert.doesNotMatch(r.text, /没有执行|28次/);
});
test("plank and completed set summaries retain their units and scope", () => {
  assert.match(
    trainingProgressSummary({
      ...state(),
      exercise: "plank",
      hold: 33.5,
      holdGoal: 30,
    }),
    /33秒.*30秒/,
  );
  assert.match(
    trainingProgressSummary({ ...state(), status: "ready" }),
    /上一组肩上推举.*27次/,
  );
});
