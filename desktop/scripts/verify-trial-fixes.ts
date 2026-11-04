import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { SessionEngine } from "../src/core/session";
import { CameraFramer, cameraCommandSchema } from "../src/core/camera-framing";
import { coachTurn } from "../src/core/coach";
import { configureServices, service } from "../electron/services";
import { DEFAULT_VOICE } from "../src/core/voices";

configureServices(process.env.COACH_SERVICES_CONFIG);
const report: unknown[] = [];
function harness() {
  const engine = new SessionEngine(),
    framer = new CameraFramer();
  engine.cameraReady = true;
  engine.dispatch({ type: "session", action: "start" });
  for (let count = 1; count <= 13; count++)
    engine.acceptRep({
      count,
      duration: 3,
      eccentric_s: 1.5,
      concentric_s: 1.5,
      min_angle: 80,
      full_depth: true,
      score: 100,
      faults: [],
    });
  engine.counter.count = 13;
  const history: { role: string; content: string }[] = [];
  const snapshot = () => ({
    ...engine.snapshot(),
    cameraView: { ...framer.snapshot(), cameraOn: true },
  });
  const ask = async (text: string) => {
    const commands: unknown[] = [],
      decisions: string[] = [],
      flags: string[][] = [];
    let requests = 0;
    const start = Date.now();
    const result = await coachTurn(
      text,
      snapshot(),
      async (raw) => {
        commands.push(raw);
        const parsed = cameraCommandSchema.safeParse(raw);
        if (parsed.success && parsed.data.type === "camera_view")
          return { ...framer.command(parsed.data), state: snapshot() };
        return engine.dispatch(raw);
      },
      async (p, delta) => {
        requests++;
        return service("llm", p, AbortSignal.timeout(20000), (chunk: any) => {
          if (chunk.type === "text") delta?.(chunk.delta);
        });
      },
      history,
      () => false,
      { diagnose: (f) => flags.push(f), onDecision: (t) => decisions.push(t) },
    );
    history.push(
      { role: "user", content: text },
      { role: "assistant", content: result.text },
    );
    const observation = {
      text,
      reply: result.text,
      requests,
      ms: Date.now() - start,
      commands,
      decisions,
      flags,
      reps: engine.counter.count,
      goal: engine.goal,
      savedReps: engine.pending.map((r) => r.reps.length),
      view: framer.snapshot(),
    };
    report.push(observation);
    console.log(JSON.stringify(observation));
    return observation;
  };
  return { engine, framer, ask };
}
const cases: [string, (h: ReturnType<typeof harness>) => boolean][] = [
  ["帮我把取景窗口向右移动一点", (h) => h.framer.snapshot().x < 0.5],
  ["能帮我让镜头向右看一些吗？", (h) => h.framer.snapshot().x < 0.5],
  [
    "我想再做一组深蹲，重新给我定十二次的目标",
    (h) =>
      h.engine.counter.count === 0 &&
      h.engine.goal === 12 &&
      h.engine.pending[0]?.reps.length === 13,
  ],
  ["能不能帮我把画面往左移动一点？", (h) => h.framer.snapshot().x > 0.5],
  ["我想把画面往右挪一点", (h) => h.framer.snapshot().x < 0.5],
  ["能帮我把画面放大一些吗？", (h) => (h.framer.snapshot().targetSubjectRatio ?? 0) > 0.65],
  ["让画面里的我向左挪一点", (h) => h.framer.snapshot().x < 0.5],
  [
    "不要放大，也不要开始新一组",
    (h) => h.framer.snapshot().zoom === 1 && h.engine.counter.count === 13,
  ],
  [
    "这组的目标帮我改到十五次，已有的次数保留",
    (h) => h.engine.goal === 15 && h.engine.counter.count === 13,
  ],
];
let failures = 0;
for (const [text, check] of cases) {
  const h = harness();
  await h.ask(text);
  if (!check(h)) {
    failures++;
    console.error("FAILED", text);
  }
}
const conversation = harness();
await conversation.ask("重新定一组目标");
assert.equal(conversation.engine.counter.count, 13);
await conversation.ask("十二次");
if (!(
  conversation.engine.counter.count === 0 && conversation.engine.goal === 12
))
  failures++;

if (process.argv.includes("--voice")) {
  for (const phrase of [
    "把画面向左移动一点。",
    "重新开始一组，目标十二次。",
    "让画面放大一点。",
  ]) {
    const h = harness();
    const audio = (await service(
      "tts",
      { text: phrase, voice: DEFAULT_VOICE },
      AbortSignal.timeout(20000),
    )) as Uint8Array;
    const transcript = (await service(
      "asr",
      audio,
      AbortSignal.timeout(15000),
    )) as string;
    const observed = await h.ask(transcript);
    const ok = phrase.includes("左")
      ? h.framer.snapshot().x > 0.5
      : phrase.includes("一组")
        ? h.engine.counter.count === 0 && h.engine.goal === 12
        : (h.framer.snapshot().targetSubjectRatio ?? 0) > 0.65;
    let replyBytes = 0;
    await service(
      "tts",
      { text: observed.reply, voice: DEFAULT_VOICE },
      AbortSignal.timeout(20000),
      (chunk: any) => {
        if (chunk.type === "audio") replyBytes += chunk.audio.length;
      },
    );
    report.push({
      kind: "synthetic_voice",
      phrase,
      transcript,
      replyBytes,
      ok,
    });
    if (!ok || !replyBytes) failures++;
  }
}
await mkdir("output/trial-fixes-20261026", { recursive: true });
await writeFile(
  "output/trial-fixes-20261026/live-service-verification.json",
  JSON.stringify({ failures, report }, null, 2),
);
assert.equal(failures, 0, "Real service behavioral checks failed");
