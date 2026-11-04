import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as ort from "onnxruntime-web/wasm";
import { Silero } from "@ricky0123/vad-web/dist/models/silero.js";
import { Resampler } from "@ricky0123/vad-web/dist/resampler.js";
import { SpeechTurnDetector } from "../src/core/speech-turn";

// Real packaged neural inference on prerecorded speech, not a physical double-talk test.
ort.env.wasm.numThreads = 1;
const bytes = await readFile("public/vad/silero_vad_v5.onnx");
const model = await Silero.new(ort, async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const wav = await readFile("public/voices/viaim-coach-female-w01-approved-v1.wav");
let rate = 0, channels = 0, pcm: Buffer | undefined;
for (let p = 12; p + 8 <= wav.length;) {
  const size = wav.readUInt32LE(p + 4);
  const type = wav.toString("ascii", p, p + 4);
  if (type === "fmt ") {
    assert.equal(wav.readUInt16LE(p + 8), 1);
    channels = wav.readUInt16LE(p + 10);
    rate = wav.readUInt32LE(p + 12);
    assert.equal(wav.readUInt16LE(p + 22), 16);
  }
  if (type === "data") pcm = wav.subarray(p + 8, p + 8 + size);
  p += 8 + size + (size % 2);
}
assert.ok(pcm && rate && channels);
const audio = Float32Array.from({ length: pcm.length / 2 / channels }, (_, i) => pcm!.readInt16LE(i * 2 * channels) / 32768);
const resampler = new Resampler({ nativeSampleRate: rate, targetSampleRate: 16000, targetFrameSize: 512 });
const silence = Array.from({ length: 40 }, () => new Float32Array(512));
const detector = new SpeechTurnDetector();
let playing = true, frames = 0;
const events: { type: string; seconds: number; overlap: boolean }[] = [];
const started = performance.now();
try {
  for (const frame of [...silence, ...resampler.process(audio), ...silence]) {
    const p = await model.process(frame);
    const event = detector.feed(frame, p.isSpeech, playing);
    frames++;
    if (!event) continue;
    events.push({ type: event.type, seconds: frames * 0.032, overlap: event.overlap });
    if (event.type === "start") playing = false;
  }
  assert.ok(events.some((e) => e.type === "start" && e.overlap));
  assert.ok(events.some((e) => e.type === "end"));
  assert.ok(events[0].seconds > 1.28, "silence must not interrupt");
  const result = { at: new Date().toISOString(), frames, inferenceMs: Math.round(performance.now() - started), events, physicalDoubleTalk: false };
  await mkdir("output", { recursive: true });
  await writeFile("output/barge-in-model.json", JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await model.release();
}
