import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { SessionEngine } from "../src/core/session";
import { coachTurn } from "../src/core/coach";
import { configureServices, service } from "../electron/services";
configureServices(process.env.COACH_SERVICES_CONFIG);
const cases: [string, string, unknown][] = [
  ["换成向上推举", "exercise", "shoulder_press"],
  ["这组做十五次", "goal", 15],
  ["开始休息", "remaining", 60],
  ["下放改成四秒", "tempo", 4],
  ["重量设为十公斤", "load", 10],
  ["关闭纠错提示", "cues", false],
  ["暂停训练", "status", "paused"],
  ["继续训练", "status", "training"],
  ["不要切换到俯卧撑", "exercise", "squat"],
  ["深蹲怎么做", "exercise", "squat"],
  ["换成弓步蹲，这组做十二次", "exercise", "lunge"],
];
const report: any[] = [];
for (const [text, key, expected] of cases) {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  const start = Date.now();
  const result = await coachTurn(
    text,
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    (p) => service("llm", p, new AbortController().signal),
  );
  const actual = (e.snapshot() as any)[key];
  const ok =
    key === "remaining" ? actual > 50 && actual <= 60 : actual === expected;
  report.push({
    text,
    expected,
    actual,
    ok,
    reply: result.text,
    elapsedMs: Date.now() - start,
  });
  console.log(JSON.stringify(report.at(-1)));
}
for (const phrase of ["换成向上推举，这组做十二次。", "开始休息一分钟。"]) {
  const audio = (await service(
    "tts",
    phrase,
    new AbortController().signal,
  )) as Uint8Array;
  const transcript = (await service(
    "asr",
    audio,
    new AbortController().signal,
  )) as string;
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.goal = 8;
  const result = await coachTurn(
    transcript,
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    (p) => service("llm", p, new AbortController().signal),
  );
  const replyAudio = (await service(
    "tts",
    result.text,
    new AbortController().signal,
  )) as Uint8Array;
  const ok = phrase.includes("推举")
    ? e.exercise === "shoulder_press" && e.goal === 12
    : e.snapshot().remaining > 40;
  report.push({
    kind: "synthetic_voice_e2e",
    phrase,
    transcript,
    reply: result.text,
    state: e.snapshot(),
    audioBytes: replyAudio.length,
    ok: ok && replyAudio.length > 44,
  });
  console.log(JSON.stringify(report.at(-1)));
}
await mkdir("output", { recursive: true });
await writeFile(
  "output/service-verification.json",
  JSON.stringify(report, null, 2),
);
assert.ok(report.every((r) => r.ok));
