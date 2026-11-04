import test from "node:test";
import assert from "node:assert/strict";
import { localVoiceCommand, isGeneralAdvice } from "../src/core/voice-routing";
import { coachTurn, tools } from "../src/core/coach";
import { replyChecks } from "../src/core/diagnostics";
import { appControls } from "./helpers/app-controls";

const call = (name: string, args = {}) => ({
  type: "function_call",
  name,
  arguments: JSON.stringify(args),
  call_id: crypto.randomUUID(),
});
const reply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});

test("explicit reference commands use the existing local route without a model request", async () => {
  for (const [enabled, phrases] of [
    [
      true,
      ["打开动作参考", "请开启动作参考。", "显示示范视频", "把动作参考打开"],
    ],
    [
      false,
      [
        "关闭动作参考",
        "收起动作示范",
        "请把动作参考关掉",
        "隐藏示范视频",
        "把动作参考关掉",
      ],
    ],
  ] as const) {
    for (const text of phrases) {
      const h = appControls();
      const result = await coachTurn(
        text,
        h.snapshot(),
        h.dispatch,
        async () => {
          throw Error("must not request model");
        },
      );
      assert.deepEqual(
        h.commands,
        [{ type: "exercise_reference", enabled }],
        text,
      );
      assert.equal(
        result.receipts[0].state.exerciseReference?.enabled,
        enabled,
      );
      assert.equal(h.dataRef.current.settings.exerciseReference, enabled);
      assert.equal(h.engine.cameraReady, false);
      assert.equal(h.engine.active, false);
    }
  }
});

test("reference shortcuts exclude questions, negations, quotes, future and compound requests", () => {
  for (const text of [
    "先别打开动作参考",
    "不要关闭动作参考",
    "支持动作参考吗？",
    "动作参考现在开着吗？",
    "等会儿再打开动作参考",
    "如果背景很乱就打开动作参考",
    "他说打开动作参考",
    "“打开动作参考”是什么意思",
    "打开动作参考，再放大一点",
    "让动作参考大一点可以吗？",
    "只介绍动作参考，不要打开",
  ])
    assert.equal(localVoiceCommand(text), null, text);
  assert.equal(isGeneralAdvice("能帮我恢复动作参考吗？"), false);
  assert.equal(isGeneralAdvice("怎么恢复动作参考？"), false);
});

test("reference changes preserve counted repetitions, fixed framing, voice and training settings", async () => {
  const h = appControls();
  h.engine.now = () => 100;
  h.engine.cameraReady = true;
  h.engine.dispatch({ type: "session", action: "start" });
  h.engine.preparing = false;
  h.engine.counter.count = 6;
  h.framer.command({ type: "camera_view", action: "lock" });
  const before = h.engine.snapshot(),
    frame = h.framer.snapshot();
  for (const enabled of [false, true, true, false]) {
    const result = await h.dispatch({ type: "exercise_reference", enabled });
    assert.equal(result.ok, true);
    assert.deepEqual(h.engine.snapshot(), before);
    assert.deepEqual(h.framer.snapshot(), frame);
    assert.equal(h.dataRef.current.settings.voice, true);
    assert.equal(h.speechStopped.current, false);
  }
  assert.equal(h.playbackStops, 0);
});

test("failed or interrupted queued reference writes cannot report success or overwrite settings", async () => {
  const failed = appControls({
    saveData: async () => {
      throw Error("disk unavailable");
    },
  });
  await assert.rejects(
    failed.dispatch({ type: "exercise_reference", enabled: false }),
    /disk unavailable/,
  );
  assert.equal(failed.dataRef.current.settings.exerciseReference, undefined);
  assert.deepEqual(failed.events, []);
  let release!: () => void;
  let saves = 0;
  const h = appControls({
    saveData: async () => {
      saves++;
    },
  });
  h.writes.current = new Promise<void>((r) => {
    release = r;
  });
  const pending = h.dispatch(
    { type: "exercise_reference", enabled: false },
    h.controller.current.signal,
  );
  h.cancel();
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(saves, 0);
  assert.equal(h.dataRef.current.settings.exerciseReference, undefined);
  assert.equal(
    (await h.dispatch({ type: "exercise_reference", enabled: false })).ok,
    true,
  );
});

test("model-routed reference and framing controls compose with truthful setting receipts", async () => {
  const h = appControls();
  h.engine.cameraReady = true;
  let round = 0;
  const result = await coachTurn(
    "帮我关闭动作参考，再固定当前画面",
    h.snapshot(),
    h.dispatch,
    async () => {
      if (round++ === 0)
        return {
          output: [
            call("exercise_reference", { enabled: false }),
            call("camera_view", { action: "lock" }),
          ],
        };
      return reply("动作参考已关闭，画面已固定。");
    },
  );
  assert.equal(result.receipts.length, 2);
  assert.ok(result.receipts.every((r) => r.ok));
  assert.equal(result.receipts.at(-1)?.state.exerciseReference?.enabled, false);
  assert.equal(h.dataRef.current.settings.exerciseReference, false);
  assert.match(result.text, /动作参考已关闭/);
  assert.ok(tools.find((t) => t.name === "exercise_reference")?.description);
});

test("read-only reference queries get the latest saved preference without executing a control", async () => {
  const h = appControls();
  await h.dispatch({ type: "exercise_reference", enabled: false });
  h.commands.length = 0;
  let round = 0;
  const result = await coachTurn(
    "动作参考现在开着吗？",
    h.snapshot(),
    h.dispatch,
    async (payload: any) => {
      if (round++ === 0) return { output: [call("session_query")] };
      const output = payload.input.findLast(
        (x: any) => x.type === "function_call_output",
      );
      assert.equal(
        JSON.parse(output.output).data.state.exerciseReference.enabled,
        false,
      );
      return reply("动作参考已关闭。");
    },
    [],
    undefined,
    { currentState: h.snapshot },
  );
  assert.deepEqual(h.commands, []);
  assert.match(result.text, /动作参考已关闭/);
});

test("reference state grounding rejects an incorrect saved-setting claim", () => {
  const h = appControls();
  const state = h.snapshot();
  assert.deepEqual(replyChecks("动作参考已开启。", "", { state }), []);
  assert.ok(
    replyChecks("动作参考已关闭。", "", { state }).includes(
      "unconfirmed_execution",
    ),
  );
  state.exerciseReference.enabled = false;
  assert.ok(
    replyChecks("动作参考已开启。", "", { state }).includes(
      "unconfirmed_execution",
    ),
  );
});

test("App voice ask produces a final caption and spoken receipt for reference changes", async () => {
  const spoken: string[] = [];
  const h = appControls({
    request: async (kind, payload, _signal, chunk) => {
      assert.equal(kind, "tts");
      spoken.push(payload.text);
      chunk?.({
        type: "audio",
        audio: new Uint8Array([0, 0]),
        sampleRate: 24000,
      });
      return {};
    },
  });
  await h.ask("关闭动作参考");
  assert.equal(h.dataRef.current.settings.exerciseReference, false);
  assert.ok(spoken.some((s) => s.includes("动作参考已关闭")));
  assert.ok(
    h.messages.some(
      (m) => m.role === "assistant" && m.content.includes("动作参考已关闭"),
    ),
  );
});

test("nine local demo assets match provenance and current-action tips", async () => {
  const { EXERCISE_REFERENCES, exerciseReferenceInfo } =
    await import("../src/core/exercise-reference");
  const { EXERCISES } = await import("../src/core/engine");
  const { queryData } = await import("../src/core/coach-data");
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const manifest = JSON.parse(
    readFileSync(
      new URL("../public/movekit-library/hd/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const { primaryMovementSlugs } = await import("../src/core/movement-library");
  assert.deepEqual(Object.keys(EXERCISE_REFERENCES), Object.keys(EXERCISES));
  for (const [exercise, reference] of Object.entries(EXERCISE_REFERENCES)) {
    const slug = primaryMovementSlugs[exercise as keyof typeof primaryMovementSlugs];
    const clip = manifest.clips.find((clip: { slug: string }) => clip.slug === slug);
    assert.equal(reference.video, `./movekit-library/hd/${slug}.mp4`);
    assert.equal(clip.height, 720);
    const bytes = readFileSync(
      new URL("../public/" + reference.video, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      clip.sha256,
    );
    assert.ok(
      readFileSync(new URL("../public/" + reference.poster, import.meta.url))
        .length > 100,
    );
    assert.equal(reference.points.length, 3);
    const h = appControls();
    h.engine.dispatch({ type: "set_exercise", exercise });
    assert.deepEqual(
      await queryData(
        { type: "exercise_reference_info" },
        [],
        [],
        h.snapshot(),
      ),
      exerciseReferenceInfo(h.snapshot().exercise),
    );
  }
  await assert.rejects(
    queryData({ type: "exercise_reference_info" }, [], []),
    /指定/,
  );
  assert.equal(appControls().snapshot().exerciseReference.enabled, true);
});

test("reference explanation returns current tips without changing workout", async () => {
  const h = appControls();
  await h.dispatch({ type: "set_exercise", exercise: "pushup" });
  h.commands.length = 0;
  let round = 0;
  const result = await coachTurn(
    "能详细说说这个动作的基础要点吗？",
    h.snapshot(),
    h.dispatch,
    async (payload: any) => {
      if (round++ === 0) return { output: [call("exercise_reference_info")] };
      const data = JSON.parse(
        payload.input.findLast((x: any) => x.type === "function_call_output")
          .output,
      ).data;
      assert.equal(data.exercise, "pushup");
      assert.equal(data.points.length, 3);
      return reply(data.points.join("。"));
    },
    [],
    undefined,
    {
      currentState: h.snapshot,
      query: async (raw) => {
        const { queryData } = await import("../src/core/coach-data");
        return queryData(raw, [], [], h.snapshot());
      },
    },
  );
  assert.deepEqual(h.commands, []);
  assert.match(result.text, /避免塌腰/);
});

test("basic introductions work without a model and leave compound/negative requests to the coach", async () => {
  const { EXERCISES } = await import("../src/core/engine");
  const { localExerciseIntroduction } =
    await import("../src/core/exercise-reference");
  for (const exercise of Object.keys(EXERCISES) as (keyof typeof EXERCISES)[]) {
    const h = appControls();
    const result = await coachTurn(
      `讲一下${EXERCISES[exercise].label}的动作要点`,
      h.snapshot(),
      h.dispatch,
      async () => {
        throw Error("no model needed");
      },
    );
    assert.match(result.text, /三点/);
    assert.equal(result.receipts.length, 0);
    assert.deepEqual(h.commands, []);
  }
  assert.equal(
    localExerciseIntroduction("讲一下这个动作的要点", "plank")?.exercise,
    "plank",
  );
  for (const text of [
    "不要讲一下深蹲的动作要点",
    "他说讲一下深蹲的动作要点",
    "讲一下深蹲的动作要点，再开始训练",
    "讲一下深蹲的动作要点是什么意思？",
  ])
    assert.equal(localExerciseIntroduction(text, "squat"), null, text);
});

test("App introduction plays bundled audio without TTS or an LLM, and respects mute", async () => {
  const played: string[] = [];
  const h = appControls({
    request: async () => {
      throw Error("a fixed explanation must not call any service");
    },
    narrationSource: (exercise, voice) => async (signal, push) => {
      signal.throwIfAborted();
      played.push(exercise + ":" + voice);
      push(new Uint8Array([0, 0]), 24000);
    },
  });
  h.dataRef.current.settings.voice = false;
  await h.ask("讲一下深蹲的动作要点");
  assert.equal(played.length, 0);
  assert.ok(
    h.messages.some(
      (m) => m.role === "assistant" && m.content.includes("三点"),
    ),
  );
  h.dataRef.current.settings.voice = true;
  await h.ask("讲一下弓步蹲的动作要点");
  await h.ask("讲一下弓步蹲的动作要点");
  assert.equal(played.length, 2);
  assert.ok(played.every((p) => p.startsWith("lunge:")));
  assert.equal(h.engine.active, false);
});
