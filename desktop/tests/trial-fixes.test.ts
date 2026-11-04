import { localServices } from "./fixtures/local-services";
import test from "node:test";
import assert from "node:assert/strict";
import { SessionEngine } from "../src/core/session";
import { CameraFramer } from "../src/core/camera-framing";
import { localVoiceCommand } from "../src/core/voice-routing";
import { coachTurn } from "../src/core/coach";
import { liveFaults, type Rep } from "../src/core/engine";
import { service, applyServiceConfig } from "../electron/services";
import { COACH_VOICES } from "../src/core/voices";
const response = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
const row = (count: number): Rep => ({
  count,
  duration: 3,
  eccentric_s: 1.5,
  concentric_s: 1.5,
  min_angle: 80,
  full_depth: true,
  faults: [],
  score: 100,
});
function session() {
  const e = new SessionEngine();
  let t = 0;
  e.now = () => t;
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  return {
    e,
    at: (next: number) => {
      t = next;
    },
  };
}
applyServiceConfig(localServices());

test("new set archives all 13 reps once, resets count and goal, keeps session", () => {
  const { e, at } = session();
  for (let i = 1; i <= 13; i++) e.acceptRep(row(i));
  e.counter.count = 13;
  const id = e.sessionId,
    old = e.recordId;
  at(40);
  e.dispatch({ type: "set_rep_goal", reps: 15 });
  assert.equal(e.snapshot().reps, 13);
  const result = e.dispatch({ type: "new_set", target: 12 });
  assert.equal(result.ok, true);
  assert.equal(result.state.reps, 0);
  assert.equal(result.state.goal, 12);
  assert.equal(result.state.elapsed, 0);
  assert.equal(result.state.preparing, true);
  assert.equal(e.sessionId, id);
  assert.notEqual(e.recordId, old);
  assert.equal(e.pending.length, 1);
  assert.equal(e.pending[0].reps.length, 13);
  assert.equal(e.pending[0].duration, 40);
  e.acceptRep(row(1));
  e.dispatch({ type: "new_set" });
  assert.equal(e.goal, 12);
  assert.equal(e.pending[1].reps.length, 1);
});
test("new set validates units and plans before saving or clearing progress", () => {
  const { e } = session();
  e.acceptRep(row(1));
  for (const command of [
    { type: "new_set", target: 200 },
    { type: "new_set", target: 30, unit: "seconds" },
  ]) {
    assert.equal(e.dispatch(command).ok, false);
    assert.equal(e.rows.length, 1);
    assert.equal(e.pending.length, 0);
  }
  e.program = {
    blocks: [{ exercise: "squat", sets: 2, target: 10, rest: 30, load: 0 }],
    block: 0,
    set: 1,
  };
  assert.equal(e.dispatch({ type: "new_set" }).ok, false);
  assert.equal(e.rows.length, 1);
});
test("paused elapsed and saved duration freeze across repeated pauses and resume", () => {
  const { e, at } = session();
  at(10);
  e.dispatch({ type: "session", action: "pause" });
  at(50);
  e.dispatch({ type: "session", action: "pause" });
  assert.equal(e.snapshot().elapsed, 10);
  assert.equal(e.checkpoint()?.duration, 10);
  at(70);
  e.dispatch({ type: "session", action: "resume" });
  at(80);
  assert.equal(e.snapshot().elapsed, 20);
  e.dispatch({ type: "session", action: "resume" });
  at(90);
  e.dispatch({ type: "session", action: "pause" });
  at(100);
  e.dispatch({ type: "session", action: "end" });
  assert.equal(e.pending[0].duration, 30);
});
test("free-training rest survives a pause and new set starts a fresh clock", () => {
  const { e, at } = session();
  e.dispatch({ type: "rest_timer", seconds: 30 });
  at(10);
  e.dispatch({ type: "session", action: "pause" });
  at(100);
  e.dispatch({ type: "session", action: "resume" });
  assert.equal(e.snapshot().status, "resting");
  assert.equal(e.snapshot().remaining, 20);
  at(105);
  e.dispatch({ type: "session", action: "pause" });
  at(200);
  e.dispatch({ type: "new_set", target: 8 });
  assert.equal(e.pending[0].duration, 15);
  assert.equal(e.snapshot().status, "training");
  at(210);
  assert.equal(e.snapshot().elapsed, 10);
});
test("natural affirmative camera and new-set expressions execute without substrings", () => {
  assert.deepEqual(localVoiceCommand("我想把画面往右挪一点"), {
    type: "camera_view",
    action: "right",
  });
  assert.deepEqual(localVoiceCommand("让画面里的我向左挪一点"), {
    type: "camera_view",
    action: "right",
  });
  for (const text of [
    "把画面向左移一点",
    "让镜头往左移动一下",
    "请帮我画面往左一点。",
  ])
    assert.deepEqual(localVoiceCommand(text), {
      type: "camera_view",
      action: "left",
    });
  assert.deepEqual(localVoiceCommand("让画面放大"), {
    type: "camera_view",
    action: "zoom_in",
  });
  assert.deepEqual(localVoiceCommand("重新定一组目标，十二次"), {
    type: "new_set",
    target: 12,
    unit: "reps",
  });
  assert.deepEqual(localVoiceCommand("再来一组"), { type: "new_set" });
  assert.deepEqual(localVoiceCommand("这组目标改成十五次"), {
    type: "set_rep_goal",
    reps: 15,
  });
  for (const text of [
    "不要把画面向左移一点",
    "如果我动了就让画面放大",
    "明天再来一组十二次",
    "再来一组十二次然后休息",
    "他说把画面向左移一点",
    "能不能帮我把画面左移？",
  ])
    assert.equal(localVoiceCommand(text), null, text);
});
test("missing new goal asks for a value without touching the previous set", async () => {
  const { e } = session();
  e.acceptRep(row(1));
  const result = await coachTurn(
    "重新定一组目标",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async () => {
      throw Error("not needed");
    },
  );
  assert.match(result.text, /多少次/);
  assert.equal(e.rows.length, 1);
  assert.equal(e.pending.length, 0);
});
test("manual crop is independent of pose, pan at full view works and reaches source edge", () => {
  const f = new CameraFramer();
  const left = f.command("left");
  assert.equal(left.ok, true);
  assert.match(left.message, /向左取景/);
  assert.equal(f.snapshot().zoom, 1.1);
  const first = f.snapshot().x;
  assert.equal(f.command("left").ok, true);
  assert.ok(f.snapshot().x > first);
  assert.equal(f.command("left").ok, false);
  assert.equal(f.command("right").ok, true);
  for (let i = 0; i < 30; i++)
    f.command({ type: "camera_view", action: "zoom_in", adjustment: "step" });
  assert.equal(f.snapshot().zoom, 3);
  assert.equal(
    f.command({ type: "camera_view", action: "zoom_in", adjustment: "step" })
      .ok,
    false,
  );
  for (let i = 0; i < 30; i++)
    f.command({ type: "camera_view", action: "zoom_out", adjustment: "step" });
  assert.equal(f.snapshot().zoom, 1);
  assert.equal(f.snapshot().x, 0.5);
  f.command("auto");
  assert.equal(f.snapshot().automatic, true);
});
test("read-only streamed final formatting and missing tail recover without retrying the model", async () => {
  for (const [stream, final] of [
    ["保持呼吸。", "保持呼吸。\n"],
    ["保持呼吸。", "保持呼吸。站稳再开始。"],
  ]) {
    let calls = 0;
    const spoken: string[] = [];
    const { e } = session();
    const result = await coachTurn(
      "如何呼吸",
      e.snapshot(),
      async (raw) => e.dispatch(raw),
      async (_p, delta) => {
        calls++;
        delta?.(stream);
        return response(final);
      },
      [],
      () => false,
      { onSentence: (s) => spoken.push(s) },
    );
    assert.equal(calls, 1);
    assert.equal(result.text.trim(), final.trim());
    assert.equal(spoken.join("").trim(), final.trim());
  }
});
test("a completed revision is delivered, but a fabricated execution never is", async () => {
  for (const final of ["自然呼吸，不要憋气。", "已切换到深蹲。"]) {
    const { e } = session();
    const spoken: string[] = [];
    const result = await coachTurn(
      "如何呼吸",
      e.snapshot(),
      async (raw) => e.dispatch(raw),
      async (_p, delta) => {
        delta?.("保持呼吸。");
        return response(final);
      },
      [],
      () => false,
      { onSentence: (s) => spoken.push(s) },
    );
    if (final.startsWith("已")) assert.doesNotMatch(spoken.join(""), /已切换/);
    else {
      assert.equal(result.text, final);
      assert.match(spoken.join(""), /我更正一下：自然呼吸/);
    }
  }
});
test("side-view squat never assesses knee valgus from bilateral projected width", () => {
  assert.deepEqual(
    liveFaults("squat", { trunk_lean: 5, valgus_ratio: 0.1 }, "BOTTOM"),
    [],
  );
  assert.deepEqual(
    liveFaults("squat", { trunk_lean: 70, valgus_ratio: 0.1 }, "BOTTOM"),
    ["back_lean"],
  );
});
const audioEvents = (items: unknown[]) =>
  new Response(items.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
const audio = { type: "speech.audio.delta", audio: "AAA=", sample_rate: 16000 };
test("TTS retries a transient pre-audio failure once, with no duplicate audio", async () => {
  const original = globalThis.fetch;
  let attempts = 0,
    chunks = 0;
  try {
    globalThis.fetch = async () => {
      if (++attempts === 1) throw Error("connection reset");
      return audioEvents([audio, { type: "speech.audio.done" }]);
    };
    await service(
      "tts",
      { text: "准备好了", voice: COACH_VOICES[0].id },
      new AbortController().signal,
      () => {
        chunks++;
      },
    );
    assert.equal(attempts, 2);
    assert.equal(chunks, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("TTS never replays after partial audio or retries cancellation", async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = async () => {
      attempts++;
      return audioEvents([audio]);
    };
    await assert.rejects(
      service(
        "tts",
        { text: "准备好了", voice: COACH_VOICES[0].id },
        new AbortController().signal,
        () => {},
      ),
      /未完成/,
    );
    assert.equal(attempts, 1);
    const c = new AbortController();
    c.abort();
    await assert.rejects(service("tts", "取消", c.signal, () => {}));
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = original;
  }
});
