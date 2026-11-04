import test from "node:test";
import assert from "node:assert/strict";
import {
  InteractionCoach,
  checkedNarration,
  narrate,
  guidancePreference,
  type Scene,
  type Notice,
} from "../src/core/interaction";
import { SessionEngine } from "../src/core/session";
import { PreambleStream, safePreamble } from "../src/core/preamble";
import { coachTurn } from "../src/core/coach";
import { ProactiveVoice } from "../src/media/proactive-voice";
import { dataSchema } from "../src/core/data";

function scene(now = 0): Scene {
  const state = new SessionEngine().snapshot();
  return {
    session: "session",
    set: "set",
    now,
    camera: true,
    state: {
      ...state,
      exercise: "curl",
      status: "training",
      tracking: true,
      squatCheck: undefined,
      goal: 12,
    },
  };
}
test("prepared announcement happens once per set, even after tracking recovers", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.preparing = true;
  guide.observe(s);
  s.state.preparing = false;
  s.now = 1;
  guide.observe(s);
  const first = guide.take(s)!;
  assert.equal(first.key, "prepared");
  guide.spoken(first, first.fact, s.now);
  s.now = 40;
  s.state.preparing = true;
  guide.observe(s);
  s.now = 41;
  s.state.preparing = false;
  guide.observe(s);
  assert.notEqual(guide.take(s)?.key, "prepared");
  s.set = "next";
  s.now = 60;
  s.state.preparing = true;
  guide.observe(s);
  s.now = 61;
  s.state.preparing = false;
  guide.observe(s);
  assert.equal(guide.take(s)?.key, "prepared");
});
const response = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
const call = (name: string, args = {}) => ({
  type: "function_call",
  name,
  call_id: name,
  arguments: JSON.stringify(args),
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

test("natural preamble is streamed before tool completion, same decision rounds retained", async () => {
  const e = new SessionEngine();
  let rounds = 0;
  const spoken: string[] = [];
  const result = await coachTurn(
    "把目标调整到十次",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async (payload: any, onText) => {
      rounds++;
      if (rounds === 1) {
        assert.equal(payload.tool_choice, "auto");
        onText?.("我来调整这组的目标。");
        assert.deepEqual(spoken, ["我来调整这组的目标。"]);
        assert.equal(e.goal, 12);
        return { output: [call("set_rep_goal", { reps: 10 })] };
      }
      return response("已设置。");
    },
    [],
    () => false,
    { onPreamble: (t) => spoken.push(t) },
  );
  assert.equal(rounds, 2);
  assert.equal(e.goal, 10);
  assert.match(result.text, /10次/);
});
test("prose-only first round is forced back through the original tool decision", async () => {
  const e = new SessionEngine();
  const choices: string[] = [];
  const r = await coachTurn(
    "把目标调整到十次",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async (p: any) => {
      choices.push(p.tool_choice);
      if (choices.length === 1) return response("已经设置为十次了。");
      if (choices.length === 2)
        return { output: [call("set_rep_goal", { reps: 10 })] };
      return response("好了。");
    },
  );
  assert.deepEqual(choices, ["auto", "required", "auto"]);
  assert.equal(e.goal, 10);
  assert.equal(r.receipts.length, 1);
});
test("preamble suppresses results, numbers, protocol and late output", () => {
  for (const bad of [
    "已经设置好了。",
    "我查到你完成了十次。",
    "我来确认一下，你上周做了40次。",
    "<tool_call>",
    "稍等，我来确认一下。\n已完成。",
  ])
    assert.equal(safePreamble(bad), "");
  assert.ok(safePreamble("我先核对一下上周的深蹲记录。"));
  const spoken: string[] = [];
  let cancelled = false;
  const stream = new PreambleStream(
    (t) => spoken.push(t),
    () => cancelled,
  );
  stream.consume("我来看看");
  cancelled = true;
  stream.consume("你的记录。");
  assert.deepEqual(spoken, []);
});
test("balanced whole set has at most two milestones and at least 14 seconds between speech", () => {
  const guide = new InteractionCoach();
  const s = scene();
  guide.observe(s);
  const spoken: Notice[] = [];
  for (let rep = 1; rep <= 12; rep++) {
    s.state.reps = rep;
    s.now = rep * 4;
    guide.observe(s);
    const n = guide.take(s);
    if (n) {
      spoken.push(n);
      guide.spoken(n, n.fact, s.now);
    }
  }
  assert.deepEqual(
    spoken.map((n) => n.count),
    [6, 10],
  );
  assert.ok(spoken.every((n) => n.kind === "milestone"));
});
test("quiet keeps phase and correction prompts, no count chatter", () => {
  const guide = new InteractionCoach();
  guide.level = "quiet";
  const s = scene();
  guide.observe(s);
  s.state.reps = 6;
  s.now = 30;
  guide.observe(s);
  assert.equal(guide.take(s), undefined);
  guide.offer("goal", "目标已达到", s);
  assert.equal(guide.take(s)?.kind, "goal");
});
test("goal delivery survives a busy conversation and changing counts without stale rep claims", () => {
  const guide = new InteractionCoach();
  const s = scene(20);
  s.state.reps = 12;
  guide.offer("goal", "本组12次的目标已达到。", s, {
    key: "goal-reached",
    completionTarget: 12,
    expires: Infinity,
    status: undefined,
    natural: false,
  });
  guide.userSpoke(20);
  s.now = 24;
  assert.equal(guide.take(s), undefined);
  s.state.reps = 27;
  s.now = 80;
  const pending = guide.take(s)!;
  assert.equal(pending.kind, "goal");
  assert.match(pending.fact, /12次的目标/);
  guide.userSpoke(80);
  s.now = 90;
  assert.equal(
    guide.take(s),
    pending,
    "cancelled generation can retry before any audio",
  );
  guide.spoken(pending, pending.fact, s.now);
  assert.equal(guide.take(s), undefined, "spoken goals are never replayed");
});
test("undelivered goals cannot leak into another set or survive a changed target", () => {
  for (const change of ["set", "target", "end", "mute"]) {
    const guide = new InteractionCoach();
    const s = scene(20);
    s.state.reps = 12;
    guide.offer("goal", "本组目标已达到", s, {
      completionTarget: 12,
      expires: Infinity,
      status: undefined,
    });
    if (change === "set") s.set = "new-set";
    if (change === "target") s.state.goal = 20;
    if (change === "end") s.state.status = "ready";
    if (change === "mute") guide.clear();
    assert.equal(guide.take(s), undefined, change);
  }
});
test("fast counts expire rather than speaking an obsolete count after model latency", () => {
  const guide = new InteractionCoach();
  const s = scene();
  guide.observe(s);
  s.now = 20;
  s.state.reps = 6;
  guide.observe(s);
  const n = guide.take(s)!;
  assert.equal(n.count, 6);
  s.state.reps = 7;
  assert.equal(guide.valid(n, s), false);
  assert.equal(guide.valid(n, s, true), true);
  s.state.status = "resting";
  assert.equal(guide.valid(n, s, true), false);
});
test("no praise or count cue under occlusion, positioning failure or a form fault", () => {
  for (const blocked of ["tracking", "fault", "position"]) {
    const guide = new InteractionCoach();
    const s = scene();
    guide.observe(s);
    s.now = 20;
    s.state.reps = 6;
    if (blocked === "tracking") s.state.tracking = false;
    if (blocked === "fault") s.state.faults = ["back_round"];
    if (blocked === "position") s.state.trackingNotice = "请回到起始位置";
    guide.observe(s);
    assert.equal(guide.take(s), undefined);
  }
});
test("transient faults stay silent; sustained fault priority and 25 second repetition limit", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.faults = ["back_round", "elbow_flare"];
  guide.observe(s);
  s.now = 1;
  guide.observe(s);
  assert.equal(guide.take(s), undefined);
  s.now = 2;
  guide.observe(s);
  const n = guide.take(s)!;
  assert.equal(n.fault, "back_round");
  // Another observe while speech is pending must not create a replay after it.
  guide.observe(s);
  guide.spoken(n, n.fact, s.now);
  s.state.faults = ["back_round"];
  s.now = 12;
  guide.observe(s);
  assert.equal(guide.take(s), undefined);
  s.now = 28;
  guide.observe(s);
  assert.equal(guide.take(s)?.fault, "back_round");
});
test("positioning is stable, bounded, and invalid once the user is visible", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.tracking = false;
  guide.observe(s);
  s.now = 3;
  guide.observe(s);
  const n = guide.take(s)!;
  assert.equal(n.kind, "position");
  s.state.tracking = true;
  assert.equal(guide.valid(n, s), false);
});
test("user priority drops queued counts and leaves eight seconds after the reply", () => {
  const guide = new InteractionCoach();
  const s = scene(20);
  guide.offer("milestone", "已经完成6次", s);
  guide.userSpoke(20);
  assert.equal(guide.take(s), undefined);
  guide.offer("goal", "目标已达到", s);
  s.now = 27;
  assert.equal(guide.take(s), undefined);
  s.now = 28;
  assert.equal(guide.take(s)?.kind, "goal");
});
test("long rests get one heads-up; short rests and expired countdowns don't", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.status = "resting";
  s.state.remaining = 30;
  guide.observe(s);
  s.now = 20;
  s.state.remaining = 10;
  guide.observe(s);
  const n = guide.take(s)!;
  assert.equal(n.kind, "rest");
  guide.spoken(n, n.fact, s.now);
  s.now = 25;
  s.state.remaining = 5;
  guide.observe(s);
  assert.equal(guide.take(s), undefined);
  assert.equal(guide.valid(n, s), false);
  s.now = 30;
  s.state.status = "training";
  guide.observe(s);
  s.now = 35;
  assert.equal(guide.take(s)?.kind, "start");
  const short = new InteractionCoach();
  s.state.status = "resting";
  s.state.remaining = 8;
  short.observe(s);
  assert.equal(short.take(s), undefined);
});
test("plank progress uses observed effective seconds, not wall time", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.exercise = "plank";
  guide.observe(s);
  s.now = 30;
  s.state.hold = 15;
  guide.observe(s);
  const n = guide.take(s)!;
  assert.match(n.fact, /15秒/);
  s.state.hold = 18;
  assert.equal(guide.valid(n, s), false);
});
test("welcome only once; finished session clears queued encouragement", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.status = "ready";
  guide.welcome(s, true);
  const welcome = guide.take(s)!;
  assert.match(welcome.fact, /欢迎回来/);
  guide.welcome(s, true);
  assert.equal(guide.take(s), undefined);
  guide.offer("milestone", "已经完成6次", s);
  guide.offer("finish", "训练结束", s);
  assert.equal(guide.take(s)?.kind, "finish");
  assert.equal(guide.take(s), undefined);
});
test("stale session, exercise, status and disabled cues cannot speak", () => {
  const guide = new InteractionCoach();
  const s = scene();
  s.state.faults = ["back_round"];
  guide.offer("correction", "保持背部平直", s, { fault: "back_round" });
  const n = guide.take(s)!;
  for (const change of [
    () => (s.set = "next"),
    () => (s.state.exercise = "squat"),
    () => (s.state.cues = false),
    () => (s.camera = false),
  ]) {
    const original = structuredClone(s);
    change();
    assert.equal(guide.valid(n, s), false);
    Object.assign(s, original);
  }
});
test("model wording cannot alter measurements or claim posture correctness", async () => {
  const guide = new InteractionCoach();
  const s = scene();
  guide.offer("milestone", "已经完成4次", s);
  const n = guide.take(s)!;
  assert.equal(
    checkedNarration("按你的节奏继续。", n),
    "已经完成4次，按你的节奏继续。",
  );
  for (const bad of [
    "已经完成5次。",
    "嗯，这就对了，继续。",
    "这段做得挺稳的，给自己点掌声。",
    "这一段做完了，挺不错的。",
    "{{事实}}，再做六次。",
    "{{事实}}，动作很标准。",
    "{{事实}}，已帮你加重量。",
    "{{事实}}{{事实}}",
  ])
    assert.equal(checkedNarration(bad, n), "");
  const text = await narrate(n, [], async (p: any) => {
    assert.equal(p.tool_choice, "none");
    assert.deepEqual(p.tools, []);
    return response("保持自己的节奏。");
  });
  assert.equal(text, "已经完成4次，保持自己的节奏。");
});
test("user interruption during generation defeats an uncooperative late producer", async () => {
  const voice = new ProactiveVoice();
  const held = deferred<string>();
  const spoken: string[] = [];
  const run = voice.run(
    () => held.promise,
    async (text) => {
      spoken.push(text);
    },
    () => true,
    () => {},
  );
  voice.cancel();
  held.resolve("过时鼓励");
  await run;
  assert.deepEqual(spoken, []);
  assert.equal(voice.busy, false);
});
test("stale generated narration never starts TTS; active playback aborts on phase change", async () => {
  const voice = new ProactiveVoice();
  let valid = true;
  let played = 0;
  await voice.run(
    async () => {
      valid = false;
      return "旧次数";
    },
    async () => {
      played++;
    },
    () => valid,
    () => {},
  );
  assert.equal(played, 0);
  valid = true;
  const held = deferred<void>();
  let signal!: AbortSignal;
  const running = voice.run(
    async () => "新进度",
    async (_text, s, first) => {
      signal = s;
      first();
      await held.promise;
    },
    () => valid,
    () => {},
  );
  await Promise.resolve();
  await Promise.resolve();
  valid = false;
  voice.validate();
  assert.equal(signal.aborted, true);
  held.resolve();
  await running;
});
test("guidance setting validates and survives data roundtrip without a migration", () => {
  for (const guidance of ["quiet", "balanced", "active"])
    assert.equal(
      dataSchema.parse({ settings: { voice: true, guidance }, records: [] })
        .settings.guidance,
      guidance,
    );
  assert.equal(
    dataSchema.parse({ settings: {}, records: [] }).settings.guidance,
    undefined,
  );
  assert.equal(
    dataSchema.safeParse({ settings: { guidance: "spam" }, records: [] })
      .success,
    false,
  );
});
test("spoken guidance preference shortcuts are exact, never infer from negation or questions", () => {
  assert.equal(guidancePreference("少说一点。"), "quiet");
  assert.equal(guidancePreference("多鼓励我"), "active");
  assert.equal(guidancePreference("恢复适中提醒"), "balanced");
  for (const text of [
    "不要少说一点",
    "能少说一点吗",
    "少说一点是什么意思",
    "少说一点然后结束训练",
  ])
    assert.equal(guidancePreference(text), undefined);
});
test("repeated companion phrases are omitted without regenerating or repeating numbers", async () => {
  const guide = new InteractionCoach(),
    s = scene();
  guide.offer("milestone", "已经完成6次", s);
  let calls = 0;
  const text = await narrate(
    guide.take(s)!,
    ["已经完成4次，慢慢来，别着急。"],
    async () => {
      calls++;
      return response("慢慢来，我陪你。");
    },
  );
  assert.equal(text, "");
  assert.equal(calls, 1);
});
