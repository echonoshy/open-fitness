import test from "node:test";
import assert from "node:assert/strict";
import { SessionEngine } from "../src/core/session";
import { pushupSample } from "../src/core/pushup";
import { motionFeedback } from "../src/core/training-feedback";
import { countingHints } from "../src/core/environment";
import { pushupPose } from "./fixtures/pushup-pose";
import { recordSchema } from "../src/core/data";
import { stats } from "../src/core/history";
import { canUseAsReference } from "../src/core/references";
import recorded from "./fixtures/pushup-recorded-segment.json";
import type { Point } from "../src/core/engine";

function runner(
  yaw = 90,
  options: Parameters<typeof pushupPose>[2] = {},
  fps = 20,
) {
  const e = new SessionEngine();
  let t = 10;
  e.now = () => t;
  e.cameraReady = true;
  e.dispatch({ type: "set_exercise", exercise: "pushup" });
  e.dispatch({ type: "set_rep_goal", reps: 100 });
  e.dispatch({ type: "session", action: "start" });
  const pose = (degrees: number) => pushupPose(degrees, yaw, options);
  const feed = (p: Point[], seconds = 0.25) => {
    for (let i = 0; i < Math.ceil(seconds * fps); i++)
      e.frame(structuredClone(p), (t += 1 / fps), options.aspect ?? 16 / 9);
  };
  const hold = (degrees: number, seconds = 0.3) => feed(pose(degrees), seconds);
  const down = (bottom = 80) => {
    for (let a = 160; a > bottom; a -= 12) hold(a, 0.1);
    hold(bottom, 0.3);
  };
  const up = () => {
    for (let a = 95; a < 172; a += 12) hold(a, 0.1);
    hold(172, 0.5);
  };
  const cycle = (bottom = 80) => {
    down(bottom);
    up();
  };
  return {
    e,
    feed,
    hold,
    pose,
    down,
    up,
    cycle,
    jump: (seconds: number) => {
      t += seconds;
    },
  };
}

for (const [name, yaw] of [
  ["front", 0],
  ["oblique", 45],
  ["side", 90],
] as const) {
  for (const mirror of [false, true])
    test(`${name}, mirrored=${mirror}: 3 complete cycles, no hold double-count`, () => {
      const r = runner(yaw, { mirror });
      r.hold(172, 0.8);
      assert.equal(r.e.snapshot().pushupCheck?.view, name);
      for (let i = 1; i <= 3; i++) {
        r.cycle();
        assert.equal(r.e.counter.count, i);
      }
      r.hold(172, 3);
      assert.equal(r.e.counter.count, 3);
      assert.equal(r.e.rows.length, 3);
      assert.ok(
        r.e.rows.every((row) => row.assessment?.limited && row.duration > 0),
      );
    });
  test(`${name}: incomplete cycles, nodding, static hold and standing do not count`, () => {
    const r = runner(yaw);
    r.hold(172, 0.8);
    for (let i = 0; i < 3; i++) {
      r.down(135);
      r.up();
    }
    assert.equal(r.e.counter.count, 0);
    for (let i = 0; i < 30; i++) {
      const p = r.pose(172);
      p[0].y += 0.08 * Math.sin(i);
      r.feed(p, 0.05);
    }
    assert.equal(r.e.counter.count, 0);
    const standing = runner(yaw, { standing: true });
    standing.hold(172, 0.8);
    standing.cycle();
    assert.equal(standing.e.counter.count, 0);
  });
  test(`${name}: startup at bottom and incomplete return do not create a rep`, () => {
    const r = runner(yaw);
    r.hold(80, 1);
    r.up();
    assert.equal(r.e.counter.count, 0);
    r.hold(172, 0.8);
    r.down();
    r.hold(135, 0.5);
    assert.equal(r.e.counter.count, 0);
    r.hold(172, 0.5);
    assert.equal(r.e.counter.count, 1);
  });
}
for (const aspect of [16 / 9, 1, 9 / 16])
  for (const world of [false, true]) {
    test(`projection aspect=${aspect}, world=${world}: oblique count remains consistent`, () => {
      const r = runner(45, { aspect, world });
      r.hold(172, 0.8);
      r.cycle();
      assert.equal(r.e.counter.count, 1);
    });
  }
for (const fps of [8, 15, 30])
  test(`${fps} fps: three views tolerate small landmark noise`, () => {
    for (const yaw of [0, 45, 90]) {
      const r = runner(yaw, { noise: 0.002 }, fps);
      r.hold(172, 0.9);
      r.cycle();
      r.cycle();
      assert.equal(r.e.counter.count, 2, `yaw ${yaw}`);
    }
  });
test("side view counts using either near arm while the far arm is hidden", () => {
  for (const side of [0, 1]) {
    const r = runner(90, { hidden: [11, 13, 15, 23, 27].map((i) => i + side) });
    r.hold(172, 0.8);
    r.cycle();
    assert.equal(r.e.counter.count, 1);
  }
});
test("front view with one arm hidden pauses without invented form faults", () => {
  const r = runner(0, { hidden: [14, 16] });
  r.hold(172, 1);
  r.cycle();
  assert.equal(r.e.counter.count, 0);
  assert.deepEqual(r.e.faults, []);
  assert.match(r.e.pushup.check.message, /双臂/);
});
test("short occlusion after observed bottom resumes once; long loss cancels only unfinished rep", () => {
  const r = runner(0);
  r.hold(172, 0.8);
  r.cycle();
  r.down();
  r.feed([], 0.1);
  r.hold(80, 0.2);
  r.up();
  assert.equal(r.e.counter.count, 2);
  r.down();
  r.feed([], 0.7);
  r.up();
  assert.equal(r.e.counter.count, 2);
  r.hold(172, 0.8);
  r.cycle();
  assert.equal(r.e.counter.count, 3);
});
test("unobserved bottom cannot be filled in after a dropout", () => {
  const r = runner(45);
  r.hold(172, 0.8);
  r.hold(140, 0.3);
  r.feed([], 0.1);
  r.hold(145, 0.2);
  r.up();
  assert.equal(r.e.counter.count, 0);
});
test("mid-rep view change preserves completed reps but discards the mixed-view cycle", () => {
  const r = runner(90);
  r.hold(172, 0.8);
  r.cycle();
  r.down();
  r.feed(pushupPose(100, 0), 0.3);
  r.feed(pushupPose(172, 0), 1);
  assert.equal(r.e.counter.count, 1);
  assert.equal(r.e.pushup.check.view, "front");
});
test("camera movement, source change and long frame gaps cannot complete pending cycles", () => {
  for (const type of ["movement", "source", "gap"]) {
    const r = runner(45);
    r.hold(172, 0.8);
    r.down();
    const p = r.pose(172);
    if (type === "movement") p.forEach((v) => (v.x += 0.2));
    if (type === "source") p.forEach((v) => delete v.world);
    if (type === "gap") r.jump(1);
    r.feed(p, 0.5);
    assert.equal(r.e.counter.count, 0, type);
  }
});
test("pause/resume and changing exercise cannot reuse a partial push-up", () => {
  const r = runner(0);
  r.hold(172, 0.8);
  r.cycle();
  r.down();
  r.e.dispatch({ type: "session", action: "pause" });
  r.up();
  r.e.dispatch({ type: "session", action: "resume" });
  r.hold(172, 0.8);
  assert.equal(r.e.counter.count, 1);
  r.cycle();
  assert.equal(r.e.counter.count, 2);
  r.e.dispatch({ type: "set_exercise", exercise: "curl" });
  assert.equal(r.e.snapshot().pushupCheck, undefined);
});
test("front/oblique never infer hidden back or elbow faults; visible side sag requires persistence", () => {
  for (const yaw of [0, 45]) {
    const r = runner(yaw, { sag: 0.2 });
    r.hold(172, 0.8);
    r.cycle();
    assert.deepEqual(r.e.faults, []);
    assert.ok(r.e.rows.every((row) => row.faults.length === 0));
    assert.equal(r.e.pushup.check.bodyLineVisible, false);
  }
  const r = runner(90);
  r.hold(172, 0.8);
  r.down();
  r.feed(pushupPose(80, 90, { sag: 0.2 }), 0.1);
  assert.deepEqual(r.e.faults, []);
  r.feed(pushupPose(80, 90, { sag: 0.2 }), 0.4);
  assert.deepEqual(r.e.faults, ["body_sag"]);
  const hidden = pushupPose(80, 90, { sag: 0.2, hidden: [27, 28] });
  r.feed(hidden, 0.1);
  assert.deepEqual(r.e.faults, []);
  assert.equal(r.e.pushup.check.bodyLineVisible, false);
});
test("UI and voice hints describe supported views and pause state without legacy side-only threshold advice", () => {
  const r = runner(0);
  r.hold(172, 0.8);
  assert.doesNotMatch(
    motionFeedback(r.e.snapshot(), true).detail,
    /95|155|侧对摄像头/,
  );
  assert.match(countingHints(r.e.snapshot()).join(" "), /腰背/);
  r.feed([], 0.1);
  assert.match(motionFeedback(r.e.snapshot(), true).title, /暂不计数/);
  assert.equal(motionFeedback(r.e.snapshot(), true).angle, undefined);
});
test("malformed coordinates and coincident joints cannot produce a tracking signal", () => {
  const p = pushupPose(172, 0);
  p[13] = { ...p[11] };
  p[14] = { ...p[12] };
  assert.equal(pushupSample(p), null);
  assert.equal(pushupSample([]), null);
});
test("changing hip-relative z origin does not look like a moving camera", () => {
  const r = runner(90);
  r.hold(172, 0.8);
  for (const a of [155, 135, 105, 80, 80, 95, 120, 145, 172, 172]) {
    const p = r.pose(a);
    p.forEach((v) => (v.z -= (172 - a) * 0.006));
    r.feed(p, 0.25);
  }
  assert.equal(r.e.counter.count, 1);
});
test("rear-end footage is not labelled as a supported front view", () => {
  const r = runner(0);
  for (const a of [172, 150, 120, 80, 100, 145, 172]) {
    const p = r.pose(a);
    p.forEach((v) => {
      v.z *= -1;
      if (v.world) v.world.z *= -1;
    });
    r.feed(p, 0.6);
  }
  assert.equal(r.e.counter.count, 0);
  assert.notEqual(r.e.pushup.check.view, "front");
});
test("partial assessment survives saving and is excluded from full-form scores and references", () => {
  const r = runner(0);
  r.hold(172, 0.8);
  r.cycle();
  const saved = recordSchema.parse(r.e.currentRecord());
  assert.equal(saved.reps[0].assessment?.view, "front");
  assert.equal(stats(saved).score, null);
  assert.ok(stats(saved).tempo! > 0);
  assert.equal(canUseAsReference(saved.reps[0]), false);
  assert.equal(saved.reps[0].velocity, undefined);
});
test("recorded full-depth cycle counts despite a noisy 3D elbow estimate", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "set_exercise", exercise: "pushup" });
  e.dispatch({ type: "session", action: "start" });
  for (const [time, joints] of recorded.frames as [number, number[][]][]) {
    const p: Point[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0,
    }));
    for (const [i, x, y, z, visibility, wx, wy, wz] of joints)
      p[i] = { x, y, z, visibility, world: { x: wx, y: wy, z: wz } };
    e.frame(p, time + 10, recorded.aspect);
  }
  assert.equal(e.counter.count, recorded.expected_complete_reps);
});
