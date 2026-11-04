import test from "node:test";
import assert from "node:assert/strict";
import { appControls } from "./helpers/app-controls";
import { DEFAULT_VOICE } from "../src/core/voices";
import type { Data } from "../src/platform";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const devices = [
  { kind: "videoinput" as const, deviceId: "camera", label: "viaim Camera" },
  { kind: "audioinput" as const, deviceId: "mic", label: "viaim Microphone" },
  { kind: "audiooutput" as const, deviceId: "speaker", label: "Speaker" },
];

test("device refresh cannot undo an in-flight mute, blur or voice preference save", async () => {
  const writing = deferred(),
    release = deferred(),
    enumerated = deferred();
  const saved: Data[] = [];
  const h = appControls({
    saveData: async (d) => {
      if (!saved.length) {
        writing.resolve();
        await release.promise;
      }
      saved.push(structuredClone(d));
    },
    enumerateDevices: async () => {
      enumerated.resolve();
      return devices;
    },
  });
  const settings = h.persist((d) => ({
    ...d,
    settings: {
      ...d.settings,
      voice: false,
      backgroundBlur: false,
      coachVoice: DEFAULT_VOICE,
      guidance: "quiet",
    },
  }));
  await writing.promise;
  const refresh = h.enumerate();
  await enumerated.promise;
  release.resolve();
  await Promise.all([settings, refresh]);
  assert.equal(h.dataRef.current.settings.voice, false);
  assert.equal(h.dataRef.current.settings.backgroundBlur, false);
  assert.equal(h.dataRef.current.settings.coachVoice, DEFAULT_VOICE);
  assert.equal(h.dataRef.current.settings.guidance, "quiet");
  assert.equal(h.dataRef.current.settings.camera, "camera");
  assert.equal(h.dataRef.current.settings.microphone, "mic");
  assert.deepEqual(saved.at(-1), h.dataRef.current);
});

test("refresh resolves the latest queued output selection and preserves completed training records", async () => {
  const release = deferred(),
    enumerated = deferred();
  const h = appControls({
    enumerateDevices: async () => {
      enumerated.resolve();
      return devices;
    },
  });
  await h.dispatch({ type: "session", action: "start" });
  const id = h.engine.recordId;
  h.engine.acceptRep({
    count: 1,
    duration: 3,
    eccentric_s: 2,
    concentric_s: 1,
    min_angle: 80,
    full_depth: true,
    faults: [],
    score: 100,
  });
  h.writes.current = release.promise;
  const ending = h.dispatch({ type: "session", action: "end" });
  const choosing = h.persist((d) => ({
    ...d,
    settings: {
      ...d.settings,
      speaker: "old-speaker",
      speakerLabel: "Speaker",
    },
  }));
  const refresh = h.enumerate();
  await enumerated.promise;
  release.resolve();
  await Promise.all([ending, choosing, refresh]);
  assert.equal(h.dataRef.current.settings.speaker, "speaker");
  assert.equal(h.dataRef.current.records.length, 1);
  assert.equal(h.dataRef.current.records[0].id, id);
  assert.equal(h.dataRef.current.records[0].reps.length, 1);
  assert.equal(h.engine.pending.length, 0);
});

test("a failed settings write does not poison later device refresh or discard preferences", async () => {
  let fail = true;
  const h = appControls({
    data: { settings: { voice: false, backgroundBlur: false }, records: [] },
    saveData: async () => {
      if (fail) {
        fail = false;
        throw Error("disk unavailable");
      }
    },
    enumerateDevices: async () => devices,
  });
  await assert.rejects(
    h.persist((d) => ({ ...d, settings: { ...d.settings, voice: true } })),
    /disk unavailable/,
  );
  await h.enumerate();
  assert.equal(h.dataRef.current.settings.voice, false);
  assert.equal(h.dataRef.current.settings.backgroundBlur, false);
  assert.equal(h.dataRef.current.settings.camera, "camera");
});
