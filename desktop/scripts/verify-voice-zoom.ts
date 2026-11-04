import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { CameraFramer, cameraCommandSchema } from "../src/core/camera-framing";
import { SessionEngine } from "../src/core/session";
import { coachTurn } from "../src/core/coach";
import { configureServices, service } from "../electron/services";
import { DEFAULT_VOICE } from "../src/core/voices";
import type { Point } from "../src/core/engine";

configureServices(process.env.COACH_SERVICES_CONFIG);
const directory = "output/voice-zoom-20261026";
await mkdir(directory, { recursive: true });
const reports: unknown[] = [];
function harness() {
  const f = new CameraFramer(),
    e = new SessionEngine();
  e.cameraReady = true;
  const points: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
    z: 0,
  }));
  for (const [i, x, y] of [
    [0, 0.5, 0.3],
    [11, 0.46, 0.36],
    [12, 0.54, 0.36],
    [23, 0.47, 0.5],
    [24, 0.53, 0.5],
    [27, 0.47, 0.7],
    [28, 0.53, 0.7],
  ])
    points[i] = { x, y, visibility: 0.95, z: 0 };
  let time = 0;
  const settle = () => {
    for (let i = 0; i < 250; i++)
      f.update(points, (time += 0.04), {
        exercise: "squat",
        training: false,
        set: "one",
      });
  };
  settle();
  const state = () => ({
    ...e.snapshot(),
    cameraView: { ...f.snapshot(), cameraOn: true },
  });
  const history: { role: string; content: string }[] = [];
  const ask = async (text: string) => {
    const commands: unknown[] = [];
    let requests = 0;
    const result = await coachTurn(
      text,
      state(),
      async (raw) => {
        commands.push(raw);
        const c = cameraCommandSchema.parse(raw);
        assert.equal(c.type, "camera_view", "Only camera framing may change");
        return {
          ...f.command(c as Extract<typeof c, { type: "camera_view" }>),
          state: state(),
        };
      },
      async (payload, onText) => {
        requests++;
        return service(
          "llm",
          payload,
          AbortSignal.timeout(30000),
          (chunk: any) => {
            if (chunk.type === "text") onText?.(chunk.delta);
          },
        );
      },
      history,
    );
    settle();
    history.push(
      { role: "user", content: text },
      { role: "assistant", content: result.text },
    );
    const report = {
      text,
      reply: result.text,
      requests,
      commands,
      receipts: result.receipts.map(({ ok, message }) => ({ ok, message })),
      view: f.snapshot(),
    };
    reports.push(report);
    console.log(JSON.stringify(report));
    return report;
  };
  return { f, ask };
}
try {
  const h = harness();
  const enlarged = await h.ask("能不能帮我把画面里的我放大一些？");
  assert.equal(enlarged.requests > 0, true);
  assert.equal(h.f.snapshot().automatic, true);
  assert.ok(h.f.snapshot().subjectRatio! > 0.73);
  const fine = harness();
  const fineReply = await fine.ask(
    "请稍稍放大一点点，保持跟随，别一下变得太大",
  );
  assert.ok(
    (fineReply.commands as any[]).some(
      (c) => c.action === "zoom_in" && c.adjustment === "fine",
    ),
  );
  assert.ok(
    fine.f.snapshot().subjectRatio! > 0.7 &&
      fine.f.snapshot().subjectRatio! < 0.73,
  );
  const exact = harness();
  await exact.ask("帮我直接调到一点五倍大小，继续跟着我");
  assert.ok(Math.abs(exact.f.snapshot().zoom - 1.5) < 0.01);
  assert.equal(exact.f.snapshot().automatic, true);
  await exact.ask("刚才放得太大了，帮我恢复上一次画面");
  assert.ok(Math.abs(exact.f.snapshot().subjectRatio! - 0.65) < 0.01);
  const fixed = harness();
  fixed.f.command("lock");
  await fixed.ask("在现在的基础上把画面放大一倍");
  assert.equal(fixed.f.snapshot().zoom, 3);
  assert.equal(fixed.f.snapshot().automatic, false);
  const untouched = { ...fixed.f.snapshot() };
  const negative = await fixed.ask("不要放大，也不要恢复自动取景");
  assert.equal(negative.commands.length, 0);
  assert.equal(fixed.f.snapshot().automatic, untouched.automatic);
  assert.equal(fixed.f.snapshot().targetZoom, untouched.targetZoom);
  assert.ok(Math.abs(fixed.f.snapshot().y - untouched.y) < 0.00001);
  if (process.argv.includes("--voice")) {
    for (const phrase of [
      "放大到一点五倍。",
      "稍微放大一点。",
      "太大了，回到刚才。",
    ]) {
      const voice = harness();
      voice.f.command("zoom_in");
      const audio = (await service(
        "tts",
        { text: phrase, voice: DEFAULT_VOICE },
        AbortSignal.timeout(30000),
      )) as Uint8Array;
      const transcript = (await service(
        "asr",
        audio,
        AbortSignal.timeout(20000),
      )) as string;
      const result = await voice.ask(transcript);
      const command = (result.commands as any[])[0];
      if (phrase.includes("一点五")) assert.equal(command?.zoom, 1.5);
      else if (phrase.includes("稍微"))
        assert.equal(command?.adjustment, "fine");
      else assert.equal(command?.action, "undo");
      let replyBytes = 0;
      await service(
        "tts",
        { text: result.reply, voice: DEFAULT_VOICE },
        AbortSignal.timeout(30000),
        (chunk: any) => {
          if (chunk.type === "audio") replyBytes += chunk.audio.length;
        },
      );
      assert.ok(replyBytes > 0);
      reports.push({ kind: "synthetic_voice", phrase, transcript, replyBytes });
    }
  }
} finally {
  await writeFile(
    `${directory}/model-verification.json`,
    JSON.stringify(reports, null, 2) + "\n",
  );
}
