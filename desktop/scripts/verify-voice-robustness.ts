import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { coachTurn, tools as coachTools } from "../src/core/coach";
import { queryData } from "../src/core/coach-data";
import { relevantKnowledge } from "../src/core/knowledge";
import { service, configureServices } from "../electron/services";
import { appControls } from "../tests/helpers/app-controls";
import { DEFAULT_VOICE } from "../src/core/voices";

// Explicit opt-in: these are real API requests, against disposable in-memory data.
const config = process.argv[2];
if (!config || config.startsWith("--"))
  throw Error(
    "Usage: tsx scripts/verify-voice-robustness.ts <services.json> [--group=semantic|regression|interrupt|audio]",
  );
configureServices(resolve(config));
const out = resolve("output/voice-fix-20261027");
mkdirSync(out, { recursive: true });
const library = readFileSync("public/knowledge.json", "utf8");
const originalFetch = globalThis.fetch;
globalThis.fetch = ((url: any, options: any) =>
  url === "./knowledge.json"
    ? Promise.resolve(new Response(library))
    : originalFetch(url, options)) as typeof fetch;
type Harness = ReturnType<typeof setup>;
type Case = {
  text: string;
  mode?: string;
  check: (h: Harness, reply: string) => void;
};
function setup(mode = "training", startCamera?: () => Promise<void>) {
  const h = appControls({ startCamera });
  const e = h.engine;
  e.now = () => 100;
  e.cameraReady = mode !== "camera_off";
  if (mode === "plank") e.exercise = "plank";
  if (mode === "plan")
    e.dispatch({
      type: "start_program",
      blocks: [{ exercise: "squat", sets: 2, target: 12, rest: 60, load: 0 }],
    });
  else if (!["ready", "camera_off"].includes(mode))
    e.dispatch({ type: "session", action: "start" });
  if (e.active) {
    e.preparing = false;
    e.tracking = true;
    if (mode !== "plank") {
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
    }
  }
  if (mode === "paused") e.dispatch({ type: "session", action: "pause" });
  if (mode === "resting") e.dispatch({ type: "rest_timer", seconds: 60 });
  const now = new Date();
  const weekday = (now.getDay() + 6) % 7;
  const lastWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - weekday - 3,
    12,
  );
  h.dataRef.current.records = [
    {
      ...e.currentRecord(),
      id: "synthetic-test-history",
      exercise: "squat",
      startedAt: lastWeek.toISOString(),
      duration: 60,
      goal: 12,
    },
  ];
  h.dataRef.current.profile = [
    {
      category: "equipment",
      key: "家中器械",
      value: "只有哑铃",
      updatedAt: now.toISOString(),
    },
  ];
  return h;
}
function status(h: Harness, s: string) {
  assert.equal(h.snapshot().status, s);
}
function noMutation(h: Harness) {
  assert.deepEqual(h.commands, []);
  status(h, "training");
}
function paused(h: Harness) {
  status(h, "paused");
  assert.equal(h.snapshot().reps, 6);
}
function ended(h: Harness) {
  status(h, "ready");
  assert.ok(
    h.dataRef.current.records.some(
      (r) => r.id !== "synthetic-test-history" && r.reps.length === 6,
    ),
  );
}
function quiet(h: Harness) {
  assert.equal(h.dataRef.current.settings.guidance, "quiet");
  assert.equal(h.engine.cues, true);
  status(h, "training");
}
function silent(h: Harness) {
  assert.equal(h.speechStopped.current, true);
  assert.equal(h.engine.cues, true);
  assert.equal(h.dataRef.current.settings.voice, true);
  status(h, "training");
}
const semantic: Case[] = [
  ...[
    "停止",
    "停下来",
    "停",
    "先停一下",
    "暂停一下",
    "请停下来",
    "能帮我暂停一下吗？",
    "先停下来，等我喝口水",
  ].map((text) => ({ text, check: paused })),
  ...[
    "不做了",
    "不练了",
    "停止训练",
    "结束训练",
    "今天就到这里",
    "我今天不想练了，帮我结束并保存",
  ].map((text) => ({ text, check: ended })),
  ...[
    "别停",
    "不要停止训练",
    "先别结束训练",
    "我不是要停止训练",
    "如果累了就停下来",
    "他说停下来",
    "不用暂停，我还能继续",
    "等一下再停止训练",
    "“停止训练”这四个字是什么意思？不要操作",
    "我在复述电影台词：停下来！这不是训练指令",
    "不要停止说话",
    "少说一点是什么意思？",
    "不要记住我有杠铃，这是举个例子",
    "不要放大，我只是问能放多大",
  ].map((text) => ({ text, check: noMutation })),
  ...[
    "少说一点",
    "请少说一点",
    "提醒少一点",
    "不要一直鼓励我",
    "我想让你少说一点，但不要关掉纠错提示",
  ].map((text) => ({ text, check: quiet })),
  ...[
    "停止说话",
    "别说了，训练继续",
    "我不是说停止训练，我是让你停止说话",
    "请不要暂停，也不要结束，我只是想让你安静一会儿",
  ].map((text) => ({ text, check: silent })),
  ...[
    "我没有受伤，可以继续训练吗？",
    "胸痛是什么意思？",
    "如果出现胸痛应该怎么办？",
    "我朋友说他呼吸困难",
    "如果受伤了还能继续练吗？",
    "我昨天胸痛，今天已经好了",
    "没有胸痛",
  ].map((text) => ({
    text,
    check: (h: Harness) => {
      status(h, "training");
      assert.ok(
        !h.commands.some(
          (c: any) =>
            c.type === "session" && ["pause", "end"].includes(c.action),
        ),
      );
    },
  })),
  ...["我现在胸痛", "没有胸痛，但是呼吸困难", "我受伤了还想继续训练"].map(
    (text) => ({ text, check: paused }),
  ),
  ...[
    "我没有出现胸痛",
    "我不觉得胸痛",
    "胸痛已经好了",
    "他说停下来",
    "她刚才说停止训练",
    "教练说停止训练是什么意思？",
  ].map((text) => ({ text, check: noMutation })),
  ...[
    "他说停下来，我也要暂停",
    "我没有受伤，但我现在想暂停一下",
    "不要结束训练，只暂停一下",
  ].map((text) => ({ text, check: paused })),
  {
    text: "帮我暂停训练，然后告诉我现在做了几次",
    check: (h, r) => {
      paused(h);
      assert.match(r, /6次/);
    },
  },
  {
    text: "把这组目标改成十五次，再告诉我还差几次",
    check: (h, r) => {
      assert.equal(h.snapshot().goal, 15);
      assert.equal(h.snapshot().reps, 6);
      assert.match(r, /9次|九次/);
    },
  },
  {
    text: "暂停训练，查一下上周深蹲的平均得分",
    check: (h, r) => {
      paused(h);
      assert.match(r, /95/);
    },
  },
  {
    text: "请暂停，然后告诉我杠铃六十公斤怎么配片",
    check: (h, r) => {
      paused(h);
      assert.match(r, /每侧|每边/);
      assert.match(r, /20|二十/);
    },
  },
  {
    text: "不做深蹲了，换成俯卧撑",
    check: (h) => {
      assert.equal(h.engine.exercise, "pushup");
      assert.equal(h.engine.active, true);
    },
  },
  {
    text: "不休息了，继续练",
    mode: "resting",
    check: (h) => status(h, "training"),
  },
  {
    text: "新一组先不要开始，目标改成十五次",
    check: (h) => {
      assert.equal(h.snapshot().goal, 15);
      assert.equal(h.snapshot().reps, 6);
    },
  },
  {
    text: "关掉摄像头，但继续听我说话",
    check: (h) => {
      paused(h);
      assert.equal(h.engine.cameraReady, false);
      assert.ok(!h.commands.some((c: any) => c.type === "speech_control"));
    },
  },
  {
    text: "先暂停，再把提醒改得少一点",
    check: (h) => {
      paused(h);
      assert.equal(h.dataRef.current.settings.guidance, "quiet");
      assert.equal(h.engine.cues, true);
    },
  },
];
const regression: Case[] = [
  ...["我现在做了几次？", "我已经完成几次了？"].map((text) => ({
    text,
    check: (h: Harness, r: string) => {
      noMutation(h);
      assert.match(r, /6|六/);
      assert.doesNotMatch(r, /缺少可核对|未执行/);
    },
  })),
  {
    text: "训练已经开始了吗？",
    check: (h, r) => {
      noMutation(h);
      assert.match(r, /开始|训练中|训练正在|训练已在进行/);
      assert.doesNotMatch(r, /缺少可核对|未执行/);
    },
  },
  {
    text: "当前摄像头已经开启了吗？",
    check: (h, r) => {
      noMutation(h);
      assert.match(r, /开启|开着|打开/);
      assert.doesNotMatch(r, /缺少可核对|未执行/);
    },
  },
  {
    text: "再来一组十五次",
    check: (h) => {
      assert.equal(h.snapshot().goal, 15);
      assert.equal(h.snapshot().reps, 0);
      assert.equal(h.engine.active, true);
    },
  },
  {
    text: "开始一组俯卧撑，做八次",
    mode: "ready",
    check: (h) => {
      assert.equal(h.engine.exercise, "pushup");
      assert.equal(h.snapshot().goal, 8);
      assert.equal(h.engine.active, true);
    },
  },
  {
    text: "停止跟随",
    check: (h) => {
      assert.equal(h.framer.snapshot().automatic, false);
      status(h, "training");
    },
  },
  {
    text: "放大到两倍",
    check: (h, r) => {
      assert.ok(
        h.commands.some(
          (c: any) =>
            c.type === "camera_view" && c.action === "zoom_to" && c.zoom === 2,
        ),
      );
      assert.equal(h.framer.snapshot().zoom, 1);
      status(h, "training");
      assert.match(r, /等|站稳/);
    },
  },
  {
    text: "缩小一半",
    check: (h) => {
      status(h, "training");
      assert.ok(h.commands.some((c: any) => c.type === "camera_view"));
    },
  },
  { text: "把声音放大一点", check: (h) => noMutation(h) },
  {
    text: "帮我关闭纠错提示",
    check: (h) => {
      assert.equal(h.engine.cues, false);
      assert.equal(h.dataRef.current.settings.guidance, "balanced");
    },
  },
  {
    text: "打开自动识别",
    mode: "ready",
    check: (h) => assert.equal(h.engine.auto, true),
  },
  {
    text: "打开自动识别",
    check: (h, r) => {
      assert.equal(h.engine.auto, false);
      assert.equal(h.snapshot().reps, 6);
      assert.match(r, /开始.*前|当前组/);
    },
  },
  { text: "重量设成十公斤", check: (h) => assert.equal(h.engine.load, 10) },
  { text: "下放改成四秒", check: (h) => assert.equal(h.engine.tempo, 4) },
  {
    text: "开始休息半分钟",
    check: (h) => {
      status(h, "resting");
      assert.equal(h.snapshot().remaining, 30);
    },
  },
  {
    text: "看看我上周的深蹲记录",
    check: (h, r) => {
      noMutation(h);
      assert.match(r, /6|六|95/);
    },
  },
  {
    text: "只用哑铃可以做哪些胸部动作？",
    check: (h, r) => {
      noMutation(h);
      assert.match(r, /哑铃/);
      assert.doesNotMatch(r, /缺少可核对/);
    },
  },
  {
    text: "我只有哑铃，记住这一点",
    check: (h) => assert.ok(h.commands.some((c: any) => c.type === "remember")),
  },
  {
    text: "忘记我家只有哑铃这条信息",
    check: (h) => assert.equal(h.dataRef.current.profile?.length, 0),
  },
  {
    text: "我的长期资料里记了什么？",
    check: (h, r) => {
      noMutation(h);
      assert.match(r, /哑铃/);
    },
  },
  {
    text: "杆重二十公斤，总重六十公斤，每边怎么配片？",
    check: (h, r) => {
      noMutation(h);
      assert.match(r, /20|二十/);
      assert.match(r, /每边|每侧/);
    },
  },
  { text: "不做了", mode: "plan", check: ended },
  { text: "先停一下", mode: "plan", check: paused },
  {
    text: "结束这个训练计划",
    mode: "plan",
    check: (h) => {
      ended(h);
      assert.equal(h.engine.program, null);
    },
  },
  {
    text: "开始自重计划：深蹲两组，每组十二次，休息六十秒；俯卧撑两组，每组八次，休息六十秒",
    mode: "ready",
    check: (h) => {
      assert.equal(h.engine.active, true);
      assert.ok(h.snapshot().program);
    },
  },
  {
    text: "给我讲讲两组深蹲每组十二次、两组俯卧撑每组八次的计划好不好，先不要开始",
    mode: "ready",
    check: (h) => {
      status(h, "ready");
      assert.deepEqual(h.commands, []);
    },
  },
  {
    text: "平板支撑改成四十五秒",
    mode: "plank",
    check: (h) => assert.equal(h.engine.holdGoal, 45),
  },
  {
    text: "继续",
    mode: "paused",
    check: (h) => {
      status(h, "training");
      assert.equal(h.snapshot().reps, 6);
    },
  },
  {
    text: "关闭所有语音播报",
    check: (h) => {
      assert.equal(h.dataRef.current.settings.voice, false);
      assert.equal(h.engine.cues, true);
      status(h, "training");
    },
  },
  {
    text: "恢复语音播报",
    check: (h) => {
      assert.equal(h.dataRef.current.settings.voice, true);
      assert.equal(h.speechStopped.current, false);
    },
  },
  {
    text: "把主动提醒设为积极",
    check: (h) => assert.equal(h.dataRef.current.settings.guidance, "active"),
  },
  {
    text: "打开摄像头",
    mode: "camera_off",
    check: (h) => {
      assert.equal(h.engine.cameraReady, true);
      status(h, "ready");
    },
  },
];
let requests = 0;
let failed = 0;
async function model(
  p: unknown,
  onText?: (s: string) => void,
  signal?: AbortSignal,
) {
  requests++;
  return service(
    "llm",
    p,
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
    (chunk: any) => {
      if (chunk.type === "text") onText?.(chunk.delta);
    },
  );
}
async function runCases(group: string, cases: Case[]) {
  const match = process.argv.find((a) => a.startsWith("--match="))?.slice(8);
  if (match) {
    cases = cases.filter((c) => new RegExp(match).test(c.text));
    group += "-focused";
  }
  if (!cases.length) throw Error("No verification cases matched");
  const rows: any[] = [];
  for (const [index, c] of cases.entries()) {
    const h = setup(c.mode);
    const started = Date.now();
    const beforeRequests = requests;
    const decisions: string[] = [];
    const outputs: any[] = [];
    const flags: string[][] = [];
    let reply = "";
    let error: string | undefined;
    try {
      reply = (
        await coachTurn(
          c.text,
          h.snapshot(),
          (raw) => h.dispatch(raw, h.controller.current.signal),
          async (p, delta) => {
            const r: any = await model(p, delta, h.controller.current.signal);
            outputs.push(r.output);
            return r;
          },
          [],
          () => h.controller.current.signal.aborted,
          {
            profile: h.dataRef.current.profile,
            query: (raw) =>
              queryData(
                raw,
                h.dataRef.current.records,
                h.dataRef.current.profile ?? [],
              ),
            knowledge: await relevantKnowledge(c.text, h.engine.exercise),
            onDecision: (n) => decisions.push(n),
            diagnose: (f) => flags.push(f),
          },
        )
      ).text;
      c.check(h, reply);
    } catch (e) {
      error = String(e);
    }
    if (error) failed++;
    const row = {
      index,
      text: c.text,
      mode: c.mode ?? "training",
      pass: !error,
      error,
      reply,
      decisions,
      commands: h.commands,
      flags,
      state: h.snapshot(),
      requests: requests - beforeRequests,
      outputs,
      ms: Date.now() - started,
    };
    rows.push(row);
    writeFileSync(
      resolve(out, `verified-${group}.json`),
      JSON.stringify(rows, null, 2),
    );
    if (error)
      console.log(
        JSON.stringify({
          group,
          index,
          text: c.text,
          error,
          reply,
          commands: h.commands,
          flags,
        }),
      );
    else if ((index + 1) % 10 === 0)
      console.log(
        JSON.stringify({ group, complete: index + 1, total: cases.length }),
      );
  }
  console.log(
    JSON.stringify({
      group,
      total: rows.length,
      passed: rows.filter((r) => r.pass).length,
      requests,
      decisionTools: [...new Set(rows.flatMap((r) => r.decisions))],
      registeredTools: coachTools.length,
    }),
  );
}
async function runInterrupt() {
  const rows: any[] = [];
  for (const scenario of [
    "before_dispatch",
    "camera_pending",
    "after_pause",
    "inflight_request",
  ]) {
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const h = setup(
      scenario === "camera_pending" ? "camera_off" : "training",
      async () => {
        await wait;
        h.engine.cameraReady = true;
      },
    );
    let responseSeen = false,
      lateSentence = false;
    const signal = h.controller.current.signal;
    let error = "",
      returned = false;
    const started = Date.now();
    const beforeRequests = requests;
    try {
      const turn = coachTurn(
        scenario === "camera_pending"
          ? "请帮我现在开始深蹲训练"
          : scenario === "after_pause"
            ? "请暂停训练，然后告诉我做了几次"
            : "麻烦帮我暂停一下好吗？",
        h.snapshot(),
        async (raw) => {
          if (scenario === "camera_pending") {
            const pending = h.dispatch(raw, signal);
            h.cancel();
            release();
            return pending;
          }
          const receipt = await h.dispatch(raw, signal);
          if (scenario === "after_pause") h.cancel();
          return receipt;
        },
        async (p, delta) => {
          if (scenario === "inflight_request") {
            const pending = model(p, delta, signal);
            setTimeout(() => h.cancel(), 100);
            return pending;
          }
          const result = await model(p, delta, signal);
          responseSeen = true;
          if (scenario === "before_dispatch") h.cancel();
          return result;
        },
        [],
        () => signal.aborted,
        {
          onSentence: () => {
            if (signal.aborted) lateSentence = true;
          },
        },
      );
      await turn;
      returned = true;
    } catch (e) {
      error = String(e);
    }
    let failure: string | undefined;
    try {
      assert.equal(returned, false);
      assert.equal(signal.aborted, true);
      assert.equal(lateSentence, false);
      assert.match(error, /取消|abort/i);
      if (scenario === "after_pause") paused(h);
      else if (scenario === "camera_pending") {
        status(h, "ready");
        assert.equal(h.engine.active, false);
      } else {
        status(h, "training");
        assert.deepEqual(h.commands, []);
      }
      if (scenario !== "inflight_request") assert.equal(responseSeen, true);
    } catch (e) {
      failure = String(e);
    }
    if (failure) failed++;
    const row = {
      scenario,
      pass: !failure,
      failure,
      error,
      responseSeen,
      commands: h.commands,
      state: h.snapshot().status,
      lateSentence,
      requests: requests - beforeRequests,
      ms: Date.now() - started,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  writeFileSync(
    resolve(out, "verified-interrupt.json"),
    JSON.stringify(rows, null, 2),
  );
}
async function runAudio() {
  const cases: Case[] = [
    { text: "停下来", check: paused },
    { text: "不做了", check: ended },
    { text: "别停", check: noMutation },
    { text: "不要停止训练", check: noMutation },
    { text: "停止说话", check: silent },
    { text: "提醒少一点", check: quiet },
    {
      text: "暂停，然后告诉我做了几次",
      check: (h, r) => {
        paused(h);
        assert.match(r, /6次/);
      },
    },
    {
      text: "不休息了，继续练",
      mode: "resting",
      check: (h) => status(h, "training"),
    },
  ];
  const rows: any[] = [];
  for (const c of cases) {
    const h = setup(c.mode);
    let transcript: any,
      reply = "",
      error: string | undefined;
    const started = Date.now();
    try {
      const wav = (await service(
        "tts",
        { text: c.text, voice: DEFAULT_VOICE },
        AbortSignal.timeout(30000),
      )) as Uint8Array;
      transcript = await service("asr", wav, AbortSignal.timeout(30000));
      const text =
        typeof transcript === "string" ? transcript : transcript.text;
      assert.ok(text);
      reply = (await coachTurn(text, h.snapshot(), (r) => h.dispatch(r), model))
        .text;
      c.check(h, reply);
    } catch (e) {
      error = String(e);
    }
    if (error) failed++;
    const row = {
      text: c.text,
      transcript,
      reply,
      pass: !error,
      error,
      commands: h.commands,
      ms: Date.now() - started,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  writeFileSync(
    resolve(out, "verified-audio.json"),
    JSON.stringify(rows, null, 2),
  );
}
const group = process.argv.find((a) => a.startsWith("--group="))?.slice(8);
if (group && !["semantic", "regression", "interrupt", "audio"].includes(group))
  throw Error("Unknown verification group");
if (!group || group === "semantic") await runCases("semantic", semantic);
if (!group || group === "regression") await runCases("regression", regression);
if (!group || group === "interrupt") await runInterrupt();
if (!group || group === "audio") await runAudio();
if (failed) process.exitCode = 1;
