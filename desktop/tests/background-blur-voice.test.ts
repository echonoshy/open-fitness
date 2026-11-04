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

test("explicit blur commands use the existing local route without a model request", async () => {
  for (const [enabled, phrases] of [
    [
      true,
      [
        "打开背景虚化",
        "请开启背景虚化。",
        "帮我把背景模糊一下",
        "把背景虚化打开",
      ],
    ],
    [
      false,
      [
        "关闭背景虚化",
        "取消背景虚化",
        "请把背景虚化关掉",
        "恢复清晰背景",
        "恢复背景清晰",
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
        [{ type: "background_blur", enabled }],
        text,
      );
      assert.equal(result.receipts[0].state.backgroundBlur?.enabled, enabled);
      assert.equal(h.dataRef.current.settings.backgroundBlur, enabled);
      assert.equal(h.engine.cameraReady, false);
      assert.equal(h.engine.active, false);
      if (enabled) assert.match(result.text, /下次打开摄像头/);
    }
  }
});

test("blur shortcuts exclude questions, negations, quotes, future and compound requests", () => {
  for (const text of [
    "先别打开背景虚化",
    "不要关闭背景虚化",
    "支持背景虚化吗？",
    "背景虚化现在开着吗？",
    "等会儿再打开背景虚化",
    "如果背景很乱就打开背景虚化",
    "他说打开背景虚化",
    "“打开背景虚化”是什么意思",
    "打开背景虚化，再放大一点",
    "背景再模糊一点",
    "只把人虚化",
  ])
    assert.equal(localVoiceCommand(text), null, text);
  assert.equal(isGeneralAdvice("能帮我把背景恢复清晰吗？"), false);
  assert.equal(isGeneralAdvice("怎么恢复背景清晰？"), false);
});

test("blur changes preserve counted repetitions, fixed framing, voice and training settings", async () => {
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
    const result = await h.dispatch({ type: "background_blur", enabled });
    assert.equal(result.ok, true);
    assert.deepEqual(h.engine.snapshot(), before);
    assert.deepEqual(h.framer.snapshot(), frame);
    assert.equal(h.dataRef.current.settings.voice, true);
    assert.equal(h.speechStopped.current, false);
  }
  assert.equal(h.playbackStops, 0);
});

test("failed or interrupted queued blur writes cannot report success or overwrite settings", async () => {
  const failed = appControls({
    saveData: async () => {
      throw Error("disk unavailable");
    },
  });
  await assert.rejects(
    failed.dispatch({ type: "background_blur", enabled: false }),
    /disk unavailable/,
  );
  assert.equal(failed.dataRef.current.settings.backgroundBlur, undefined);
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
    { type: "background_blur", enabled: false },
    h.controller.current.signal,
  );
  h.cancel();
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(saves, 0);
  assert.equal(h.dataRef.current.settings.backgroundBlur, undefined);
  assert.equal(
    (await h.dispatch({ type: "background_blur", enabled: false })).ok,
    true,
  );
});

test("model-routed blur and framing controls compose with truthful setting receipts", async () => {
  const h = appControls();
  h.engine.cameraReady = true;
  let round = 0;
  const result = await coachTurn(
    "帮我关闭背景虚化，再固定当前画面",
    h.snapshot(),
    h.dispatch,
    async () => {
      if (round++ === 0)
        return {
          output: [
            call("background_blur", { enabled: false }),
            call("camera_view", { action: "lock" }),
          ],
        };
      return reply("背景虚化已关闭，画面已固定。");
    },
  );
  assert.equal(result.receipts.length, 2);
  assert.ok(result.receipts.every((r) => r.ok));
  assert.equal(result.receipts.at(-1)?.state.backgroundBlur?.enabled, false);
  assert.equal(h.dataRef.current.settings.backgroundBlur, false);
  assert.match(result.text, /背景虚化已关闭/);
  assert.ok(tools.find((t) => t.name === "background_blur")?.description);
});

test("read-only blur queries get the latest saved preference without executing a control", async () => {
  const h = appControls();
  await h.dispatch({ type: "background_blur", enabled: false });
  h.commands.length = 0;
  let round = 0;
  const result = await coachTurn(
    "背景虚化现在开着吗？",
    h.snapshot(),
    h.dispatch,
    async (payload: any) => {
      if (round++ === 0) return { output: [call("session_query")] };
      const output = payload.input.findLast(
        (x: any) => x.type === "function_call_output",
      );
      assert.equal(
        JSON.parse(output.output).data.state.backgroundBlur.enabled,
        false,
      );
      return reply("背景虚化已关闭。");
    },
    [],
    undefined,
    { currentState: h.snapshot },
  );
  assert.deepEqual(h.commands, []);
  assert.match(result.text, /背景虚化已关闭/);
});

test("blur state grounding rejects incorrect or unavailable effect claims", () => {
  const h = appControls();
  const state = h.snapshot();
  assert.deepEqual(replyChecks("背景虚化已开启。", "", { state }), []);
  assert.ok(
    replyChecks("背景虚化已关闭。", "", { state }).includes(
      "unconfirmed_execution",
    ),
  );
  state.backgroundBlur.notice = "效果暂不可用";
  assert.ok(
    replyChecks("背景虚化已开启。", "", { state }).includes(
      "unconfirmed_execution",
    ),
  );
});

test("App voice ask produces a final caption and spoken receipt for blur changes", async () => {
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
  await h.ask("关闭背景虚化");
  assert.equal(h.dataRef.current.settings.backgroundBlur, false);
  assert.ok(spoken.some((s) => s.includes("背景虚化已关闭")));
  assert.ok(
    h.messages.some(
      (m) => m.role === "assistant" && m.content.includes("背景虚化已关闭"),
    ),
  );
});
