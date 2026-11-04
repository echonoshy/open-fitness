import test from "node:test";
import assert from "node:assert/strict";
import { SessionEngine } from "../src/core/session";
import { CameraFramer } from "../src/core/camera-framing";
import type { Point } from "../src/core/engine";
function arm(angle: number): Point[] {
  const p = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  p[11] = { x: 0.5, y: 0.25, z: 0, visibility: 1 };
  p[13] = { x: 0.5, y: 0.45, z: 0, visibility: 1 };
  p[15] = {
    x: 0.5 + 0.18 * Math.sin((angle * Math.PI) / 180),
    y: 0.45 - 0.18 * Math.cos((angle * Math.PI) / 180),
    z: 0,
    visibility: 1,
  };
  return p;
}
function runner() {
  const e = new SessionEngine();
  let t = 1;
  e.now = () => t;
  e.cameraReady = true;
  e.dispatch({ type: "set_exercise", exercise: "curl" });
  const f = new CameraFramer();
  const feed = (angle: number | null, n = 15) => {
    for (let i = 0; i < n; i++) {
      t += 0.05;
      const p = angle === null ? [] : arm(angle);
      const accepted = f.update(p, t, {
        exercise: e.exercise,
        set: e.recordId,
        training: e.active,
      });
      e.frame(accepted ? p : [], t);
    }
  };
  return { e, feed };
}
test("seeing a moving person never starts training, explicit start waits for stable start pose", () => {
  const { e, feed } = runner();
  for (const a of [175, 120, 50, 175]) feed(a);
  assert.equal(e.active, false);
  assert.equal(e.counter.count, 0);
  e.dispatch({ type: "session", action: "start" });
  feed(70);
  assert.equal(e.snapshot().preparing, true);
  assert.equal(e.counter.count, 0);
  feed(175, 30);
  assert.equal(e.snapshot().preparing, false);
  for (const a of [120, 75, 50, 90, 130, 175]) feed(a);
  assert.equal(e.counter.count, 1);
});
test("missing required wrist cannot complete preparation; pause/resume preserves progress", () => {
  const { e, feed } = runner();
  e.dispatch({ type: "session", action: "start" });
  feed(null, 40);
  assert.equal(e.snapshot().preparing, true);
  feed(175, 30);
  for (const a of [120, 50, 90, 175]) feed(a);
  assert.equal(e.counter.count, 1);
  e.dispatch({ type: "session", action: "pause" });
  feed(50);
  feed(175);
  assert.equal(e.counter.count, 1);
  e.dispatch({ type: "session", action: "resume" });
  feed(50);
  assert.equal(e.snapshot().preparing, true);
  feed(175, 30);
  assert.equal(e.snapshot().preparing, false);
  assert.equal(e.counter.count, 1);
});
