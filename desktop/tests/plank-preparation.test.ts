import test from "node:test";
import assert from "node:assert/strict";
import { SessionEngine } from "../src/core/session";
import { CameraFramer } from "../src/core/camera-framing";
import { processCameraPose } from "../src/core/camera-pipeline";
import type { Point } from "../src/core/engine";
import { pushupPose } from "./fixtures/pushup-pose";

function upright(): Point[] {
  const p: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  for (const [i, dx, y] of [
    [0, 0, 0.15],
    [7, -0.02, 0.16],
    [8, 0.02, 0.16],
    [11, -0.025, 0.27],
    [12, 0.025, 0.27],
    [13, -0.035, 0.4],
    [14, 0.035, 0.4],
    [15, -0.04, 0.52],
    [16, 0.04, 0.52],
    [23, -0.025, 0.52],
    [24, 0.025, 0.52],
    [25, -0.025, 0.7],
    [26, 0.025, 0.7],
    [27, -0.025, 0.9],
    [28, 0.025, 0.9],
    [31, -0.03, 0.92],
    [32, 0.03, 0.92],
  ])
    p[i] = { x: 0.5 + dx, y, z: 0, visibility: 1 };
  return p;
}
function runner(aspect = 16 / 9, framed = false) {
  const e = new SessionEngine(),
    f = new CameraFramer();
  let time = 1;
  e.now = () => time;
  e.cameraReady = true;
  e.dispatch({ type: "set_exercise", exercise: "plank" });
  e.dispatch({ type: "session", action: "start" });
  const feed = (points: Point[], seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.05); i++) {
      time += 0.05;
      if (framed) processCameraPose(f, e, points, time, aspect);
      else e.frame(points, time, aspect);
    }
  };
  return { e, f, feed };
}

test("upright standing cannot start plank timing or complete a program through the camera pipeline", () => {
  for (const program of [false, true]) {
    const h = runner(16 / 9, true);
    if (program) {
      h.e.dispatch({ type: "session", action: "end" });
      h.e.pending = [];
      h.e.events = [];
      h.e.dispatch({
        type: "start_program",
        blocks: [{ exercise: "plank", sets: 2, target: 2, rest: 1, load: 0 }],
      });
    }
    h.feed(upright(), 10);
    assert.equal(h.e.plank.total, 0);
    assert.equal(h.e.plank.best, 0);
    assert.equal(h.e.preparing, true);
    assert.match(h.e.trackingNotice, /支撑|水平/);
    assert.equal(h.e.pending.length, 0);
    assert.equal(
      h.e.events.some((e) => ["goal", "finish"].includes(e.type)),
      false,
    );
    if (program) assert.equal(h.e.program?.set, 1);
  }
});

test("supported planks retain timing across side, oblique and frontal views, aspect ratios and mirroring", () => {
  for (const aspect of [16 / 9, 1, 9 / 16])
    for (const yaw of [0, 45, 90])
      for (const mirror of [false, true]) {
        const h = runner(aspect);
        const pose = pushupPose(172, yaw, { aspect, mirror, world: false });
        h.feed(pose, 4);
        assert.equal(
          h.e.preparing,
          false,
          `aspect=${aspect}, yaw=${yaw}, mirror=${mirror}`,
        );
        assert.ok(h.e.plank.total > 3.4 && h.e.plank.total < 3.6);
        assert.equal(h.e.plank.best, h.e.plank.total);
        h.e.dispatch({ type: "session", action: "end" });
        assert.equal(h.e.pending.length, 1);
        assert.equal(h.e.pending[0].holdSeconds, h.e.plank.total);
        assert.equal(h.e.pending[0].reps.length, 0);
      }
});

test("standing up after preparation stops timing immediately and returning requires stable preparation", () => {
  const h = runner(),
    pose = pushupPose(172, 90);
  h.feed(pose, 3);
  const total = h.e.plank.total,
    best = h.e.plank.best,
    id = h.e.recordId;
  h.feed(upright(), 0.05);
  assert.equal(h.e.plank.total, total);
  assert.equal(h.e.plank.streak, 0);
  assert.equal(h.e.preparing, true);
  h.feed(upright(), 5);
  assert.equal(h.e.plank.total, total);
  h.feed(pose, 0.4);
  assert.equal(h.e.plank.total, total);
  h.feed(pose, 1.1);
  assert.ok(h.e.plank.total > total && h.e.plank.total < total + 1.1);
  assert.equal(h.e.plank.best, best);
  assert.equal(h.e.recordId, id);
  assert.equal(h.e.pending.length, 0);
});

test("occlusion, pause and rest preserve plank progress without adding their elapsed time", () => {
  const h = runner(),
    pose = pushupPose(172, 90);
  h.feed(pose, 3);
  for (const mode of ["occlusion", "pause", "rest"] as const) {
    const total = h.e.plank.total;
    if (mode === "pause") h.e.dispatch({ type: "session", action: "pause" });
    if (mode === "rest") h.e.dispatch({ type: "rest_timer", seconds: 30 });
    h.feed(mode === "occlusion" ? [] : pose, 2);
    assert.equal(h.e.plank.total, total);
    if (mode === "pause") h.e.dispatch({ type: "session", action: "resume" });
    if (mode === "rest")
      h.e.dispatch({ type: "session", action: "cancel_rest" });
    h.feed(pose, 1.5);
    assert.ok(h.e.plank.total > total && h.e.plank.total <= total + 1.5);
  }
});

test("valid plank program advances, archives and finishes each set exactly once", () => {
  const h = runner(),
    pose = pushupPose(172, 90);
  h.e.dispatch({ type: "session", action: "end" });
  h.e.pending = [];
  h.e.events = [];
  h.e.dispatch({
    type: "start_program",
    blocks: [{ exercise: "plank", sets: 2, target: 2, rest: 1, load: 0 }],
  });
  h.feed(pose, 10);
  assert.equal(h.e.active, false);
  assert.equal(h.e.pending.length, 2);
  assert.equal(new Set(h.e.pending.map((r) => r.id)).size, 2);
  assert.ok(
    h.e.pending.every(
      (r) =>
        r.holdSeconds >= 2 &&
        r.holdSeconds < 2.1 &&
        r.holdBest === r.holdSeconds,
    ),
  );
  assert.equal(h.e.events.filter((e) => e.type === "finish").length, 1);
});
