import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXERCISES,
  RepCounter,
  PlankTracker,
  type Exercise,
} from "../src/core/engine";
import { SessionEngine } from "../src/core/session";
const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/upstream-parity.json", import.meta.url),
    "utf8",
  ),
);
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
for (const f of fixtures.fsm_cases)
  test("Python count, depth and duration parity: " + f.name, () => {
    const c = new RepCounter(EXERCISES[f.exercise as Exercise]),
      rows = [];
    for (let i = 0; i < f.angles.length; i++) {
      const r = c.update(f.angles[i], i / f.fps);
      if (r) rows.push(r);
    }
    assert.equal(c.count, f.expected.count);
    assert.equal(c.phase, f.expected.final_state);
    rows.forEach((r, i) => {
      const e = f.expected.reps[i];
      assert.equal(r.count, e.n);
      assert.equal(r.full_depth, e.full_depth);
      near(r.duration, e.duration_s);
      // Phase timing intentionally diverges from upstream: use the observed
      // reversal rather than its delayed confirmation. Counts stay identical.
      near(r.eccentric_s + r.concentric_s, e.duration_s);
      near(r.min_angle, e.min_angle);
    });
  });
test("partial press includes early ascent in concentric time", () => {
  const c = new RepCounter(EXERCISES.shoulder_press);
  const points = [
    [0, 149],
    [0.3, 130],
    [0.6, 116],
    [0.9, 124],
    [1.1, 132],
    [1.3, 161],
  ];
  const reps = points.flatMap(([t, angle]) => c.update(angle, t) ?? []);
  assert.equal(reps.length, 1);
  near(reps[0].concentric_s, 0.7);
  near(reps[0].eccentric_s, 0.6);
  assert.deepEqual(reps[0].faults, ["shallow"]);
});
test("full press timing starts at the reversal, after the depth threshold", () => {
  const c = new RepCounter(EXERCISES.shoulder_press);
  const points = [
    [0, 149],
    [0.3, 98],
    [0.8, 85],
    [0.9, 92],
    [1.0, 100],
    [1.2, 161],
  ];
  const reps = points.flatMap(([t, angle]) => c.update(angle, t) ?? []);
  assert.equal(reps.length, 1);
  near(reps[0].concentric_s, 0.4);
  near(reps[0].eccentric_s, 0.8);
  assert.deepEqual(reps[0].faults, ["too_fast"]);
});
test("curl maps the two timed phases to the opposite muscle action", () => {
  const c = new RepCounter(EXERCISES.curl);
  const points = [
    [0, 139],
    [0.3, 68],
    [0.8, 60],
    [1.0, 75],
    [1.6, 156],
  ];
  const reps = points.flatMap(([t, angle]) => c.update(angle, t) ?? []);
  near(reps[0].concentric_s, 0.8);
  near(reps[0].eccentric_s, 0.8);
  assert.deepEqual(reps[0].faults, []);
});
for (const f of fixtures.plank_cases)
  test("Python parity: " + f.name, () => {
    const p = new PlankTracker();
    let cues = 0;
    f.body_line.forEach((a: number, i: number) => {
      if (p.update(a, i / f.fps)) cues++;
    });
    near(p.total, f.expected.total_s);
    near(p.best, f.expected.best_s);
    assert.equal(cues, f.expected.cues);
  });
test("invalid command has no effects", () => {
  const e = new SessionEngine();
  for (const command of [
    { type: "set_rep_goal", reps: 0 },
    { type: "set_rep_goal", reps: 12.5 },
    { type: "set_load", kg: -1 },
    { type: "set_exercise", exercise: "banana" },
    { type: "rest_timer", seconds: 901 },
    { type: "set_tempo", eccentric_s: 0 },
  ])
    assert.equal(e.dispatch(command).ok, false);
  assert.equal(e.goal, 12);
  assert.equal(e.exercise, "squat");
  assert.equal(e.restUntil, 0);
});
test("camera required; rest clock, pause and persisted archive", () => {
  const e = new SessionEngine();
  let t = 100;
  e.now = () => t;
  assert.equal(e.dispatch({ type: "session", action: "start" }).ok, false);
  assert.equal(e.dispatch({ type: "rest_timer", seconds: 60 }).ok, false);
  e.cameraReady = true;
  assert.equal(e.dispatch({ type: "session", action: "start" }).ok, true);
  e.dispatch({ type: "rest_timer", seconds: 60 });
  assert.equal(e.snapshot().remaining, 60);
  t += 17;
  assert.equal(e.snapshot().remaining, 43);
  t += 44;
  assert.equal(e.snapshot().status, "training");
  e.dispatch({ type: "session", action: "pause" });
  assert.equal(e.snapshot().status, "paused");
  e.dispatch({ type: "session", action: "resume" });
  assert.equal(e.snapshot().status, "training");
  e.dispatch({ type: "session", action: "end" });
  assert.equal(e.pending.length, 1);
  assert.equal(e.pending[0].duration, 61);
  assert.equal(e.snapshot().status, "ready");
  assert.equal(e.dispatch({ type: "session", action: "end" }).ok, false);
  assert.equal(e.pending.length, 1);
});
test("same exercise preserves progress, switch archives and resets", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.counter.count = 5;
  e.dispatch({ type: "set_exercise", exercise: "squat" });
  assert.equal(e.snapshot().reps, 5);
  e.dispatch({ type: "set_exercise", exercise: "shoulder_press" });
  assert.equal(e.snapshot().exercise, "shoulder_press");
  assert.equal(e.snapshot().reps, 0);
  assert.equal(e.pending[0].exercise, "squat");
});
test("lost tracking discards incomplete rep", () => {
  const e = new SessionEngine();
  e.counter.update(140, 0);
  assert.equal(e.counter.phase, "DESCENT");
  e.frame([], 1);
  assert.equal(e.counter.phase, "IDLE");
  assert.equal(e.snapshot().tracking, false);
  assert.equal(e.counter.count, 0);
});
test("rest from paused is visible; resume cancels rest", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.dispatch({ type: "session", action: "pause" });
  e.dispatch({ type: "rest_timer", seconds: 60 });
  assert.equal(e.snapshot().status, "resting");
  e.dispatch({ type: "session", action: "resume" });
  assert.equal(e.snapshot().status, "training");
  assert.equal(e.snapshot().remaining, 0);
  e.cameraReady = false;
  assert.equal(e.dispatch({ type: "session", action: "resume" }).ok, false);
});
test("resume requires live camera and cannot silently resume after unplug", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.dispatch({ type: "session", action: "pause" });
  e.cameraReady = false;
  assert.equal(e.dispatch({ type: "session", action: "resume" }).ok, false);
  assert.equal(e.snapshot().status, "paused");
});
