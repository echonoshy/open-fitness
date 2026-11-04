import test from "node:test";
import assert from "node:assert/strict";
import { SpeechTurnDetector, isPlaybackEcho } from "../src/core/speech-turn";
import { wav } from "../src/media/audio";
const frame = (volume = 0.025) =>
  Float32Array.from({ length: 512 }, (_, i) => volume * Math.sin(i * 0.2));
test("speech interrupts during playback in 160ms without waiting for sentence end", () => {
  const d = new SpeechTurnDetector();
  let starts = 0;
  assert.equal(d.feed(frame(), 0.97, true), null);
  assert.deepEqual(d.feed(frame(), 0.97, true), {
    type: "candidate",
    overlap: true,
  });
  for (let i = 0; i < 2; i++) assert.equal(d.feed(frame(), 0.97, true), null);
  const event = d.feed(frame(), 0.97, true);
  assert.deepEqual(event, { type: "start", overlap: true });
  starts++;
  for (let i = 0; i < 15; i++) {
    const e = d.feed(frame(), 0.97, false);
    if (e?.type === "start") starts++;
  }
  assert.equal(starts, 1);
  assert.equal(d.active, true);
});
test("non-speech impacts and short probability spikes cannot interrupt", () => {
  const d = new SpeechTurnDetector();
  for (let i = 0; i < 30; i++)
    assert.equal(d.feed(frame(0.4), 0.2, true), null);
  for (let i = 0; i < 3; i++)
    assert.notEqual(d.feed(frame(0.4), 0.99, true)?.type, "start");
  const events = [];
  for (let i = 0; i < 24; i++)
    events.push(d.feed(frame(0.01), 0.1, true)?.type);
  assert.ok(events.includes("candidate_end"));
  assert.ok(!events.includes("start"));
  assert.equal(d.active, false);
});
test("moderate double-talk confidence with brief dips still interrupts within 320ms", () => {
  const d = new SpeechTurnDetector();
  const probabilities = [0.78, 0.82, 0.57, 0.76, 0.84, 0.73, 0.59, 0.79, 0.81];
  const events = probabilities.map((p) => d.feed(frame(), p, true)?.type);
  assert.equal(events[1], "candidate");
  assert.equal(events[8], "start");
  assert.equal(d.active, true);
});
test("sparse speech-like spikes do not accumulate into an interrupt or permanent duck", () => {
  const d = new SpeechTurnDetector();
  const events = [];
  for (let i = 0; i < 100; i++)
    events.push(d.feed(frame(), i % 4 < 2 ? 0.95 : 0.2, true)?.type);
  assert.ok(events.includes("candidate"));
  assert.ok(events.includes("candidate_end"));
  assert.ok(!events.includes("start"));
  assert.equal(d.active, false);
});
test("silence with a high model score cannot trigger, and unconfirmed speech retains its beginning", () => {
  const d = new SpeechTurnDetector();
  for (let i = 0; i < 12; i++) assert.equal(d.feed(frame(0), 0.95, true), null);
  const lead = frame(0.012);
  d.feed(lead, 0.4, true);
  for (const p of [0.78, 0.82, 0.57, 0.76, 0.84, 0.73, 0.59, 0.79, 0.81])
    d.feed(frame(), p, true);
  let captured: Float32Array | undefined;
  for (let i = 0; i < 21; i++) {
    const event = d.feed(frame(0), 0, false);
    if (event?.type === "end") captured = event.audio;
  }
  assert.ok(captured);
  // The 480ms pre-roll retains all nine decision frames and the first syllable.
  const offset = (15 - 10) * 512;
  assert.deepEqual(captured.slice(offset, offset + 512), lead);
});
test("pre-roll includes the first syllable and subsequent speech after cancellation", () => {
  const d = new SpeechTurnDetector();
  const lead = frame(0.012);
  d.feed(lead, 0.4, true);
  for (let i = 0; i < 5; i++) d.feed(frame(), 0.99, true);
  for (let i = 0; i < 7; i++) d.feed(frame(), 0.99, false);
  let end: ReturnType<SpeechTurnDetector["feed"]> = null;
  for (let i = 0; i < 21; i++) {
    const e = d.feed(frame(0), 0, false);
    if (e) end = e;
  }
  assert.equal(end?.type, "end");
  if (end?.type !== "end") throw Error("missing utterance");
  assert.equal(end.overlap, true);
  assert.deepEqual(end.audio.slice(0, 512), lead);
  assert.ok(end.audio.length > 512 * 12);
  const bytes = wav([end.audio], 16000);
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16000);
  assert.equal(bytes.length, end.audio.length * 2 + 44);
});
test("new utterance can interrupt an in-flight ASR even with no playback", () => {
  const d = new SpeechTurnDetector();
  let ends = 0,
    starts = 0;
  for (let turn = 0; turn < 2; turn++) {
    for (let i = 0; i < 5; i++)
      if (d.feed(frame(), 0.97, false)?.type === "start") starts++;
    for (let i = 0; i < 21; i++)
      if (d.feed(frame(0), 0, false)?.type === "end") ends++;
  }
  assert.equal(starts, 2);
  assert.equal(ends, 2);
});
test("continuous utterances are bounded at 15 seconds", () => {
  const d = new SpeechTurnDetector();
  let end: ReturnType<SpeechTurnDetector["feed"]> = null;
  for (let i = 0; i < 480; i++) {
    const e = d.feed(frame(), 0.97, false);
    if (e?.type === "end") {
      end = e;
      break;
    }
  }
  assert.equal(end?.type, "end");
  if (end?.type === "end") assert.ok(end.audio.length <= 16000 * 15 + 512);
});
test("reset discards unfinished capture and permits fresh speech", () => {
  const d = new SpeechTurnDetector();
  for (let i = 0; i < 5; i++) d.feed(frame(), 0.99, true);
  d.reset();
  assert.equal(d.active, false);
  for (let i = 0; i < 3; i++) d.feed(frame(), 0.9, false);
  assert.equal(d.active, true);
});
test("residual echo filtering never eats short or different instructions", () => {
  const spoken = ["本组目标已设为十二次，请保持自然呼吸。"];
  assert.ok(isPlaybackEcho("本组目标已设为十二次", spoken));
  for (const text of ["停", "不要", "设置十次", "改成肩上推举，做二十次"])
    assert.equal(isPlaybackEcho(text, spoken), false);
});
