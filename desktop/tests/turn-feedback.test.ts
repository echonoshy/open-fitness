import test from "node:test";
import assert from "node:assert/strict";
import {
  ReplySpeechQueue,
  type PcmSource,
  type SpeechKind,
} from "../src/media/speech-queue";
import {
  TurnFeedback,
  type TurnFeedbackOptions,
} from "../src/media/turn-feedback";
const WAITING_TEXT = "我来看看你上周的训练记录。";
import { isPlaybackEcho } from "../src/core/speech-turn";
import { coachTurn, type CoachProgress } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const audio: PcmSource = async (_signal, push) =>
  push(new Uint8Array([1, 0]), 16000);
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup(
  options: {
    waiting?: PcmSource;
    synthesize?: (text: string) => PcmSource;
    enabled?: () => boolean;
    feedback?: TurnFeedbackOptions;
  } = {},
) {
  const controller = new AbortController();
  const spoken: { text: string; kind: SpeechKind }[] = [],
    shown: string[] = [];
  let streams = 0;
  const queue = new ReplySpeechQueue(
    async (text, signal, push) =>
      (text === WAITING_TEXT
        ? (options.waiting ?? audio)
        : (options.synthesize?.(text) ?? audio))(signal, push),
    async (source) => {
      streams++;
      await source(controller.signal, () => {});
    },
    { onAudio: (text, kind) => spoken.push({ text, kind }) },
  );
  const feedback = new TurnFeedback(
    queue,
    controller.signal,
    options.enabled ?? (() => true),
    (text) => shown.push(text),
    options.feedback,
  );
  return { feedback, queue, controller, spoken, shown, streams: () => streams };
}

test("model acknowledgement speaks once and never consumes the final answer", async () => {
  const s = setup();
  s.feedback.preamble(WAITING_TEXT);
  await flush();
  s.feedback.preamble("我来继续核对。");
  await s.feedback.finish("这是正式答案。");
  assert.deepEqual(s.spoken, [
    { text: WAITING_TEXT, kind: "waiting" },
    { text: "这是正式答案。", kind: "final" },
  ]);
  assert.equal(s.streams(), 1);
});
test("without request context there is no generic repeating waiting speech", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(s.spoken.length, 0);
  await s.feedback.finish("训练已暂停。");
  s.feedback.preamble(WAITING_TEXT);
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["训练已暂停。"],
  );
});
test("a final answer replaces waiting audio that has not arrived, including a late producer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = deferred();
  const s = setup({
    waiting: async (signal, push) => {
      await hold.promise;
      await audio(signal, push);
    },
  });
  s.feedback.preamble(WAITING_TEXT);
  t.mock.timers.tick(700);
  await flush();
  await s.feedback.finish("正式答案优先。");
  hold.resolve();
  await flush();
  assert.deepEqual(s.spoken, [{ text: "正式答案优先。", kind: "final" }]);
});
test("progress suppresses generic waiting, and completed receipts are not repeated in the final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  s.feedback.progress("已切换到深蹲。");
  s.feedback.preamble(WAITING_TEXT);
  await flush();
  t.mock.timers.tick(700);
  await flush();
  await s.feedback.finish("已切换到深蹲。 本组目标已设为10次。");
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["已切换到深蹲。", "本组目标已设为10次。"],
  );
});
test("pending progress is dropped but the full final receipt remains", async () => {
  const hold = deferred();
  const s = setup({
    synthesize: (text) =>
      text === "已切换到深蹲。"
        ? async (signal, push) => {
            await hold.promise;
            await audio(signal, push);
          }
        : audio,
  });
  s.feedback.progress("已切换到深蹲。");
  await flush();
  await s.feedback.finish("已切换到深蹲。 本组目标已设为10次。");
  hold.resolve();
  await flush();
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["已切换到深蹲。 本组目标已设为10次。"],
  );
});
test("failed or partial progress synthesis never removes text from the final answer", async () => {
  for (const partial of [false, true]) {
    let first = true;
    const s = setup({
      synthesize: () => async (signal, push) => {
        if (first) {
          first = false;
          if (partial) await audio(signal, push);
          throw Error("TTS failed");
        }
        await audio(signal, push);
      },
    });
    s.feedback.progress("本组目标已设为10次。");
    await flush();
    await s.feedback.finish("本组目标已设为10次。");
    assert.equal(s.spoken.at(-1)?.kind, "final");
    assert.equal(s.spoken.at(-1)?.text, "本组目标已设为10次。");
  }
});
test("missing waiting audio and a timed out progress request do not fail the final answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup({
    waiting: async () => {
      throw Error("missing asset");
    },
  });
  s.feedback.preamble(WAITING_TEXT);
  t.mock.timers.tick(700);
  await flush();
  await s.feedback.finish("答案仍然完整。");
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["答案仍然完整。"],
  );
  const p = setup({
    synthesize: (text) =>
      text === "正在处理。" ? () => new Promise(() => {}) : audio,
  });
  p.feedback.progress("正在处理。");
  t.mock.timers.tick(2500);
  await flush();
  await p.feedback.finish("处理完成。");
  assert.deepEqual(
    p.spoken.map((x) => x.text),
    ["处理完成。"],
  );
});
test("streamed answer after acknowledgement is not repeated at completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  s.feedback.preamble(WAITING_TEXT);
  t.mock.timers.tick(700);
  await flush();
  s.feedback.sentence("第一句。");
  await flush();
  s.feedback.sentence("第二句。");
  await s.feedback.finish("第一句。第二句。");
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    [WAITING_TEXT, "第一句。", "第二句。"],
  );
});
test("muted turns retain visible feedback and do not create a playback stream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup({ enabled: () => false });
  s.feedback.preamble(WAITING_TEXT);
  t.mock.timers.tick(700);
  await flush();
  s.feedback.progress("本组目标已设为10次。");
  s.feedback.sentence("答案。");
  await s.feedback.finish("答案。");
  assert.equal(s.streams(), 0);
  assert.equal(s.shown.length, 2);
});
test("interruption ignores late acknowledgement, sentences and receipts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup();
  s.controller.abort();
  s.feedback.preamble(WAITING_TEXT);
  t.mock.timers.tick(700);
  s.feedback.progress("已完成。");
  s.feedback.sentence("过期答案。");
  await s.feedback.finish("过期最终答案。");
  assert.deepEqual(s.spoken, []);
  assert.deepEqual(s.shown, []);
});
test("interruption during feedback discards late PCM, pending progress and final speech", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = deferred();
  const s = setup({
    waiting: async (signal, push) => {
      await audio(signal, push);
      await hold.promise;
      await audio(signal, push);
    },
  });
  s.feedback.preamble(WAITING_TEXT);
  t.mock.timers.tick(700);
  await flush();
  s.feedback.progress("目标已设置。");
  s.controller.abort();
  hold.resolve();
  await flush();
  await s.feedback.finish("目标已设置。");
  await assert.rejects(s.queue.finish(), { name: "AbortError" });
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    [WAITING_TEXT],
  );
});
test("failure after a streamed fragment is announced, rather than swallowed by the answered flag", async () => {
  const s = setup();
  s.feedback.sentence("我查到以下内容。");
  await flush();
  await s.feedback.finish("后续请求失败，请再试一次。", true);
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["我查到以下内容。", "后续请求失败，请再试一次。"],
  );
});
test("a finished feedback producer cannot inject late audio into the final answer", async () => {
  const chunks: number[] = [];
  let late!: () => void;
  const q = new ReplySpeechQueue(
    async (_text, _signal, push) => push(new Uint8Array([2, 0]), 16000),
    async (source) =>
      source(new AbortController().signal, (bytes) => chunks.push(bytes[0])),
  );
  q.enqueue(WAITING_TEXT, "waiting", async (_signal, push) => {
    push(new Uint8Array([1, 0]), 16000);
    late = () => push(new Uint8Array([9, 0]), 16000);
  });
  await flush();
  q.enqueue("正式回答。", "final");
  await q.finish();
  late();
  assert.deepEqual(chunks, [1, 2]);
});

const tool = (name: string, args: unknown, call_id: string) => ({
  type: "function_call",
  name,
  arguments: JSON.stringify(args),
  call_id,
});
const reply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
test("progress is observational: all model payloads, rounds and compound operations stay identical", async () => {
  async function run(observe: boolean) {
    const e = new SessionEngine();
    e.cameraReady = true;
    const payloads: unknown[] = [],
      progress: CoachProgress[] = [];
    const outputs = [
      { output: [tool("set_exercise", { exercise: "lunge" }, "one")] },
      { output: [tool("set_rep_goal", { reps: 10 }, "two")] },
      reply("好了。"),
    ];
    const result = await coachTurn(
      "换成弓步蹲，这组做十次",
      e.snapshot(),
      async (c) => e.dispatch(c),
      async (p) => {
        payloads.push(structuredClone(p));
        return outputs.shift();
      },
      [],
      () => false,
      observe ? { onProgress: (p) => progress.push(p) } : {},
    );
    return { result, payloads, progress, snapshot: e.snapshot() };
  }
  const before = await run(false),
    after = await run(true);
  assert.deepEqual(after.payloads, before.payloads);
  assert.deepEqual(after.result, before.result);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.equal(after.progress.length, 2);
});
test("actual failed receipts and later model failures retain truthful final feedback", async () => {
  const e = new SessionEngine();
  let calls = 0;
  const progress: CoachProgress[] = [];
  const result = await coachTurn(
    "帮我休息三十秒",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async () => {
      if (++calls === 1)
        return { output: [tool("rest_timer", { seconds: 30 }, "rest")] };
      throw Error("offline");
    },
    [],
    () => false,
    { onProgress: (p) => progress.push(p) },
  );
  assert.equal(progress[0].type, "receipt");
  if (progress[0].type === "receipt")
    assert.equal(progress[0].receipt.ok, false);
  assert.match(result.text, /请先开始训练/);
  assert.match(result.text, /后续模型请求失败/);
});
test("query progress only starts for a valid real query and cancellation suppresses later receipts", async () => {
  const e = new SessionEngine();
  const order: string[] = [];
  let n = 0;
  await coachTurn(
    "上周练了多少",
    e.snapshot(),
    async (c) => e.dispatch(c),
    async () => {
      if (!n++)
        return {
          output: [tool("history_query", { period: "last_week" }, "history")],
        };
      return reply("没有记录。");
    },
    [],
    () => false,
    {
      onProgress: (p) => order.push(p.type),
      query: async () => {
        order.push("query-start");
        return {};
      },
    },
  );
  assert.deepEqual(order, ["query", "query-start"]);
  let cancelled = false;
  await assert.rejects(
    coachTurn(
      "设置十次",
      e.snapshot(),
      async (c) => {
        cancelled = true;
        return e.dispatch(c);
      },
      async () => ({
        output: [
          tool("set_rep_goal", { reps: 10 }, "goal"),
          tool("set_load", { kg: 5 }, "load"),
        ],
      }),
      [],
      () => cancelled,
      { onProgress: () => assert.fail("late progress") },
    ),
    /已取消/,
  );
  assert.equal(e.load, 0);
});
test("model acknowledgement is echo-filterable without masking short interruptions", () => {
  assert.equal(isPlaybackEcho(WAITING_TEXT, [WAITING_TEXT]), true);
  for (const command of ["停", "暂停", "不要", "继续训练"])
    assert.equal(isPlaybackEcho(command, [WAITING_TEXT]), false);
});

test("slow requests get one contextual response; fast answers and receipts suppress the timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slow = setup({ feedback: { waiting: () => WAITING_TEXT } });
  t.mock.timers.tick(749);
  await flush();
  assert.equal(slow.spoken.length, 0);
  t.mock.timers.tick(1);
  await flush();
  t.mock.timers.tick(10000);
  await flush();
  assert.deepEqual(
    slow.spoken.map((x) => x.text),
    [WAITING_TEXT],
  );
  await slow.feedback.finish("这是最终结果。");
  assert.equal(slow.spoken.at(-1)?.text, "这是最终结果。");
  for (const kind of ["answer", "receipt", "final"] as const) {
    const fast = setup({ feedback: { waiting: () => WAITING_TEXT } });
    if (kind === "answer") fast.feedback.sentence("直接回答。");
    if (kind === "receipt") fast.feedback.progress("训练已暂停。");
    await fast.feedback.finish(
      kind === "receipt" ? "训练已暂停。" : "直接回答。",
    );
    t.mock.timers.tick(10000);
    await flush();
    assert.ok(fast.spoken.every((x) => x.kind !== "waiting"));
  }
});

test("model wording replaces unheard contextual fallback, and late fallback PCM is discarded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = deferred();
  const sources: string[] = [];
  const s = setup({
    feedback: {
      waiting: () => WAITING_TEXT,
      onWaiting: (source) => sources.push(source),
    },
    waiting: async (_signal, push) => {
      await hold.promise;
      push(new Uint8Array([1, 0]), 16000);
    },
  });
  t.mock.timers.tick(750);
  await flush();
  s.feedback.preamble("我查一下。");
  await flush();
  hold.resolve();
  await flush();
  await s.feedback.finish("完整答案。");
  assert.deepEqual(sources, ["context", "model"]);
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["我查一下。", "完整答案。"],
  );
});

test("heard waiting feedback prevents another preamble and never consumes streamed final sentences", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup({ feedback: { waiting: () => WAITING_TEXT } });
  t.mock.timers.tick(750);
  await flush();
  s.feedback.preamble("我查一下。");
  s.feedback.query("正在查看你的训练记录…");
  s.feedback.sentence("第一句答案。");
  await flush();
  s.feedback.sentence("第二句答案。");
  await s.feedback.finish("第一句答案。第二句答案。");
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    [WAITING_TEXT, "第一句答案。", "第二句答案。"],
  );
});

test("query state informs delayed feedback without adding an immediate filler to fast queries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stages: (string | undefined)[] = [];
  const s = setup({
    feedback: {
      waiting: (stage) => {
        stages.push(stage);
        return "我看看你的训练记录。";
      },
    },
  });
  s.feedback.query("正在查看你的训练记录…");
  await flush();
  assert.equal(s.spoken.length, 0);
  t.mock.timers.tick(750);
  await flush();
  assert.deepEqual(stages, ["正在查看你的训练记录…"]);
  assert.equal(s.spoken[0].kind, "waiting");
  await s.feedback.finish("记录查询结果。");
});

test("repeated model preamble falls back to a fresh contextual phrase", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup({
    feedback: { waiting: () => WAITING_TEXT, allowPreamble: () => false },
  });
  s.feedback.preamble("我查一下。");
  t.mock.timers.tick(750);
  await flush();
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    [WAITING_TEXT],
  );
  await s.feedback.finish("最终答案。");
});

test("identical query feedback does not restart an in-flight fallback synthesis", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = deferred();
  let attempts = 0;
  const s = setup({
    feedback: { waiting: () => WAITING_TEXT },
    waiting: async (signal, push) => {
      attempts++;
      await hold.promise;
      await audio(signal, push);
    },
  });
  t.mock.timers.tick(750);
  await flush();
  s.feedback.query("正在查看你的训练记录…");
  s.feedback.preamble(WAITING_TEXT);
  hold.resolve();
  await flush();
  await s.feedback.finish("最终答案。");
  assert.equal(attempts, 1);
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    [WAITING_TEXT, "最终答案。"],
  );
});

test("interruption before or during fallback and mute/disposal cannot emit stale feedback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const action of ["abort", "dispose", "mute"] as const) {
    const s = setup({
      feedback: { waiting: () => WAITING_TEXT },
      enabled: () => action !== "mute",
    });
    if (action === "abort") s.controller.abort();
    if (action === "dispose") s.feedback.dispose();
    t.mock.timers.tick(10000);
    await flush();
    assert.deepEqual(s.spoken, []);
    await s.feedback.finish("结束。");
  }
  const hold = deferred();
  const s = setup({
    feedback: { waiting: () => WAITING_TEXT },
    waiting: async (_signal, push) => {
      await hold.promise;
      push(new Uint8Array([1, 0]), 16000);
    },
  });
  t.mock.timers.tick(750);
  await flush();
  s.controller.abort();
  hold.resolve();
  await flush();
  await s.feedback.finish("过期回答。");
  await assert.rejects(s.queue.finish(), { name: "AbortError" });
  assert.deepEqual(s.spoken, []);
});

test("a stalled contextual TTS yields to the answer and its late chunks cannot escape", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hold = deferred();
  const s = setup({
    feedback: { waiting: () => WAITING_TEXT },
    waiting: async (_signal, push) => {
      await hold.promise;
      push(new Uint8Array([1, 0]), 16000);
    },
  });
  t.mock.timers.tick(750);
  await flush();
  await s.feedback.finish("答案优先。");
  hold.resolve();
  t.mock.timers.tick(10000);
  await flush();
  assert.deepEqual(
    s.spoken.map((x) => x.text),
    ["答案优先。"],
  );
});

test("contextual feedback leaves model payloads, forced decisions, queries and compound operations identical", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const scenario of [
    "compound",
    "forced",
    "query",
    "no_action",
  ] as const) {
    async function run(observe: boolean) {
      const s = setup({
        feedback: observe ? { waiting: () => WAITING_TEXT } : undefined,
      });
      const e = new SessionEngine();
      const payloads: unknown[] = [],
        queries: unknown[] = [];
      const outputs =
        scenario === "compound"
          ? [
              { output: [tool("set_exercise", { exercise: "lunge" }, "one")] },
              { output: [tool("set_rep_goal", { reps: 10 }, "two")] },
              reply("好了。"),
            ]
          : scenario === "forced"
            ? [
                reply("我查一下。"),
                { output: [tool("no_action", {}, "one")] },
                reply("这是答案。"),
              ]
            : scenario === "query"
              ? [
                  {
                    output: [
                      tool("history_query", { period: "last_week" }, "one"),
                    ],
                  },
                  { output: [tool("no_action", {}, "two")] },
                  reply("没有训练记录。"),
                ]
              : [
                  { output: [tool("no_action", {}, "one")] },
                  reply("这是答案。"),
                ];
      const result = await coachTurn(
        scenario === "compound"
          ? "换成弓步蹲，这组做十次"
          : scenario === "query"
            ? "上周练了多少"
            : "现在是什么状态",
        e.snapshot(),
        async (raw) => e.dispatch(raw),
        async (p) => {
          payloads.push(structuredClone(p));
          t.mock.timers.tick(800);
          await flush();
          return outputs.shift();
        },
        [],
        () => false,
        {
          query: async (raw) => {
            queries.push(raw);
            return { overview: { sets: 0, reps: 0 } };
          },
          ...(observe
            ? {
                onPreamble: (text: string) => s.feedback.preamble(text),
                onSentence: (text: string) => s.feedback.sentence(text),
                onProgress: (p: CoachProgress) =>
                  p.type === "receipt"
                    ? s.feedback.progress(p.receipt.message)
                    : s.feedback.query(p.text),
              }
            : {}),
        },
      );
      await s.feedback.finish(result.text);
      return { result, payloads, queries, state: e.snapshot() };
    }
    assert.deepEqual(await run(true), await run(false), scenario);
  }
});
