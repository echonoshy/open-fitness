import test from "node:test";
import assert from "node:assert/strict";
import { resolveOutputDevice } from "../src/media/output-device";

const devices = [
  { kind: "audiooutput" as const, deviceId: "monitor", label: "Mi Monitor" },
  {
    kind: "audiooutput" as const,
    deviceId: "default",
    label: "Default - Mac mini",
  },
  { kind: "audiooutput" as const, deviceId: "builtin", label: "Mac mini" },
];
const systemDefault = { speaker: "", speakerLabel: undefined };

test("fresh installs follow OS default even when a monitor is enumerated first", () => {
  assert.deepEqual(resolveOutputDevice(devices), systemDefault);
});
test("explicit system default survives refresh and stale labels", () => {
  assert.deepEqual(
    resolveOutputDevice(devices, "", "Mi Monitor"),
    systemDefault,
  );
  assert.deepEqual(resolveOutputDevice(devices, "default"), systemDefault);
});
test("explicit output choice is retained and a changed device ID is recovered by label", () => {
  assert.deepEqual(resolveOutputDevice(devices, "monitor", "Mi Monitor"), {
    speaker: "monitor",
    speakerLabel: "Mi Monitor",
  });
  assert.deepEqual(resolveOutputDevice(devices, "old-id", "Mac mini"), {
    speaker: "builtin",
    speakerLabel: "Mac mini",
  });
});
test("disconnected output falls back to OS default rather than another physical device", () => {
  assert.deepEqual(
    resolveOutputDevice(devices, "headphones", "Headphones"),
    systemDefault,
  );
});
test("permission-hidden device lists do not discard a saved output", () => {
  assert.deepEqual(resolveOutputDevice([], "headphones", "Headphones"), {
    speaker: "headphones",
    speakerLabel: "Headphones",
  });
});
