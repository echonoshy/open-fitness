import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  configureServices,
  service,
  diagnoseServices,
} from "../electron/services";
import { loadServiceConfig } from "../electron/service-config";
import {
  COACH_VOICES,
  DEFAULT_VOICE,
  agentPlanSpeaker,
} from "../src/core/voices";
import { readPcmWav, writePcmWav } from "../src/core/pcm-wav";
import { SessionEngine } from "../src/core/session";
import { coachTurn } from "../src/core/coach";

const path = process.env.COACH_SERVICES_CONFIG;
if (!path) throw Error("请设置 COACH_SERVICES_CONFIG 指向本机私有服务配置");
const config = loadServiceConfig(path);
assert.equal(config.asr.provider, "agent-plan");
assert.equal(config.tts.provider, "agent-plan");
configureServices(path);
const out = resolve("output/agent-plan-voice");
await mkdir(out, { recursive: true });
const rows: Record<string, unknown>[] = [];
async function record(
  name: string,
  action: () => Promise<Record<string, unknown>>,
) {
  const started = Date.now();
  try {
    rows.push({
      name,
      ok: true,
      ...(await action()),
      ms: Date.now() - started,
    });
  } catch (e) {
    rows.push({ name, ok: false, error: String(e), ms: Date.now() - started });
  }
  console.log(JSON.stringify(rows.at(-1)));
  await writeFile(
    resolve(out, "verification.json"),
    JSON.stringify(
      { at: new Date().toISOString(), physicalMicrophoneTest: false, rows },
      null,
      2,
    ),
  );
}

for (const voice of COACH_VOICES) {
  await record(`voice:${voice.id}`, async () => {
    const parts: Uint8Array[] = [],
      started = Date.now();
    let firstAudioMs: number | undefined;
    await service(
      "tts",
      { text: "双脚站稳，保持呼吸，我们开始训练。", voice: voice.id },
      AbortSignal.timeout(20000),
      (c: any) => {
        if (c.type !== "audio") return;
        assert.equal(c.sampleRate, 24000);
        firstAudioMs ??= Date.now() - started;
        parts.push(c.audio);
      },
    );
    const wav = writePcmWav(Buffer.concat(parts), 24000);
    assert.ok(wav.length > 1000);
    await writeFile(resolve(out, `${voice.id}.wav`), wav);
    return {
      speaker: agentPlanSpeaker(voice.id),
      firstAudioMs,
      audioBytes: wav.length,
    };
  });
}

for (const phrase of ["换成向上推举，这组做十二次。", "开始休息一分钟。"]) {
  await record(`roundtrip:${phrase}`, async () => {
    const wav = (await service(
      "tts",
      phrase,
      AbortSignal.timeout(20000),
    )) as Uint8Array;
    const asrStart = Date.now();
    const transcript = (await service(
      "asr",
      wav,
      AbortSignal.timeout(20000),
    )) as string;
    const asrMs = Date.now() - asrStart;
    const engine = new SessionEngine();
    engine.cameraReady = true;
    engine.dispatch({ type: "session", action: "start" });
    engine.goal = 8;
    const reply = await coachTurn(
      transcript,
      engine.snapshot(),
      async (raw) => engine.dispatch(raw),
      (p) => service("llm", p, AbortSignal.timeout(30000)),
    );
    if (phrase.includes("推举")) {
      assert.equal(engine.exercise, "shoulder_press");
      assert.equal(engine.goal, 12);
    } else assert.ok(engine.snapshot().remaining > 40);
    const audio = (await service(
      "tts",
      reply.text,
      AbortSignal.timeout(20000),
    )) as Uint8Array;
    assert.ok(readPcmWav(audio).pcm.length > 1000);
    await writeFile(
      resolve(
        out,
        phrase.includes("推举")
          ? "coach-reply-press.wav"
          : "coach-reply-rest.wav",
      ),
      audio,
    );
    return {
      transcript,
      asrMs,
      reply: reply.text,
      exercise: engine.exercise,
      goal: engine.goal,
      remaining: engine.snapshot().remaining,
      replyAudioBytes: audio.length,
    };
  });
}

await record("cancel-stream-after-first-audio", async () => {
  const controller = new AbortController();
  let chunks = 0;
  await assert.rejects(
    service(
      "tts",
      {
        text: "请保持稳定的呼吸。我们接下来慢慢下蹲，然后站起，继续保持这个节奏。",
        voice: DEFAULT_VOICE,
      },
      controller.signal,
      (c: any) => {
        if (c.type === "audio") {
          chunks++;
          controller.abort();
        }
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(chunks, 1);
  return { chunks };
});

await record("diagnostics", async () => {
  const results = await diagnoseServices();
  assert.ok(
    results.every((r) => r.ok),
    JSON.stringify(results),
  );
  return { services: results };
});
assert.ok(
  rows.every((r) => r.ok),
  "Agent Plan 语音实测有失败项，请查看 verification.json",
);
