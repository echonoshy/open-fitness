import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { profilePath } from "../electron/profile-path";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { coachTurn } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";
import { WaitingFeedbackPhrases } from "../src/core/waiting-feedback";
import { coachVoice } from "../src/core/voices";
import { ReplySpeechQueue, type SpeechKind } from "../src/media/speech-queue";
import { TurnFeedback } from "../src/media/turn-feedback";
import { configureServices, service } from "../electron/services";

// Real services, isolated in-memory workout state. No microphone, speaker or
// user training records are changed. Saved PCM can be auditioned separately.
const userData = profilePath(join(homedir(), "Library/Application Support"));
const config =
  process.env.COACH_SERVICES_CONFIG ??
  join(userData, "services.json");
configureServices(config);
const settings = JSON.parse(
  await readFile(
    join(userData, "data.json"),
    "utf8",
  ),
).settings;
const voice = coachVoice(settings.coachVoice).id;
const directory = "output/waiting-feedback-20261027";
await mkdir(directory, { recursive: true });
const phrases = new WaitingFeedbackPhrases();
const report: any[] = [];

function wav(pcm: Uint8Array, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function run(text: string, index: number, cancelOnWaiting = false) {
  const engine = new SessionEngine();
  const controller = new AbortController();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const events: any[] = [],
    modelCalls: any[] = [],
    audio: any[] = [];
  const requests = new Set<Promise<unknown>>();
  let firstAudioMs: number | undefined, finalReadyMs: number | undefined;
  const queue = new ReplySpeechQueue(
    async (sentence, signal, push, kind) => {
      const chunks: Buffer[] = [];
      let rate = 48000,
        firstMs: number | undefined;
      const at = elapsed();
      const work = service(
        "tts",
        { text: sentence, voice },
        signal,
        (chunk: any) => {
          if (chunk.type !== "audio" || signal.aborted) return;
          firstMs ??= elapsed();
          rate = chunk.sampleRate;
          chunks.push(Buffer.from(chunk.audio));
          push(chunk.audio, rate);
        },
      );
      requests.add(work);
      try {
        await work;
      } finally {
        requests.delete(work);
        const pcm = Buffer.concat(chunks);
        const file = `${index}-${audio.length}-${kind}.wav`;
        audio.push({
          text: sentence,
          kind,
          at,
          firstMs,
          cancelled: signal.aborted,
          durationMs: Math.round((pcm.length / 2 / rate) * 1000),
          file: pcm.length ? file : undefined,
        });
        if (pcm.length) await writeFile(join(directory, file), wav(pcm, rate));
      }
    },
    (source) => source(controller.signal, () => {}),
    {
      onAudio: (sentence, kind) => {
        firstAudioMs ??= elapsed();
        events.push({ event: "audio", kind, text: sentence, ms: elapsed() });
        if (kind === "waiting") {
          phrases.remember(sentence);
          if (cancelOnWaiting) controller.abort();
        }
      },
    },
  );
  const feedback = new TurnFeedback(
    queue,
    controller.signal,
    () => true,
    (text, kind) =>
      events.push({ event: "display", kind, text, ms: elapsed() }),
    {
      waiting: (stage) =>
        phrases.choose({ request: text, exercise: engine.exercise, stage }),
      allowPreamble: (text) => phrases.allows(text),
      onWaiting: (source) =>
        events.push({ event: "waiting_queued", source, ms: elapsed() }),
    },
  );
  let result: Awaited<ReturnType<typeof coachTurn>> | undefined;
  let error: string | undefined;
  try {
    result = await coachTurn(
      text,
      engine.snapshot(),
      async (raw) => engine.dispatch(raw),
      async (payload, onText) => {
        const call = { choice: payload.tool_choice, at: elapsed(), end: 0 };
        modelCalls.push(call);
        try {
          // An explicit simulated delay makes cancellation deterministic without
          // claiming that the backend itself was slow in this case.
          if (cancelOnWaiting)
            await new Promise((resolve) => setTimeout(resolve, 1800));
          controller.signal.throwIfAborted();
          return await service(
            "llm",
            payload,
            AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
            (chunk: any) => {
              if (chunk.type === "text") onText?.(chunk.delta);
            },
          );
        } finally {
          call.end = elapsed();
        }
      },
      [],
      () => controller.signal.aborted,
      {
        onPreamble: (text) => feedback.preamble(text),
        onSentence: (text) => feedback.sentence(text),
        onProgress: (p) =>
          p.type === "receipt"
            ? feedback.progress(p.receipt.message)
            : feedback.query(p.text),
        query: async () => ({
          overview: { sets: 0, reps: 0 },
          records: [],
          range: { from: "2026-10-19", to: "2026-10-25" },
        }),
      },
    );
    finalReadyMs = elapsed();
    await feedback.finish(result.text);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (!controller.signal.aborted) throw e;
  } finally {
    feedback.dispose();
    await queue.finish().catch(() => {});
    await Promise.allSettled([...requests]);
  }
  // Drain any uncooperative late callbacks before recording the final result.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const item = {
    text,
    voice,
    cancelOnWaiting,
    firstAudioMs,
    finalReadyMs,
    elapsedMs: elapsed(),
    modelCalls,
    events,
    audio,
    reply: result?.text,
    error,
  };
  report.push(item);
  console.log(JSON.stringify(item));
  const heard = events.filter((e) => e.event === "audio");
  assert.ok(heard.filter((e) => e.kind === "waiting").length <= 1);
  if (cancelOnWaiting) {
    assert.ok(controller.signal.aborted);
    assert.ok(heard.every((e) => e.kind === "waiting"));
  } else {
    assert.ok(result?.text);
    assert.ok(
      heard.some(
        (e) =>
          e.kind === "answer" || e.kind === "final" || e.kind === "progress",
      ),
    );
  }
  if (text === "暂停训练") {
    assert.equal(modelCalls.length, 0);
    assert.ok(heard.every((e) => e.kind !== "waiting"));
  }
}

try {
  await run("为什么现在没有计数？", 0);
  await run("为什么现在没有计数？", 1);
  await run("帮我查一下上周的训练记录", 2);
  await run("暂停训练", 3);
  await run("饮食怎么安排？", 4);
  await run("为什么现在没有计数？", 5, true);
} finally {
  await writeFile(
    join(directory, "live-services.json"),
    JSON.stringify(report, null, 2),
  );
}
