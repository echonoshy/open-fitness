import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { configureServices, service } from "../electron/services";
import { coachTurn } from "../src/core/coach";
import { DEFAULT_VOICE } from "../src/core/voices";
import { appControls } from "../tests/helpers/app-controls";

// Real configured services; disposable app state, no microphone or user data writes.
const config = process.argv[2];
if (!config) throw Error("Pass the service configuration path explicitly.");
configureServices(resolve(config));
const out = resolve("output/background-blur-voice-20261028");
mkdirSync(out, { recursive: true });
const rows: unknown[] = [];
const cases: {
  text: string;
  before: boolean;
  after: boolean;
  mutate: boolean;
  audio?: boolean;
  cameraOff?: boolean;
}[] = [
  {
    text: "打开背景虚化",
    before: false,
    after: true,
    mutate: true,
    audio: true,
  },
  {
    text: "关闭背景虚化",
    before: true,
    after: false,
    mutate: true,
    audio: true,
  },
  {
    text: "恢复清晰背景",
    before: true,
    after: false,
    mutate: true,
    audio: true,
  },
  {
    text: "能帮我把背景恢复清晰吗？",
    before: true,
    after: false,
    mutate: true,
  },
  {
    text: "后面的房间有点乱，帮我把背景模糊一下，训练继续",
    before: false,
    after: true,
    mutate: true,
  },
  { text: "先别打开背景虚化", before: false, after: false, mutate: false },
  { text: "不要关闭背景虚化", before: true, after: true, mutate: false },
  { text: "等会儿再打开背景虚化", before: false, after: false, mutate: false },
  {
    text: "他说打开背景虚化是什么意思？不要操作",
    before: false,
    after: false,
    mutate: false,
  },
  {
    text: "支持背景虚化吗？怎么开？",
    before: false,
    after: false,
    mutate: false,
  },
  { text: "背景虚化现在开着吗？", before: false, after: false, mutate: false },
  {
    text: "背景虚化现在开着吗？",
    before: true,
    after: true,
    mutate: false,
    cameraOff: true,
  },
];
let failed = 0;
for (const c of cases) {
  const h = appControls();
  h.engine.now = () => 100;
  h.engine.cameraReady = !c.cameraOff;
  if (!c.cameraOff) {
    h.engine.dispatch({ type: "session", action: "start" });
    h.engine.preparing = false;
    h.engine.counter.count = 6;
  }
  h.framer.command({ type: "camera_view", action: "lock" });
  h.dataRef.current.settings.backgroundBlur = c.before;
  const training = h.engine.snapshot(),
    framing = h.framer.snapshot();
  let transcript = c.text,
    reply = "",
    error: string | undefined;
  const decisions: string[] = [],
    flags: string[][] = [];
  const started = Date.now();
  try {
    if (c.audio) {
      const wav = (await service(
        "tts",
        { text: c.text, voice: DEFAULT_VOICE },
        AbortSignal.timeout(30000),
      )) as Uint8Array;
      writeFileSync(resolve(out, `command-${rows.length + 1}.wav`), wav);
      const asr: any = await service("asr", wav, AbortSignal.timeout(30000));
      transcript = typeof asr === "string" ? asr : asr.text;
      assert.ok(transcript);
    }
    reply = (
      await coachTurn(
        transcript,
        h.snapshot(),
        h.dispatch,
        (p, onText) =>
          service("llm", p, AbortSignal.timeout(30000), (chunk: any) => {
            if (chunk.type === "text") onText?.(chunk.delta);
          }),
        [],
        undefined,
        {
          currentState: h.snapshot,
          onDecision: (name) => decisions.push(name),
          diagnose: (f) => flags.push(f),
        },
      )
    ).text;
    assert.equal(h.dataRef.current.settings.backgroundBlur, c.after);
    assert.deepEqual(
      h.commands,
      c.mutate ? [{ type: "background_blur", enabled: c.after }] : [],
    );
    assert.deepEqual(h.engine.snapshot(), training);
    assert.deepEqual(h.framer.snapshot(), framing);
    assert.equal(h.dataRef.current.settings.voice, true);
    assert.ok(!flags.flat().includes("unconfirmed_execution"));
    if (c.cameraOff) assert.match(reply, /摄像头|下次/);
    if (c.audio) {
      const wav = (await service(
        "tts",
        { text: reply, voice: DEFAULT_VOICE },
        AbortSignal.timeout(30000),
      )) as Uint8Array;
      assert.ok(wav.length > 44);
      writeFileSync(resolve(out, `receipt-${rows.length + 1}.wav`), wav);
    }
  } catch (e) {
    error = String(e);
    failed++;
  }
  const row = {
    ...c,
    transcript,
    reply,
    commands: h.commands,
    decisions,
    flags,
    ms: Date.now() - started,
    pass: !error,
    error,
  };
  rows.push(row);
  writeFileSync(resolve(out, "services.json"), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
}
console.log(
  JSON.stringify({ passed: cases.length - failed, total: cases.length }),
);
if (failed) process.exitCode = 1;
