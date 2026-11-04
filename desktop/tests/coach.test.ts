import test from "node:test";
import assert from "node:assert/strict";
import { coachTurn } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";
const call = (name: string, args: unknown) => ({
  type: "function_call",
  name,
  arguments: JSON.stringify(args),
  call_id: Math.random().toString(),
});
const reply = (text: string) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
const setup = () => {
  const e = new SessionEngine();
  const run = async (raw: unknown) => e.dispatch(raw);
  return { e, run };
};
test("success speech comes from actual receipts, never model prose", async () => {
  const { e, run } = setup();
  let n = 0;
  const r = await coachTurn(
    "换成向上推举，十二次",
    e.snapshot(),
    run,
    async () => ({
      output:
        n++ === 0
          ? [
              call("set_exercise", { exercise: "shoulder_press" }),
              call("set_rep_goal", { reps: 12 }),
            ]
          : [reply("已经启动了100秒休息。")],
    }),
  );
  assert.equal(e.exercise, "shoulder_press");
  assert.equal(e.goal, 12);
  assert.match(r.text, /已切换到肩上推举/);
  assert.doesNotMatch(r.text, /100秒/);
});
test("rejected rest is not announced as done", async () => {
  const { e, run } = setup();
  let n = 0;
  const r = await coachTurn("开始休息", e.snapshot(), run, async () => ({
    output:
      n++ === 0 ? [call("rest_timer", { seconds: 60 })] : [reply("已开始休息")],
  }));
  assert.equal(e.restUntil, 0);
  assert.match(r.text, /请先开始训练/);
  assert.equal(r.receipts[0].ok, false);
});
test("missing tool cannot falsely acknowledge control", async () => {
  const { e, run } = setup();
  const r = await coachTurn("设置次数", e.snapshot(), run, async () => ({
    output: [reply("已经设置为十五次")],
  }));
  assert.match(r.text, /没有执行任何操作/);
  assert.equal(e.goal, 12);
});
test("no_action with false success is guarded", async () => {
  const { e, run } = setup();
  let n = 0;
  const r = await coachTurn("深蹲怎么做", e.snapshot(), run, async () => ({
    output: n++ === 0 ? [call("no_action", {})] : [reply("已切换到深蹲")],
  }));
  assert.match(r.text, /没有执行任何操作/);
});
test("cancellation after model response prevents effects", async () => {
  const { e, run } = setup();
  await assert.rejects(
    coachTurn(
      "改十次",
      e.snapshot(),
      run,
      async () => ({ output: [call("set_rep_goal", { reps: 10 })] }),
      [],
      () => true,
    ),
    /已取消/,
  );
  assert.equal(e.goal, 12);
});
test("malformed tool parameters return failure receipt", async () => {
  const { e, run } = setup();
  let n = 0;
  const r = await coachTurn("次数", e.snapshot(), run, async () => ({
    output:
      n++ === 0
        ? [{ ...call("set_rep_goal", {}), arguments: "{broken" }]
        : [reply("完成")],
  }));
  assert.equal(e.goal, 12);
  assert.match(r.text, /未执行/);
});
test("partial execution is accurately reported when next model request fails", async () => {
  const { e, run } = setup();
  let n = 0;
  const r = await coachTurn("十次", e.snapshot(), run, async () => {
    if (n++ === 0) return { output: [call("set_rep_goal", { reps: 10 })] };
    throw Error("offline");
  });
  assert.equal(e.goal, 10);
  assert.match(r.text, /目标已设为10次/);
  assert.match(r.text, /后续模型请求失败/);
});
