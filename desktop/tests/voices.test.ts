import { localServices } from "./fixtures/local-services";
import test from "node:test";
import assert from "node:assert/strict";
import { service, applyServiceConfig } from "../electron/services";
import { COACH_VOICES, DEFAULT_VOICE, coachVoice } from "../src/core/voices";
import { VoicePlayback } from "../src/media/playback";

applyServiceConfig(localServices());

test("TTS forwards the selected registered voice; older string calls use the default", async () => {
  assert.equal(DEFAULT_VOICE, "viaim-coach-female-w01-approved-v1");
  assert.deepEqual(
    COACH_VOICES.filter((v) => v.gender === "男声").map(
      (v) => v.name.split(" · ")[0],
    ),
    ["男声 1", "男声 2", "男声 3", "男声 4"],
  );
  const original = globalThis.fetch;
  assert.deepEqual(
    COACH_VOICES.filter((v) => v.gender === "女声").map(
      (v) => v.name.split(" · ")[0],
    ),
    ["女声 1", "女声 2", "女声 3", "女声 4"],
  );
  assert.equal(
    coachVoice("viaim-coach-male-p8-approved-v1").id,
    "viaim-coach-male-p8-approved-v1",
  );
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init!.body as string));
    return new Response(new Uint8Array([82, 73, 70, 70]));
  };
  try {
    for (const voice of COACH_VOICES) {
      await service(
        "tts",
        { text: "收紧核心。", voice: voice.id },
        new AbortController().signal,
      );
      assert.equal(bodies.at(-1).voice, voice.id);
      assert.equal(bodies.at(-1).speed, voice.speed);
      assert.equal(bodies.at(-1).ref_text, voice.referenceText);
      assert.equal(bodies.at(-1).input, "收紧核心。");
    }
    await service("tts", "保持呼吸。", new AbortController().signal);
    assert.equal(bodies.at(-1).voice, DEFAULT_VOICE);
    await assert.rejects(
      service(
        "tts",
        { text: "你好", voice: "unknown" },
        new AbortController().signal,
      ),
    );
    assert.equal(bodies.length, COACH_VOICES.length + 1);
    assert.equal(coachVoice("deleted-voice").id, DEFAULT_VOICE);
  } finally {
    globalThis.fetch = original;
  }
});

test("stopping synthesis prevents late audio from playing", async () => {
  const player = new VoicePlayback();
  let finish!: (bytes: Uint8Array) => void;
  let signal!: AbortSignal;
  const task = player.play((s) => {
    signal = s;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  assert.equal(player.active, true);
  player.stop();
  assert.equal(signal.aborted, true);
  finish(new Uint8Array());
  assert.equal(await task, false);
  assert.equal(player.active, false);
});

test("a cancelled old request cannot clear the new playback state", async () => {
  const player = new VoicePlayback();
  let first!: (bytes: Uint8Array) => void;
  let second!: (bytes: Uint8Array) => void;
  const a = player.play(
    () =>
      new Promise((resolve) => {
        first = resolve;
      }),
  );
  const b = player.play(
    () =>
      new Promise((resolve) => {
        second = resolve;
      }),
  );
  first(new Uint8Array());
  assert.equal(await a, false);
  assert.equal(player.active, true);
  player.stop();
  second(new Uint8Array());
  assert.equal(await b, false);
});

test("external cancellation aborts synthesis, including an already cancelled turn", async () => {
  const player = new VoicePlayback();
  const controller = new AbortController();
  controller.abort();
  let requested = false;
  assert.equal(
    await player.play(
      async () => {
        requested = true;
        return new Uint8Array();
      },
      undefined,
      controller.signal,
    ),
    false,
  );
  assert.equal(requested, false);
});
