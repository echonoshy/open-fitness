import test from "node:test";
import assert from "node:assert/strict";
import {
  bodyAngles,
  liveFaults,
  poseSelection,
  type Point,
} from "../src/core/engine";
import { cameraEnvironment } from "../src/core/environment";
import { SessionEngine } from "../src/core/session";
import { motionFeedback } from "../src/core/training-feedback";

function arm(degrees: number, right = false): Point[] {
  const points = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  const offset = right ? 1 : 0;
  points[11 + offset] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 };
  points[13 + offset] = { x: 0.5, y: 0.45, z: 0, visibility: 0.95 };
  points[15 + offset] = {
    x: 0.5 + 0.18 * Math.sin((degrees * Math.PI) / 180),
    y: 0.45 - 0.18 * Math.cos((degrees * Math.PI) / 180),
    z: 0,
    visibility: 0.95,
  };
  return points;
}
function session() {
  const engine = new SessionEngine();
  engine.cameraReady = true;
  engine.dispatch({ type: "set_exercise", exercise: "curl" });
  engine.dispatch({ type: "session", action: "start" });
  let t = 10;
  const frame = (angle: number | null, frames = 1) => {
    for (let n = 0; n < frames; n++) {
      t += 0.05;
      engine.frame(angle === null ? [] : arm(angle), t);
    }
  };
  frame(175, 12); // New single-flow preparation: stable start pose before a set.
  return { engine, frame };
}
test("upper-body counting needs visible shoulder elbow wrist, not legs", () => {
  const pose = bodyAngles(arm(65), "curl");
  assert.equal(pose.visible, true);
  assert.ok(Math.abs(pose.angles.elbow - 65) < 1e-6);
  assert.equal(pose.angles.trunk_lean, undefined);
  assert.equal(pose.angles.upper_arm_swing, 0);
  assert.deepEqual(liveFaults("curl", pose.angles, "BOTTOM"), []);
  assert.equal(cameraEnvironment(arm(65), "curl", 0.6, 30).inFrame, true);
  const missingWrist = arm(65);
  missingWrist[15].visibility = 0;
  assert.equal(bodyAngles(missingWrist, "curl").visible, false);
  assert.deepEqual(poseSelection(missingWrist, "curl").missing, ["手腕"]);
});
test("squat preparation requires shoulder and legs but not elbow or wrist", () => {
  const p = arm(60);
  for (const i of [23, 25, 27])
    p[i] = { x: 0.5, y: 0.2 + (i - 23) * 0.1, z: 0, visibility: 1 };
  p[13].visibility = p[15].visibility = 0;
  assert.equal(bodyAngles(p, "squat").visible, true);
  p[27].visibility = 0;
  assert.equal(bodyAngles(p, "squat").visible, false);
});
test("valid anatomical side remains stable when other side confidence changes", () => {
  const left = arm(70),
    right = arm(150, true);
  for (const i of [12, 14, 16]) left[i] = { ...right[i], visibility: 1 };
  assert.equal(bodyAngles(left, "curl", "left").side, "left");
  assert.ok(
    Math.abs(bodyAngles(left, "curl", "left").angles.elbow - 70) < 1e-6,
  );
});
test("joint angles use upstream image coordinates even when world points exist", () => {
  const p = arm(50);
  p[11].world = { x: 0, y: 0, z: 0 };
  p[13].world = { x: 0, y: 1, z: 0 };
  p[15].world = { x: 1, y: 1, z: 0 };
  assert.ok(Math.abs(bodyAngles(p, "curl").angles.elbow - 50) < 1e-6);
});
test("full upper-body repetition counts, incomplete return does not", () => {
  const { engine, frame } = session();
  for (const a of [170, 130, 80, 50, 90, 130]) frame(a, 8);
  assert.equal(engine.counter.count, 0);
  frame(175, 12);
  assert.equal(engine.counter.count, 1);
  assert.equal(engine.rows.length, 1);
});
test("brief occlusion holds motion, hides stale angles and adds no phantom rep", () => {
  const { engine, frame } = session();
  frame(170, 6);
  frame(120, 8);
  frame(50, 8);
  const phase = engine.counter.phase;
  frame(null, 2);
  assert.equal(engine.counter.phase, phase);
  assert.equal(engine.counter.count, 0);
  assert.deepEqual(engine.angles, {});
  assert.equal(engine.tracking, false);
  for (const a of [60, 95, 130, 175]) frame(a, 8);
  assert.equal(engine.counter.count, 1);
});
test("sustained occlusion discards motion; returning upright alone cannot count", () => {
  const { engine, frame } = session();
  frame(120, 10);
  frame(50, 10);
  frame(null, 20);
  assert.equal(engine.counter.phase, "IDLE");
  frame(175, 10);
  assert.equal(engine.counter.count, 0);
});
test("feedback distinguishes camera off, untracked, ready, and return phase", () => {
  const e = new SessionEngine();
  assert.match(motionFeedback(e.snapshot(), false).title, /开启摄像头/);
  assert.match(motionFeedback(e.snapshot(), true).title, /暂不计数/);
  e.tracking = true;
  e.exercise = "curl";
  e.angles = { knee: 130 };
  assert.match(motionFeedback(e.snapshot(), true).title, /尚未开始/);
  e.active = true;
  e.preparing = false;
  e.counter.phase = "ASCENT";
  assert.match(motionFeedback(e.snapshot(), true).title, /等待回位/);
  e.tracking = false;
  assert.equal(motionFeedback(e.snapshot(), true).angle, undefined);
});
