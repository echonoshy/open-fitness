import test from "node:test";
import assert from "node:assert/strict";
import { appControls } from "./helpers/app-controls";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("voice interruption prevents a pending camera start from starting training", async () => {
  const camera = deferred();
  const h = appControls({
    startCamera: async () => {
      await camera.promise;
      h.engine.cameraReady = true;
    },
  });
  const start = h.dispatch(
    { type: "session", action: "start" },
    h.controller.current.signal,
  );
  h.cancel();
  camera.resolve();
  await assert.rejects(start, { name: "AbortError" });
  assert.equal(h.engine.active, false);
  assert.equal(h.engine.snapshot().status, "ready");
  h.controller.current = new AbortController();
  assert.equal(
    (
      await h.dispatch(
        { type: "session", action: "start" },
        h.controller.current.signal,
      )
    ).ok,
    true,
  );
  assert.equal(h.engine.active, true);
});

test("interrupting a voice turn does not cancel an independent manual start or roll back completed actions", async () => {
  const camera = deferred();
  const h = appControls({
    startCamera: async () => {
      await camera.promise;
      h.engine.cameraReady = true;
    },
  });
  const manual = h.dispatch({ type: "session", action: "start" });
  h.cancel();
  camera.resolve();
  assert.equal((await manual).ok, true);
  h.controller.current = new AbortController();
  await h.dispatch(
    { type: "session", action: "pause" },
    h.controller.current.signal,
  );
  h.cancel();
  assert.equal(h.engine.snapshot().status, "paused");
});

test("cancelled queued settings writes do not change preferences", async () => {
  const waiting = deferred();
  let saved = 0;
  const h = appControls({
    saveData: async () => {
      saved++;
    },
  });
  h.writes.current = waiting.promise;
  const write = h.dispatch(
    { type: "set_guidance", level: "quiet" },
    h.controller.current.signal,
  );
  h.cancel();
  waiting.resolve();
  await assert.rejects(write, { name: "AbortError" });
  assert.equal(saved, 0);
  assert.equal(h.dataRef.current.settings.guidance, "balanced");
});

test("App separates speech stop, persistent mute, reminder density and correction settings", async () => {
  const h = appControls();
  await h.dispatch({ type: "session", action: "start" });
  await h.dispatch({ type: "set_guidance", level: "quiet" });
  assert.equal(h.dataRef.current.settings.guidance, "quiet");
  assert.equal(h.engine.cues, true);
  const before = h.engine.snapshot().status;
  await h.dispatch({ type: "speech_control", action: "stop" });
  assert.equal(h.speechStopped.current, true);
  assert.equal(h.dataRef.current.settings.voice, true);
  assert.equal(h.engine.snapshot().status, before);
  assert.equal(h.playbackStops, 1);
  await h.dispatch({ type: "speech_control", action: "mute" });
  assert.equal(h.dataRef.current.settings.voice, false);
  await h.dispatch({ type: "speech_control", action: "unmute" });
  assert.equal(h.dataRef.current.settings.voice, true);
  assert.equal(h.speechStopped.current, false);
  assert.equal(h.engine.cues, true);
  assert.equal(h.engine.snapshot().status, before);
});

test("failed preference persistence cannot emit a success receipt or change the setting", async () => {
  const h = appControls({
    saveData: async () => {
      throw Error("disk unavailable");
    },
  });
  await assert.rejects(
    h.dispatch({ type: "set_guidance", level: "quiet" }),
    /disk unavailable/,
  );
  assert.equal(h.dataRef.current.settings.guidance, "balanced");
});

test("stopping speech stays silent, keeps a final text answer, and resumes on the next request", async () => {
  const spoken: string[] = [];
  const h = appControls({
    request: async (kind, p, _signal, chunk) => {
      if (kind === "tts") {
        spoken.push(p.text);
        chunk?.({
          type: "audio",
          audio: new Uint8Array([0, 0]),
          sampleRate: 24000,
        });
        return {};
      }
      assert.fail("local requests must not call the model");
    },
  });
  await h.ask("停止说话");
  assert.equal(h.speechStopped.current, true);
  assert.deepEqual(spoken, []);
  assert.match(h.history.current.at(-1)!.content, /已停止本次播报/);
  assert.equal(
    h.messages.some((m) => m.content.includes("本次回复未完成")),
    false,
  );
  await h.ask("开始训练");
  assert.equal(h.speechStopped.current, false);
  assert.ok(spoken.length > 0);
  assert.equal(h.engine.active, true);
});

test("cancelled model completion does not add late speech or a final reply to the App", async () => {
  const waiting = deferred();
  let requests = 0;
  const spoken: string[] = [];
  const h = appControls({
    request: async (kind, p, _signal, chunk) => {
      if (kind === "tts") {
        spoken.push(p.text);
        chunk?.({
          type: "audio",
          audio: new Uint8Array([0, 0]),
          sampleRate: 24000,
        });
        return {};
      }
      requests++;
      await waiting.promise;
      return {
        output: [
          {
            type: "function_call",
            name: "session",
            arguments: '{"action":"start"}',
            call_id: "late",
          },
        ],
      };
    },
  });
  const turn = h.ask("请帮我开始训练好吗？");
  await new Promise((r) => setImmediate(r));
  h.cancel();
  waiting.resolve();
  await turn;
  assert.equal(requests, 1);
  assert.equal(h.engine.active, false);
  assert.deepEqual(spoken, []);
  assert.deepEqual(h.history.current, []);
  assert.equal(h.messages.filter((m) => m.role === "assistant").length, 0);
});
