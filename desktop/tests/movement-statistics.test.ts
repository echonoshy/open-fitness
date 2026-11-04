import { catalogCameraGuide } from "../src/components/catalog-camera-guides";
import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "./fixtures/movement-catalog";
import {
  MovementStatistics,
  movementProfile,
  effectiveMovementProfile,
  motionValue,
} from "../src/core/movement-statistics";
import {
  TimedTraining,
  recoverTimedCheckpoint,
} from "../src/core/timed-training";
import { dataSchema } from "../src/core/data";
import type { Point } from "../src/core/engine";
import { appControls } from "./helpers/app-controls";

const item = (slug: string) => catalog.find((m) => m.slug === slug)!;
function pose(deg = 170): Point[] {
  const p = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  for (const [id, x, y] of [
    [11, 0.4, 0.3],
    [12, 0.6, 0.3],
    [13, 0.4, 0.45],
    [14, 0.6, 0.45],
    [23, 0.43, 0.65],
    [24, 0.57, 0.65],
    [25, 0.43, 0.78],
    [26, 0.57, 0.78],
    [27, 0.43, 0.9],
    [28, 0.57, 0.9],
  ])
    p[id] = { x, y, z: 0, visibility: 1 };
  const rad = (deg * Math.PI) / 180;
  p[15] = {
    x: 0.4 + Math.sin(rad) * 0.15,
    y: 0.45 - Math.cos(rad) * 0.15,
    z: 0,
    visibility: 1,
  };
  p[16] = {
    x: 0.6 - Math.sin(rad) * 0.15,
    y: 0.45 - Math.cos(rad) * 0.15,
    z: 0,
    visibility: 1,
  };
  return p;
}
function cycles(frame: (p: Point[], t: number) => void, n = 4, start = 0) {
  for (let i = 0; i <= n * 40 + 8; i++) {
    const phase = Math.min(i, n * 40) % 40;
    const degree =
      i >= n * 40
        ? 170
        : 170 - 110 * (phase <= 20 ? phase / 20 : (40 - phase) / 20);
    frame(pose(degree), start + i * 0.05);
  }
}

test("complete bilateral cycles count once each; static noise and half repetitions do not count", () => {
  const s = new MovementStatistics(movementProfile(item("barbell-curl")));
  cycles((p, t) => s.frame(p, t, 1), 5);
  assert.equal(s.reps, 5);
  s.reset();
  for (let i = 0; i < 200; i++)
    s.frame(pose(90 + Math.sin(i) * 2), 20 + i * 0.05, 1);
  assert.equal(s.reps, 0);
  s.reset();
  for (let i = 0; i < 40; i++) s.frame(pose(170 - i * 2.5), 40 + i * 0.05, 1);
  assert.equal(s.reps, 0);
});

test("lost tracking and elapsed camera gaps discard unfinished cycles", () => {
  const s = new MovementStatistics(movementProfile(item("barbell-curl")));
  for (let i = 0; i < 20; i++) s.frame(pose(170 - i * 5), i * 0.05, 1);
  s.frame([], 1, 1);
  for (let i = 0; i < 20; i++) s.frame(pose(170), 2 + i * 0.05, 1);
  assert.equal(s.reps, 0);
  cycles((p, t) => s.frame(p, t, 1), 2, 5);
  assert.equal(s.reps, 2);
  s.frame(pose(60), 100, 1);
  s.frame(pose(170), 100.05, 1);
  assert.equal(s.reps, 2);
  assert.equal(motionValue(pose(), "elbow", NaN), null);
});

test("activity time requires motion; hold time requires matching pose and visible joints", () => {
  const activity = new MovementStatistics({
    ...movementProfile(item("treadmill-run")),
    mode: "activity",
  });
  for (let i = 0; i < 100; i++) activity.frame(pose(), i * 0.05, 1);
  assert.equal(activity.seconds, 0);
  cycles((p, t) => activity.frame(p, t, 1), 2, 6);
  assert.ok(activity.seconds > 1 && activity.seconds < 5);
  const prior = activity.seconds;
  activity.frame([], 20, 1);
  activity.frame(pose(), 30, 1);
  assert.equal(activity.seconds, prior);
  const hold = new MovementStatistics(
    { ...movementProfile(item("barbell-curl")), mode: "hold" },
    90,
  );
  for (let i = 0; i < 30; i++) hold.frame(pose(170), i * 0.1, 1);
  assert.equal(hold.seconds, 0);
  for (let i = 0; i < 30; i++) hold.frame(pose(90), 4 + i * 0.1, 1);
  assert.ok(hold.seconds > 2 && hold.seconds < 3);
  const recorded = hold.seconds;
  hold.frame([], 8, 1);
  hold.frame(pose(90), 20, 1);
  assert.equal(hold.seconds, recorded);
});

test("specific families take precedence over ambiguous name fragments", () => {
  for (const slug of ["crunches", "reverse-crunch", "machine-crunch"])
    assert.equal(movementProfile(item(slug)).mode, "reps");
  assert.equal(movementProfile(item("behind-the-neck-press")).mode, "reps");
  assert.equal(movementProfile(item("neck-curl")).mode, "timer");
  assert.equal(movementProfile(item("seated-leg-curl")).metric, "knee");
  assert.equal(
    movementProfile(item("dumbbell-tricep-kickback")).metric,
    "elbow",
  );
  assert.equal(
    movementProfile(item("side-plank-lateral-raise")).mode,
    "activity",
  );
});

test("all camera-tracked movements have a placement diagram, timer-only movements need none", () => {
  for (const m of catalog) {
    assert.ok(effectiveMovementProfile(m).hint, m.slug);
    if (!m.trainingExercise)
      assert.equal(!!catalogCameraGuide(m.slug), effectiveMovementProfile(m).mode !== "timer", m.slug);
  }
});

test("both dumbbell one-arm rows place the lens on the loaded side, with a lower lens for floor work", () => {
  const row = catalogCameraGuide("dumbbell-single-arm-row")!;
  assert.equal(catalogCameraGuide("dumbbell-row-unilateral"), row);
  assert.match(row.title, /持铃手一侧/);
  assert.match(row.detail, /肩、肘和手腕/);
  assert.ok(row.equipment);
  assert.ok(catalogCameraGuide("hand-plank")!.cameraY > row.cameraY);
  assert.equal(catalogCameraGuide("freestyle-swim"), undefined);
});

test("session records auto estimates alongside manual corrections and survives backup recovery", () => {
  let now = 0;
  const t = new TimedTraining(() => now);
  t.select(item("barbell-curl"));
  t.dispatch({ type: "session", action: "start" });
  cycles((p, time) => {
    now = time;
    t.frame(p, time, 1);
  }, 3);
  assert.equal(t.snapshot()!.statistics.reps, 3);
  t.dispatch({ type: "session", action: "pause" });
  cycles(
    (p, time) => {
      now = time;
      t.frame(p, time, 1);
    },
    2,
    10,
  );
  assert.equal(t.snapshot()!.statistics.reps, 3);
  t.setManualReps(4);
  const backup = dataSchema.parse({
    version: 4,
    settings: {},
    records: [],
    timedCheckpoint: t.checkpoint(),
  });
  const restored = recoverTimedCheckpoint(backup).timedRecords![0];
  assert.equal(restored.manualReps, 4);
  assert.equal(restored.statistics!.reps, 3);
  assert.equal(restored.interrupted, true);
  assert.throws(() => t.setCameraStatistics(false), /先结束/);
  t.dispatch({ type: "session", action: "end" });
  assert.equal(t.snapshot()!.manualReps, undefined);
  assert.equal(t.snapshot()!.statistics.reps, 0);
  t.setCameraStatistics(false);
  assert.equal(t.snapshot()!.statistics.mode, "timer");
  assert.equal(
    t.dispatch({ type: "new_set", target: 200, unit: "reps" }).ok,
    false,
  );
});

test("App starts camera for estimates, supports timer fallback and reports estimated voice status", async () => {
  const t = new TimedTraining();
  t.select(item("barbell-curl"));
  const h = appControls({
    timedTraining: t,
    data: { settings: { voice: false }, records: [] },
  });
  await h.dispatch({ type: "session", action: "start" });
  assert.equal(h.engine.cameraReady, true);
  cycles((p, time) => t.frame(p, time, 1), 2);
  assert.equal(h.snapshot().reps, 2);
  await h.ask("我做了多少次");
  assert.match(h.messages.at(-1).content, /估算 2 次/);
  await h.dispatch({ type: "session", action: "end" });
  assert.equal(h.dataRef.current.timedRecords![0].statistics!.reps, 2);
  t.setCameraStatistics(false);
  h.engine.cameraReady = false;
  await h.dispatch({ type: "session", action: "start" });
  assert.equal(h.engine.cameraReady, false);
});

test("camera failure cannot start a catalog estimate or persist a phantom set", async () => {
  const t = new TimedTraining();
  t.select(item("barbell-curl"));
  const h = appControls({ timedTraining: t, startCamera: async () => {} });
  const result = await h.dispatch({ type: "session", action: "start" });
  assert.equal(result.ok, false);
  assert.equal(t.active, false);
  assert.equal(t.checkpoint(), null);
});

test("a pause during camera startup cancels a delayed estimate start", async () => {
  const t = new TimedTraining();
  t.select(item("barbell-curl"));
  let ready!: () => void;
  const pending = new Promise<void>((resolve) => { ready = resolve; });
  const h = appControls({ timedTraining: t, startCamera: async () => {
    await pending; h.engine.cameraReady = true;
  } });
  const opening = h.dispatch({ type: "session", action: "start" });
  await h.dispatch({ type: "session", action: "pause" });
  ready();
  assert.equal((await opening).ok, false);
  assert.equal(t.active, false);
  assert.equal(t.checkpoint(), null);
});

test("a repetitions session rejects seconds targets before replacing an active set", () => {
  const t = new TimedTraining(); t.select(item("barbell-curl"));
  t.dispatch({type:"session",action:"start"});
  const id = t.checkpoint()!.id;
  assert.equal(t.dispatch({type:"new_set",target:60,unit:"seconds"}).ok,false);
  assert.equal(t.dispatch({type:"set_hold_goal",seconds:60}).ok,false);
  assert.equal(t.checkpoint()!.id,id);
  assert.equal(t.pending.length,0);
});
