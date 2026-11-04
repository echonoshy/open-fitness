import test from "node:test";
import assert from "node:assert/strict";
import { service, applyServiceConfig } from "../electron/services";
import { COACH_VOICES } from "../src/core/voices";
import { localServices } from "./fixtures/local-services";
applyServiceConfig(localServices());
const sse = (data: unknown[]) =>
  new Response(
    data.map((d) => "data: " + JSON.stringify(d) + "\n\n").join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
test("LLM streams deltas but rejects incomplete tool response", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      sse([{ type: "response.output_text.delta", delta: "已完成" }]);
    const chunks: unknown[] = [];
    await assert.rejects(
      service(
        "llm",
        { input: [], tools: [], tool_choice: "auto" },
        new AbortController().signal,
        (c) => chunks.push(c),
      ),
      /未完成/,
    );
    assert.equal(chunks.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("TTS streams PCM before done and preserves selected voice request", async () => {
  const original = globalThis.fetch;
  try {
    let payload: any;
    globalThis.fetch = async (_url, init) => {
      payload = JSON.parse(init!.body as string);
      return sse([
        {
          type: "speech.audio.delta",
          audio: Buffer.from([1, 2, 3, 4]).toString("base64"),
        },
        { type: "speech.audio.done" },
      ]);
    };
    const chunks: any[] = [];
    const result = await service(
      "tts",
      { text: "测试流式输出" },
      new AbortController().signal,
      (c) => chunks.push(c),
    );
    assert.equal(payload.stream, true);
    assert.equal(payload.response_format, "pcm");
    assert.equal(payload.stream_format, "sse");
    assert.deepEqual(chunks[0].audio, new Uint8Array([1, 2, 3, 4]));
    assert.equal(chunks[0].sampleRate, 48000);
    assert.deepEqual(result, { completed: true });
  } finally {
    globalThis.fetch = original;
  }
});
test("cancelled stream cannot report completion", async () => {
  const original = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async () =>
      sse([
        { type: "response.output_text.delta", delta: "内容" },
        {
          type: "response.completed",
          response: { status: "completed", output: [] },
        },
      ]);
    await assert.rejects(
      service(
        "llm",
        { input: [], tools: [], tool_choice: "auto" },
        controller.signal,
        () => controller.abort(),
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("every selected voice uses the server-supported speed for streamed speech", async () => {
  const original = globalThis.fetch;
  try {
    for (const voice of COACH_VOICES) {
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(init!.body as string);
        assert.equal(payload.voice, voice.id);
        assert.equal(payload.speed, 1);
        assert.equal(payload.stream, true);
        return sse([{ type: "speech.audio.done" }]);
      };
      await service(
        "tts",
        { text: "保持节奏。", voice: voice.id },
        new AbortController().signal,
        () => {},
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
