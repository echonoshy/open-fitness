import test from "node:test";
import assert from "node:assert/strict";
import { SessionEngine } from "../src/core/session";
import {
  bodyAngles,
  Smoother,
  type Point,
  EXERCISES,
} from "../src/core/engine";
import { SquatPreparation } from "../src/core/pose-checks";
import { motionFeedback } from "../src/core/training-feedback";
import { pushupPose } from "./fixtures/pushup-pose";

function squat(degrees = 175, front = false): Point[] {
  const p: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  for (const s of [0, 1]) {
    const x = front ? 0.42 + s * 0.16 : 0.5 + s * 0.01;
    p[11 + s] = {
      x: front ? 0.39 + s * 0.22 : x,
      y: 0.2,
      z: 0,
      visibility: 1 - s * 0.1,
    };
    p[23 + s] = { x, y: 0.4, z: 0, visibility: 1 - s * 0.1 };
    p[25 + s] = { x, y: 0.62, z: 0, visibility: 1 - s * 0.1 };
    p[27 + s] = {
      x: x + 0.2 * Math.sin((degrees * Math.PI) / 180),
      y: 0.62 - 0.2 * Math.cos((degrees * Math.PI) / 180),
      z: 0,
      visibility: 1 - s * 0.1,
    };
  }
  return p;
}
function runner() {
  const engine = new SessionEngine();
  let t = 0;
  engine.now = () => t;
  engine.cameraReady = true;
  engine.dispatch({ type: "session", action: "start" });
  const feed = (points: Point[], n = 1, dt = 0.05) => {
    for (let i = 0; i < n; i++)
      engine.frame(structuredClone(points), (t += dt));
  };
  const move = (angles: number[], front = false) =>
    angles.forEach((a) => feed(squat(a, front), 8));
  return { engine, feed, move };
}
const cycle = [140, 110, 80, 95, 120, 145];

test("side squat requires stable upright preparation, then counts three full cycles", () => {
  const { engine: e, feed, move } = runner();
  move(cycle);
  feed(squat(175), 4);
  assert.equal(e.counter.count, 0);
  assert.equal(e.squatPreparation.ready, false);
  feed(squat(175), 20);
  assert.equal(e.squatPreparation.ready, true);
  for (let i = 1; i <= 3; i++) {
    move(cycle);
    feed(squat(175), 16);
    assert.equal(e.counter.count, i);
  }
});
test("frontal squat is guided to side view, never called shallow or counted", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(175, true), 30);
  move(cycle, true);
  feed(squat(175, true), 20);
  assert.equal(e.counter.count, 0);
  assert.match(motionFeedback(e.snapshot(), true).detail, /侧身/);
  assert.deepEqual(e.faults, []);
});
test("view check compensates for image aspect ratio", () => {
  for (const aspect of [1, 16 / 9, 9 / 16]) {
    const prep = new SquatPreparation();
    const p = squat(175, true);
    p.forEach((v) => (v.x = 0.5 + (v.x - 0.5) / aspect));
    for (let i = 0; i < 20; i++) prep.update(p, "left", i * 0.05, aspect);
    assert.equal(prep.ready, false);
  }
});
test("a prepared side view tolerates boundary jitter but still rejects frontal rotation", () => {
  const prep = new SquatPreparation();
  const p = squat();
  for (let i = 0; i < 20; i++) prep.update(p, "left", i * 0.05);
  assert.equal(prep.ready, true);
  p[12].x = p[11].x + 0.2 * 0.58;
  for (let i = 20; i < 40; i++)
    assert.equal(prep.update(p, "left", i * 0.05).ready, true);
  assert.equal(prep.update(squat(175, true), "left", 2.1).ready, false);
  const fresh = new SquatPreparation();
  for (let i = 0; i < 20; i++) fresh.update(p, "left", i * 0.05);
  assert.equal(
    fresh.ready,
    false,
    "hysteresis cannot loosen initial preparation",
  );
});
test("preparation works before starting and cannot reuse an unchecked crouch", () => {
  const { engine: e, feed } = runner();
  e.dispatch({ type: "session", action: "end" });
  feed(squat(), 20);
  assert.equal(e.snapshot().squatCheck?.ready, true);
  assert.equal(e.counter.count, 0);
  e.dispatch({ type: "session", action: "start" });
  feed(squat(80), 20);
  assert.equal(e.squatPreparation.ready, false);
  assert.equal(e.counter.count, 0);
});
test("short ankle loss during ascent recovers same side and counts once", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(), 20);
  move(cycle);
  const hidden = squat(145);
  hidden[27].visibility = hidden[28].visibility = 0.1;
  feed(hidden, 7);
  assert.equal(e.counter.count, 0);
  assert.equal(e.tracking, false);
  feed(squat(175));
  assert.equal(e.counter.count, 0);
  assert.equal(e.tracking, false);
  feed(squat(175), 16);
  assert.equal(e.counter.count, 1);
});
test("600ms processing stall is confirmed before resuming, not discarded", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(), 20);
  move(cycle);
  feed(squat(175), 1, 0.6);
  assert.equal(e.counter.count, 0);
  feed(squat(175), 16);
  assert.equal(e.counter.count, 1);
});
test("long loss discards motion; returning upright is not a rep", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(), 20);
  move(cycle);
  feed([], 20);
  feed(squat(), 20);
  assert.equal(e.counter.count, 0);
  move(cycle);
  feed(squat(), 16);
  assert.equal(e.counter.count, 1);
});
test("a displaced returning body cannot finish a pending rep", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(), 20);
  move(cycle);
  feed([], 3);
  const shifted = squat();
  shifted.forEach((p) => (p.x -= 0.35));
  feed(shifted, 20);
  assert.equal(e.counter.count, 0);
});
test("turning frontal halfway through discards the motion", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(), 20);
  move([140, 110, 80]);
  feed(squat(95, true), 8);
  feed(squat(), 20);
  assert.equal(e.counter.count, 0);
  move(cycle);
  feed(squat(), 16);
  assert.equal(e.counter.count, 1);
});
test("idle confidence flicker does not repeatedly invalidate the stance check", () => {
  const { engine: e, feed } = runner();
  feed(squat(), 20);
  for (let i = 0; i < 20; i++) {
    const p = squat();
    for (const j of [11, 23, 25, 27]) {
      p[j].visibility = i % 2 ? 0.9 : 1;
      p[j + 1].visibility = i % 2 ? 1 : 0.9;
    }
    feed(p);
  }
  assert.equal(e.trackingSide, "left");
  assert.equal(e.squatPreparation.ready, true);
});

function exercisePose(
  exercise: keyof typeof EXERCISES,
  degrees: number,
): Point[] {
  const p = squat(degrees);
  const r = (degrees * Math.PI) / 180;
  if (EXERCISES[exercise].signal === "elbow") {
    p[11] = { x: 0.5, y: 0.25, z: 0, visibility: 1 };
    p[13] = { x: 0.5, y: 0.45, z: 0, visibility: 1 };
    p[15] = {
      x: 0.5 + 0.18 * Math.sin(r),
      y: 0.45 - 0.18 * Math.cos(r),
      z: 0,
      visibility: 1,
    };
    for (const i of [12, 14, 16]) p[i].visibility = 0;
  }
  if (exercise === "deadlift")
    p[25] = {
      x: 0.5 + 0.2 * Math.sin(r),
      y: 0.4 - 0.2 * Math.cos(r),
      z: 0,
      visibility: 1,
    };
  return p;
}
for (const exercise of Object.keys(EXERCISES).filter(
  // Push-ups now require a supported torso and shoulder travel. The upright
  // arm-only fixture is intentionally rejected; see pushup-multiview.test.ts.
  (e) => e !== "plank" && e !== "pushup",
) as (keyof typeof EXERCISES)[]) {
  test(`${exercise}: complete cycles and short primary-joint dropout retain correct count`, () => {
    const { engine: e, feed } = runner();
    e.dispatch({ type: "set_exercise", exercise });
    feed(exercisePose(exercise, 175), 20);
    for (let rep = 1; rep <= 2; rep++) {
      for (const a of [130, 80, 55, 90, 130])
        feed(exercisePose(exercise, a), 8);
      if (rep === 2) {
        const p = exercisePose(exercise, 130);
        const i =
          EXERCISES[exercise].signal === "elbow"
            ? 15
            : exercise === "deadlift"
              ? 25
              : 27;
        p[i].visibility = p[i + 1].visibility = 0;
        feed(p, 6);
        assert.equal(e.counter.count, 1);
      }
      feed(exercisePose(exercise, 175), 20);
      assert.equal(e.counter.count, rep);
      assert.ok(Number.isFinite(e.rows.at(-1)!.duration));
    }
  });
}
test("plank never accumulates missing time or a stalled frame interval", () => {
  const { engine: e, feed } = runner();
  e.dispatch({ type: "set_exercise", exercise: "plank" });
  const pose = pushupPose(172, 90);
  feed(pose, 20);
  const before = e.plank.total;
  assert.ok(before > 0);
  feed([], 6);
  feed(pose);
  assert.equal(e.plank.total, before);
  feed(pose, 6);
  const after = e.plank.total;
  assert.ok(after - before < 0.3);
  feed(pose, 1, 0.6);
  assert.equal(e.plank.total, after);
});
test("idle chooses clearer side but a moving rep never swaps sides", () => {
  const { engine: e, feed, move } = runner();
  feed(squat(), 20);
  const right = squat();
  for (const i of [11, 23, 25, 27]) {
    right[i].visibility = 0.7;
    right[i + 1].visibility = 1;
  }
  feed(right, 20);
  assert.equal(e.trackingSide, "right");
  move([140, 110, 80]);
  assert.equal(e.trackingSide, "right");
});
test("hidden optional landmarks do not poison the smoothing filter", () => {
  const s = new Smoother();
  s.update(squat(), 0);
  for (let i = 1; i < 20; i++) {
    const p = squat();
    p[11] = { x: 0.9, y: 0.9, z: 0, visibility: 0.1 };
    s.update(p, i * 0.05);
  }
  const restored = s.update(squat(), 1);
  assert.equal(restored[11].x, 0.5);
  assert.equal(restored[11].y, 0.2);
});
test("coincident primary joints cannot produce a valid tracking angle", () => {
  const p = squat();
  p[25] = { ...p[23] };
  p[26] = { ...p[24] };
  assert.equal(bodyAngles(p, "squat").visible, false);
});
test("every repetition exercise uses its own relevant joints, without requiring the other side", () => {
  for (const exercise of Object.keys(EXERCISES).filter(
    (e) => e !== "plank",
  ) as (keyof typeof EXERCISES)[]) {
    const p = squat();
    p[13] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
    p[15] = { x: 0.7, y: 0.4, z: 0, visibility: 1 };
    for (const i of [12, 14, 16, 24, 26, 28]) p[i].visibility = 0;
    assert.equal(bodyAngles(p, exercise).visible, true, exercise);
  }
});
