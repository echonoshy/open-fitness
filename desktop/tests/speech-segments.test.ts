import { localServices } from "./fixtures/local-services";
import test from "node:test";
import assert from "node:assert/strict";
import { splitSpeech, MAX_SPEECH_SEGMENT } from "../src/core/speech-segments";
import { readPcmWav, writePcmWav, joinPcmWavs } from "../src/core/pcm-wav";
import { service, applyServiceConfig } from "../electron/services";

applyServiceConfig(localServices());

test("long synthesis is bounded, preserves content and keeps decimal values", () => {
  for (const text of [
    "先站稳，放松肩膀。".repeat(20),
    "没有标点的很长一段中文".repeat(20),
    "Keep your back stable and lower slowly. ".repeat(20),
    "🙂".repeat(100),
  ]) {
    const parts = splitSpeech(text);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((p) => p.length <= MAX_SPEECH_SEGMENT));
    assert.equal(parts.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
    assert.ok(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p)));
  }
  assert.deepEqual(splitSpeech("重量是12.5公斤，慢慢下放。"), [
    "重量是12.5公斤，慢慢下放。",
  ]);
  assert.deepEqual(splitSpeech("  "), []);
});
test("WAV assembly uses PCM payloads and one header, and rejects malformed audio", () => {
  const a = writePcmWav(new Uint8Array([1, 0, 2, 0]), 24000),
    b = writePcmWav(new Uint8Array([3, 0]), 24000);
  assert.deepEqual(
    [...readPcmWav(joinPcmWavs([a, b], 0)).pcm],
    [1, 0, 2, 0, 3, 0],
  );
  assert.equal(readPcmWav(joinPcmWavs([a, b], 100)).pcm.length, 6 + 4800);
  assert.throws(() => readPcmWav(a.subarray(0, a.length - 1)), /不完整/);
  assert.throws(
    () => joinPcmWavs([a, writePcmWav(new Uint8Array([3, 0]), 48000)]),
    /采样率/,
  );
});
test("both streaming and buffered TTS send short ordered requests", async () => {
  const original = globalThis.fetch;
  try {
    const text = "双脚站稳，收紧躯干，缓慢下放再平稳站起。".repeat(8);
    const expected = splitSpeech(text);
    for (const streaming of [false, true]) {
      const sent: string[] = [],
        received: number[] = [];
      globalThis.fetch = async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)).input);
        const pcm = new Uint8Array([sent.length, 0]);
        return streaming
          ? new Response(
              `data: ${JSON.stringify({ type: "speech.audio.delta", audio: Buffer.from(pcm).toString("base64"), sample_rate: 24000 })}\n\ndata: {"type":"speech.audio.done"}\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            )
          : new Response(writePcmWav(pcm, 24000));
      };
      const result = await service(
        "tts",
        text,
        new AbortController().signal,
        streaming ? (chunk: any) => received.push(chunk.audio[0]) : undefined,
      );
      assert.deepEqual(sent, expected);
      if (streaming)
        assert.deepEqual(
          received,
          expected.map((_, i) => i + 1),
        );
      else
        assert.equal(
          readPcmWav(result as Uint8Array).pcm.length,
          expected.length * 2 + (expected.length - 1) * 5760,
        );
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("an interrupt between streamed segments prevents the remaining TTS requests", async () => {
  const original = globalThis.fetch,
    controller = new AbortController();
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        'data: {"type":"speech.audio.delta","audio":"AAA=","sample_rate":24000}\n\ndata: {"type":"speech.audio.done"}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    await assert.rejects(
      service("tts", "控制身体缓慢下降。".repeat(20), controller.signal, () =>
        controller.abort(),
      ),
      { name: "AbortError" },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
