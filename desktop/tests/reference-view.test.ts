import test from "node:test";
import assert from "node:assert/strict";
import { localVoiceCommand } from "../src/core/voice-routing";
import { coachTurn, tools } from "../src/core/coach";
import { appControls } from "./helpers/app-controls";
import { dataSchema } from "../src/core/data";
import { voiceCommandSchema } from "../src/core/voice-controls";
import { queryData } from "../src/core/coach-data";
import { replyChecks } from "../src/core/diagnostics";

const cases = [
  ["关闭参考动作", { type: "exercise_reference", enabled: false }],
  ["打开参考视频", { type: "exercise_reference", enabled: true }],
  [
    "请把参考视频放大一点。",
    { type: "exercise_reference_size", size: "larger" },
  ],
  ["让参考动作大一点", { type: "exercise_reference_size", size: "larger" }],
  ["放大动作参考", { type: "exercise_reference_size", size: "larger" }],
  ["把参考视频缩小一档", { type: "exercise_reference_size", size: "smaller" }],
  ["参考动作小一点", { type: "exercise_reference_size", size: "smaller" }],
  ["参考视频调成小号", { type: "exercise_reference_size", size: "medium" }],
  ["把动作参考设为大号", { type: "exercise_reference_size", size: "large" }],
  ["参考视频用中号", { type: "exercise_reference_size", size: "medium" }],
  ["参考视频设为标准", { type: "exercise_reference_size", size: "medium" }],
  ["参考视频设为放大", { type: "exercise_reference_size", size: "large" }],
  ["参考视频恢复默认大小", { type: "exercise_reference_size", size: "medium" }],
  [
    "恢复动作参考的默认尺寸",
    { type: "exercise_reference_size", size: "medium" },
  ],
] as const;
test("two reference sizes and aliases route without changing camera semantics", async () => {
  for (const [text, command] of cases) {
    assert.deepEqual(localVoiceCommand(text), command, text);
    const h = appControls();
    const result = await coachTurn(text, h.snapshot(), h.dispatch, async () => {
      throw Error("no model expected");
    });
    assert.deepEqual(h.commands, [command]);
    assert.equal(result.receipts[0].ok, true);
  }
  assert.deepEqual(localVoiceCommand("放大一点"), {
    type: "camera_view",
    action: "zoom_in",
  });
  for (const text of [
    "不要放大参考视频",
    "他说把参考视频放大一点",
    "参考视频可以调大吗？",
    "参考视频是什么尺寸？",
    "先缩小参考视频，再隐藏动作要点",
  ])
    assert.equal(localVoiceCommand(text), null, text);
});
test("legacy small preferences migrate to standard without losing other settings", () => {
  assert.deepEqual(appControls().snapshot().exerciseReference, {
    enabled: true,
    size: "medium",
  });
  for (const size of ["small", "medium", "large"]) {
    const parsed = dataSchema.parse({
      settings: {
        voice: false,
        exerciseReference: false,
        exerciseReferenceSize: size,
        exerciseReferencePoints: true,
      },
      records: [],
    });
    assert.equal(
      parsed.settings.exerciseReferenceSize,
      size === "small" ? "medium" : size,
    );
    assert.equal(parsed.settings.voice, false);
    assert.equal(parsed.settings.exerciseReference, false);
    assert.equal("exerciseReferencePoints" in parsed.settings, false);
  }
  for (const size of ["small", "huge"])
    assert.equal(
      voiceCommandSchema.safeParse({ type: "exercise_reference_size", size })
        .success,
      false,
    );
});
test("removed text control is not exposed or confused with video and speech controls", () => {
  assert.equal(
    tools.some((t) => t.name === "exercise_reference_points"),
    false,
  );
  assert.equal(
    voiceCommandSchema.safeParse({
      type: "exercise_reference_points",
      enabled: true,
    }).success,
    false,
  );
  for (const text of [
    "隐藏参考视频的字幕",
    "显示动作要点",
    "打开参考视频的字幕",
    "隐藏字幕",
  ])
    assert.equal(localVoiceCommand(text), null, text);
});
test("queued relative sizes accumulate and clamp to the remaining two sizes", async () => {
  const h = appControls();
  await Promise.all([
    h.dispatch({ type: "exercise_reference_size", size: "larger" }),
    h.dispatch({ type: "exercise_reference_size", size: "larger" }),
  ]);
  assert.equal(h.snapshot().exerciseReference.size, "large");
  for (let i = 0; i < 3; i++)
    await h.dispatch({ type: "exercise_reference_size", size: "smaller" });
  assert.equal(h.snapshot().exerciseReference.size, "medium");
});
test("reference sizes preserve count, fixed framing, voice and reference enablement", async () => {
  const h = appControls();
  h.engine.now = () => 100;
  h.engine.cameraReady = true;
  h.engine.dispatch({ type: "session", action: "start" });
  h.engine.preparing = false;
  h.engine.counter.count = 6;
  h.framer.command({ type: "camera_view", action: "lock" });
  const before = h.engine.snapshot(),
    frame = h.framer.snapshot();
  for (const size of ["large", "medium"])
    await h.dispatch({ type: "exercise_reference_size", size });
  assert.deepEqual(h.engine.snapshot(), before);
  assert.deepEqual(h.framer.snapshot(), frame);
  assert.equal(h.dataRef.current.settings.voice, true);
  assert.equal(h.playbackStops, 0);
  await h.dispatch({ type: "exercise_reference", enabled: false });
  const result = await h.dispatch({
    type: "exercise_reference_size",
    size: "large",
  });
  assert.equal(result.state.exerciseReference?.enabled, false);
  assert.match(result.message, /下次打开/);
  await h.dispatch({ type: "exercise_reference", enabled: true });
  assert.equal(h.snapshot().exerciseReference.size, "large");
});
test("failed and cancelled writes report no success or changed state", async () => {
  const command = { type: "exercise_reference_size", size: "large" };
  const failed = appControls({
    saveData: async () => {
      throw Error("disk unavailable");
    },
  });
  await assert.rejects(failed.dispatch(command), /disk unavailable/);
  assert.deepEqual(failed.events, []);
  assert.deepEqual(failed.snapshot().exerciseReference, {
    enabled: true,
    size: "medium",
  });
  const h = appControls();
  let release!: () => void;
  h.writes.current = new Promise<void>((r) => (release = r));
  const pending = h.dispatch(command, h.controller.current.signal);
  h.cancel();
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(h.snapshot().exerciseReference, {
    enabled: true,
    size: "medium",
  });
});
test("model compound requests preserve truthful reference state", async () => {
  const h = appControls();
  let round = 0;
  const call = (name: string, args: object) => ({
    type: "function_call",
    name,
    arguments: JSON.stringify(args),
    call_id: crypto.randomUUID(),
  });
  const result = await coachTurn(
    "把参考视频调大，然后关掉参考视频",
    h.snapshot(),
    h.dispatch,
    async () =>
      round++ === 0
        ? {
            output: [
              call("exercise_reference_size", { size: "larger" }),
              call("exercise_reference", { enabled: false }),
            ],
          }
        : {
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "动作参考尺寸已设为放大。动作参考已关闭。",
                  },
                ],
              },
            ],
          },
    [],
    undefined,
    { currentState: h.snapshot },
  );
  assert.equal(result.receipts.length, 2);
  assert.deepEqual(h.snapshot().exerciseReference, {
    enabled: false,
    size: "large",
  });
  const query: any = await queryData(
    { type: "session_query" },
    [],
    [],
    h.snapshot(),
  );
  assert.deepEqual(
    query.state.exerciseReference,
    h.snapshot().exerciseReference,
  );
  assert.deepEqual(
    replyChecks("动作参考尺寸已设为放大。", "", { state: h.snapshot() }),
    [],
  );
  assert.ok(
    replyChecks("动作参考尺寸已设为标准。", "", {
      state: h.snapshot(),
    }).includes("unconfirmed_execution"),
  );
});
test("size commands stay silent when voice is muted", async () => {
  const h = appControls({
    request: async () => {
      throw Error("must not use services");
    },
  });
  h.dataRef.current.settings.voice = false;
  await h.ask("把参考视频放大一点");
  assert.equal(h.snapshot().exerciseReference.size, "large");
  assert.ok(h.messages.some((m) => m.content.includes("设为放大")));
});
test("negative reference requests preserve state", async () => {
  for (const before of [false, true])
    for (const text of ["不要放大参考动作", "别关闭参考视频"]) {
      const h = appControls();
      h.dataRef.current.settings.exerciseReference = before;
      const result = await coachTurn(
        text,
        h.snapshot(),
        h.dispatch,
        async () => {
          throw Error("must not reverse negation");
        },
      );
      assert.deepEqual(h.commands, []);
      assert.equal(h.snapshot().exerciseReference.enabled, before);
      assert.match(result.text, /保持/);
    }
});
test("status fallback describes the current size without removed text controls", async () => {
  const h = appControls();
  let round = 0;
  const result = await coachTurn(
    "参考视频现在是什么尺寸？",
    h.snapshot(),
    h.dispatch,
    async () =>
      round++ === 0
        ? {
            output: [
              {
                type: "function_call",
                name: "session_query",
                arguments: "{}",
                call_id: "reference-status",
              },
            ],
          }
        : { output: [] },
    [],
    undefined,
    { currentState: h.snapshot },
  );
  assert.match(result.text, /标准/);
  assert.doesNotMatch(result.text, /目标|计入|计数|文字|要点/);
  assert.deepEqual(h.commands, []);
});
