import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { exerciseNarrationSource } from "../src/media/exercise-narration";
import { DEFAULT_VOICE } from "../src/core/voices";
import { appControls } from "./helpers/app-controls";
import { readPcmWav } from "../src/core/pcm-wav";

test("recording source reads only the selected bundled voice and yields complete PCM", async () => {
  const voice = "viaim-coach-male-p8-approved-v1";
  const bytes = await readFile(
    new URL(`../public/exercise-narration/${voice}/squat.wav`, import.meta.url),
  );
  let url = "",
    size = 0;
  await exerciseNarrationSource("squat", voice, async (input) => {
    url = String(input);
    return new Response(bytes);
  })(new AbortController().signal, (pcm, rate) => {
    size += pcm.length;
    assert.equal(rate, 24000);
  });
  assert.equal(url, `./exercise-narration/${voice}/squat.wav`);
  assert.equal(size, readPcmWav(bytes).pcm.length);
});
test("cancelled local audio cannot start late and missing audio never falls back to TTS", async () => {
  const controller = new AbortController();
  const bytes = await readFile(
    new URL(
      `../public/exercise-narration/${DEFAULT_VOICE}/squat.wav`,
      import.meta.url,
    ),
  );
  let pushed = false;
  await assert.rejects(
    exerciseNarrationSource("squat", DEFAULT_VOICE, async () => {
      controller.abort();
      return new Response(bytes);
    })(controller.signal, () => (pushed = true)),
    { name: "AbortError" },
  );
  assert.equal(pushed, false);
  await assert.rejects(
    exerciseNarrationSource(
      "squat",
      DEFAULT_VOICE,
      async () => new Response(null, { status: 404 }),
    )(new AbortController().signal, () => (pushed = true)),
    /本地讲解/,
  );
});
test("a new request interrupts the prerecorded explanation without replaying late audio", async () => {
  let release!: () => void;
  let pushed = false;
  let signal!: AbortSignal;
  const hold = new Promise<void>((r) => (release = r));
  const h = appControls({
    request: async () => {
      throw Error("no network expected");
    },
    narrationSource: () => async (s, push) => {
      signal = s;
      await hold;
      if (!s.aborted) {
        pushed = true;
        push(new Uint8Array([1, 0]), 24000);
      }
    },
  });
  const task = h.ask("讲一下深蹲的动作要点");
  for (let i = 0; i < 30 && !signal; i++) await Promise.resolve();
  assert.ok(signal);
  h.cancel();
  release();
  await task;
  assert.equal(signal.aborted, true);
  assert.equal(pushed, false);
});
