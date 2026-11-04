import test from "node:test";
import assert from "node:assert/strict";
import { CameraFramer, bodyBounds } from "../src/core/camera-framing";
import { processCameraPose } from "../src/core/camera-pipeline";
import { SessionEngine } from "../src/core/session";
import { EXERCISES, type Exercise, type Point } from "../src/core/engine";
import { pushupPose } from "./fixtures/pushup-pose";
import recorded from "./fixtures/pushup-recorded-segment.json";

function body(height = 0.25, x = 0.5): Point[] {
  const p = Array.from({ length: 33 }, () => ({
    x,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  for (const [i, dx, y] of [
    [0, 0, -0.5],
    [7, -0.04, -0.48],
    [8, 0.04, -0.48],
    [11, -0.1, -0.35],
    [12, 0.1, -0.35],
    [13, -0.15, -0.2],
    [14, 0.15, -0.2],
    [15, -0.2, 0],
    [16, 0.2, 0],
    [23, -0.08, 0],
    [24, 0.08, 0],
    [25, -0.08, 0.25],
    [26, 0.08, 0.25],
    [27, -0.08, 0.48],
    [28, 0.08, 0.48],
    [31, -0.1, 0.5],
    [32, 0.1, 0.5],
  ])
    p[i] = { x: x + dx * height, y: 0.5 + y * height, z: 0, visibility: 0.95 };
  return p;
}
function bend(p: Point[], distance: number) {
  const bent = structuredClone(p);
  for (const i of [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24])
    bent[i].y += distance;
  return bent;
}
function viewGeometry(f: CameraFramer) {
  const { x, y, zoom, automatic } = f.snapshot();
  return { x, y, zoom, automatic };
}
function framer(exercise: Exercise = "squat") {
  const f = new CameraFramer();
  let time = 10;
  const feed = (points: Point[], seconds: number, moving = false, fps = 25) => {
    for (let i = 0; i < Math.ceil(seconds * fps); i++)
      f.update(points, (time += 1 / fps), {
        exercise,
        set: "one",
        training: true,
        moving,
        aspect: 16 / 9,
      });
  };
  return { f, feed };
}
function exercisePose(exercise: Exercise, degrees = 175, offset = 0): Point[] {
  const p = body(0.65),
    r = (degrees * Math.PI) / 180;
  for (const side of [0, 1]) {
    const x = 0.5 + side * 0.01;
    p[11 + side] = { x, y: 0.2, z: 0, visibility: 1 - side * 0.1 };
    p[23 + side] = { x, y: 0.4, z: 0, visibility: 1 - side * 0.1 };
    p[25 + side] = { x, y: 0.62, z: 0, visibility: 1 - side * 0.1 };
    p[27 + side] = {
      x: x + 0.2 * Math.sin(r),
      y: 0.62 - 0.2 * Math.cos(r),
      z: 0,
      visibility: 1 - side * 0.1,
    };
  }
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
  return p.map((v) => ({ ...v, x: v.x + offset }));
}
test("a set cannot silently zoom tighter between presses or after tracking recovery", () => {
  const h = framer("shoulder_press");
  h.feed(body(0.65), 4);
  h.feed(body(0.65), 1, true);
  const before = h.f.snapshot().zoom;
  h.feed(body(0.47), 6, false);
  assert.ok(h.f.snapshot().zoom <= before + 0.002);
  assert.equal(h.f.snapshot().framingReason, "set_hold");
  h.feed([], 2);
  h.feed(body(0.47), 7);
  assert.equal(
    h.f.snapshot().zoom,
    1,
    "recovery must not restart automatic enlargement mid-set",
  );
  assert.equal(h.f.command("zoom_in").ok, true);
  h.feed(body(0.47), 8);
  assert.ok(h.f.snapshot().zoom > 1.25, "explicit user zoom remains available");
  const requested = h.f.snapshot().zoom;
  h.feed(body(0.35), 8);
  assert.ok(
    h.f.snapshot().zoom <= requested + 0.002,
    "explicit zoom is not permanent permission to keep enlarging",
  );
});
test("a new set may establish a new full-body scale after the previous movement", () => {
  const f = new CameraFramer();
  for (let i = 0; i < 100; i++)
    f.update(body(0.65), i * 0.04, {
      exercise: "shoulder_press",
      training: true,
      activeSet: true,
      moving: i > 50,
      set: "old",
    });
  for (let i = 100; i < 300; i++)
    f.update(body(0.4), i * 0.04, {
      exercise: "shoulder_press",
      training: true,
      activeSet: true,
      moving: false,
      set: "new",
    });
  assert.ok(f.snapshot().zoom > 1.5);
});
function pipeline(exercise: Exercise) {
  const e = new SessionEngine(),
    baseline = new SessionEngine(),
    f = new CameraFramer();
  let time = 10;
  for (const engine of [e, baseline]) {
    engine.now = () => time;
    engine.cameraReady = true;
    engine.dispatch({ type: "set_exercise", exercise });
    engine.dispatch({ type: "session", action: "start" });
  }
  const feed = (p: Point[], seconds: number, dt = 0.04) => {
    let rejected = 0,
      reacquired = 0;
    for (let i = 0; i < Math.ceil(seconds / dt); i++) {
      time += dt;
      const source = processCameraPose(f, e, structuredClone(p), time, 16 / 9);
      if (p.length && !source.length) rejected++;
      if (f.reacquiredTarget) reacquired++;
      baseline.frame(structuredClone(p), time, 16 / 9);
    }
    return { rejected, reacquired };
  };
  const cycle = (offset = 0) => {
    for (const angle of [130, 80, 55, 90, 130])
      feed(exercisePose(exercise, angle, offset), 0.4);
    feed(exercisePose(exercise, 175, offset), 1);
  };
  return { e, baseline, f, feed, cycle };
}

for (const manual of [false, true]) {
  test(`lost target reacquires a stable new position without joining a rep, manual=${manual}`, () => {
    const h = pipeline("curl");
    h.feed(exercisePose("curl"), 6);
    h.cycle();
    assert.equal(h.e.counter.count, 1);
    if (manual) h.f.command("lock");
    const locked = viewGeometry(h.f),
      id = h.e.recordId,
      session = h.e.sessionId;
    const rows = structuredClone(h.e.rows),
      elapsed = h.e.snapshot().elapsed;
    h.feed(exercisePose("curl", 80), 0.5);
    h.feed([], 2);
    const r = h.feed(exercisePose("curl", 80, -0.3), 2);
    assert.equal(r.reacquired, 1);
    assert.ok(r.rejected > 0 && r.rejected < 50);
    assert.equal(h.e.preparing, true);
    assert.equal(h.e.tracking, true);
    assert.equal(h.e.counter.count, 1);
    assert.equal(h.e.recordId, id);
    assert.equal(h.e.sessionId, session);
    assert.deepEqual(h.e.rows, rows);
    assert.equal(h.e.pending.length, 0);
    assert.ok(h.e.snapshot().elapsed > elapsed);
    h.feed(exercisePose("curl", 175, -0.3), 1);
    assert.equal(
      h.e.counter.count,
      1,
      "returning upright cannot finish the old rep",
    );
    h.cycle(-0.3);
    assert.equal(h.e.counter.count, 2);
    if (manual) assert.deepEqual(viewGeometry(h.f), locked);
  });
}
test("brief loss and an abrupt passing candidate cannot take over during training", () => {
  const h = pipeline("curl");
  h.feed(exercisePose("curl"), 4);
  h.feed([], 0.4);
  const result = h.feed(exercisePose("curl", 175, -0.3), 6);
  assert.equal(result.rejected, 150);
  assert.equal(result.reacquired, 0);
  assert.equal(h.feed(exercisePose("curl"), 1).rejected, 0);
});
test("reacquisition requires uninterrupted stable usable observations", () => {
  const h = pipeline("curl");
  h.feed(exercisePose("curl"), 4);
  h.feed([], 2);
  const p = exercisePose("curl", 175, -0.3);
  assert.equal(h.feed(p, 0.5).reacquired, 0);
  h.feed([], 0.2);
  assert.equal(h.feed(p, 0.5).reacquired, 0);
  const invalid = structuredClone(p);
  invalid[15].visibility = 0;
  assert.equal(h.feed(invalid, 1).reacquired, 0);
  assert.equal(h.feed(p, 0.5).reacquired, 0);
  assert.equal(h.feed(p, 0.5).reacquired, 1);
});
test("explicit automatic reacquisition also discards a pending half repetition", () => {
  const h = pipeline("curl");
  h.feed(exercisePose("curl"), 4);
  h.cycle();
  h.feed(exercisePose("curl", 80), 0.5);
  h.f.command("auto");
  assert.equal(h.feed(exercisePose("curl", 175, -0.3), 0.04).reacquired, 1);
  h.feed(exercisePose("curl", 175, -0.3), 1);
  assert.equal(h.e.counter.count, 1);
  h.cycle(-0.3);
  assert.equal(h.e.counter.count, 2);
});

test("stationary plank acquires while counting; voice zoom and loss recovery work", () => {
  const h = pipeline("plank"),
    p = pushupPose(172, 90, { scale: 0.32 });
  h.feed(p, 8);
  assert.ok(h.f.snapshot().zoom > 2.2);
  assert.ok(h.e.plank.total > 7);
  assert.equal(h.e.plank.total, h.baseline.plank.total);
  assert.equal(h.f.command("zoom_in").ok, true);
  h.feed(p, 5);
  assert.ok(h.f.snapshot().subjectRatio! > 0.72);
  const before = h.e.plank.total;
  h.feed([], 2);
  assert.equal(h.e.plank.total, before);
  h.feed(p, 8);
  assert.ok(h.f.snapshot().zoom > 2.6);
  assert.equal(h.e.plank.total, h.baseline.plank.total);
  h.f.command("auto");
  h.feed(p, 6);
  assert.ok(Math.abs(h.f.snapshot().subjectRatio! - 0.65) < 0.01);
});
test("pending plank zoom resolves once the complete stable body appears", () => {
  const h = pipeline("plank");
  h.feed([], 1);
  assert.match(
    h.f.command({ type: "camera_view", action: "zoom_to", zoom: 2 }).message,
    /站稳后调整/,
  );
  h.feed(pushupPose(172, 90, { scale: 0.25 }), 8);
  assert.ok(Math.abs(h.f.snapshot().zoom - 2) < 0.01);
});
test("plank relocation preserves accumulated time and excludes the recovery interval", () => {
  const h = pipeline("plank"),
    p = pushupPose(172, 90, { scale: 0.25 });
  h.feed(p, 6);
  h.f.command("lock");
  const before = h.e.plank.total,
    locked = viewGeometry(h.f),
    id = h.e.recordId;
  h.feed([], 2);
  const shifted = p.map((v) => ({ ...v, x: v.x + 0.25 }));
  const r = h.feed(shifted, 1);
  assert.equal(r.reacquired, 1);
  assert.equal(h.e.plank.total, before);
  h.feed(shifted, 2);
  assert.ok(h.e.plank.total > before && h.e.plank.total < before + 2);
  assert.equal(h.e.recordId, id);
  assert.deepEqual(viewGeometry(h.f), locked);
});

test("starting a rep freezes automatic enlargement until the user requests a closer view", () => {
  const h = framer();
  h.feed(body(), 1.6);
  const start = h.f.snapshot();
  assert.ok(start.targetZoom! > start.zoom + 0.5);
  h.feed(bend(body(), 0.08), 1.2, true);
  assert.ok(h.f.snapshot().zoom <= start.zoom + 0.0001);
  assert.equal(h.f.snapshot().framingReason, "motion_hold");
  h.feed(body(), 8);
  assert.ok(h.f.snapshot().zoom <= start.zoom + 0.0001);
  assert.equal(h.f.command("zoom_in").ok, true);
  h.feed(body(), 8);
  assert.ok(h.f.snapshot().zoom > 2.5);
});
test("rep start freezes enlargement even when the complete body is briefly occluded", () => {
  const h = framer();
  h.feed(body(), 1.6);
  const before = h.f.snapshot().zoom;
  h.feed([], 0.5, true);
  assert.ok(h.f.snapshot().zoom <= before + 0.0001);
});
for (const state of ["preview", "preparing", "paused"] as const)
  test(`${state}: crouching holds scale and voice enlargement waits for a standing pose`, () => {
    const h = pipeline("squat");
    if (state === "preview") h.e.dispatch({ type: "session", action: "end" });
    if (state === "paused") h.e.dispatch({ type: "session", action: "pause" });
    h.feed(body(0.5), 8);
    const before = h.f.snapshot().zoom;
    h.feed(bend(body(0.5), 0.17), 6);
    assert.ok(h.f.snapshot().zoom <= before + 0.001);
    assert.match(h.f.command("zoom_in").message, /站稳后调整/);
    h.feed(bend(body(0.5), 0.17), 3);
    assert.ok(h.f.snapshot().zoom <= before + 0.001);
    h.feed(body(0.5), 8);
    assert.ok(h.f.snapshot().zoom > before + 0.1);
  });
test("starting with a crouch does not learn it as a distant standing body", () => {
  const h = framer();
  h.feed(bend(body(0.5), 0.17), 8);
  assert.equal(h.f.snapshot().zoom, 1);
  h.feed(body(0.5), 8);
  assert.ok(Math.abs(h.f.snapshot().zoom - 1.3) < 0.01);
});

for (const fps of [5, 10, 25])
  test(`every displayed crop retains available full-body margins while approaching at ${fps} FPS`, () => {
    const h = framer();
    h.feed(body(), 10);
    for (let i = 1; i <= fps; i++) {
      const p = body(0.25 + (0.35 * i) / fps);
      h.feed(p, 1 / fps, false, fps);
      const v = h.f.snapshot(),
        half = 0.5 / v.zoom,
        b = bodyBounds(p, "squat")!;
      assert.ok(v.x - half <= Math.max(0, b.left) + 1e-8);
      assert.ok(v.x + half >= Math.min(1, b.right) - 1e-8);
      assert.ok(v.y - half <= Math.max(0, b.top) + 1e-8);
      assert.ok(v.y + half >= Math.min(1, b.bottom) - 1e-8);
    }
    h.feed(body(0.6), 6);
    assert.ok(Math.abs(h.f.snapshot().zoom * 0.6 - 0.65) < 0.01);
  });
for (const action of ["lock", "full", "left", "zoom_in"] as const)
  test(`manual ${action} is unchanged by motion, safety limits and loss`, () => {
    const h = framer();
    h.feed(body(), 10);
    h.f.command(
      action === "zoom_in"
        ? { type: "camera_view", action, adjustment: "step" }
        : action,
    );
    const before = viewGeometry(h.f);
    h.feed(body(0.8), 5, true);
    h.feed([], 3);
    h.feed(body(0.25, 0.8), 5);
    assert.deepEqual(viewGeometry(h.f), before);
  });

for (const exercise of Object.keys(EXERCISES).filter(
  (e) => e !== "plank" && e !== "pushup",
) as Exercise[])
  test(`${exercise}: camera pipeline preserves repetitions and short-dropout recovery`, () => {
    const h = pipeline(exercise);
    h.feed(exercisePose(exercise), 4);
    h.cycle();
    h.f.command("lock");
    for (const a of [130, 80, 55, 90, 130])
      h.feed(exercisePose(exercise, a), 0.4);
    const missing = exercisePose(exercise, 130);
    const joint =
      EXERCISES[exercise].signal === "elbow"
        ? 15
        : exercise === "deadlift"
          ? 25
          : 27;
    missing[joint].visibility = missing[joint + 1].visibility = 0;
    h.feed(missing, 0.24);
    h.feed(exercisePose(exercise), 1);
    assert.equal(h.e.counter.count, 2);
    assert.deepEqual(h.e.rows, h.baseline.rows);
    h.e.dispatch({ type: "session", action: "end" });
    assert.equal(h.e.pending.length, 1);
    assert.equal(h.e.pending[0].reps.length, 2);
  });
test("recorded push-up segment keeps all three reps through the real camera pipeline", () => {
  const h = pipeline("pushup");
  let previous = 0;
  for (const [time, joints] of recorded.frames as [number, number[][]][]) {
    const p: Point[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0,
    }));
    for (const [i, x, y, z, visibility, wx, wy, wz] of joints)
      p[i] = { x, y, z, visibility, world: { x: wx, y: wy, z: wz } };
    h.feed(p, time - previous, time - previous);
    previous = time;
  }
  assert.equal(h.e.counter.count, recorded.expected_complete_reps);
  assert.deepEqual(h.e.rows, h.baseline.rows);
});
test("push-up reacquisition resets only the pending motion, preserving completed repetitions", () => {
  const h = pipeline("pushup");
  const pose = (angle: number, offset = 0) =>
    pushupPose(angle, 90, { scale: 0.3 }).map((p) => ({
      ...p,
      x: p.x + offset,
    }));
  const cycle = (offset = 0) => {
    for (const a of [160, 140, 120, 100, 80, 95, 115, 135, 155])
      h.feed(pose(a, offset), 0.2);
    h.feed(pose(172, offset), 1);
  };
  h.feed(pose(172), 3);
  cycle();
  assert.equal(h.e.counter.count, 1);
  h.f.command("lock");
  const locked = viewGeometry(h.f);
  h.feed(pose(80), 0.5);
  h.feed([], 2);
  assert.equal(h.feed(pose(80, 0.25), 2).reacquired, 1);
  h.feed(pose(172, 0.25), 1);
  assert.equal(h.e.counter.count, 1);
  cycle(0.25);
  assert.equal(h.e.counter.count, 2);
  assert.equal(h.e.pushup.count, 2);
  assert.deepEqual(viewGeometry(h.f), locked);
});
