import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CatalogPlan,
  blockForMovement,
  blockUnit,
  resolvePlan,
} from "../src/core/catalog-plan";
import { type Movement } from "../src/core/movement-library";
import { SessionEngine } from "../src/core/session";
import {
  TimedTraining,
  recoverTimedCheckpoint,
} from "../src/core/timed-training";
import { dataSchema } from "../src/core/data";
import { saveNamedPlan } from "../src/core/data-edits";
import { moveToTrash, restoreTrash } from "../src/core/trash";
import { practiceMovements } from "../src/core/free-practice";
import { appControls } from "./helpers/app-controls";

const library: Movement[] = JSON.parse(
  readFileSync(
    new URL("../public/movekit-library/catalog.json", import.meta.url),
    "utf8",
  ),
).movements;
const block = (slug: string, sets = 1, target = 1, rest = 0) => ({
  ...blockForMovement(library.find((m) => m.slug === slug)!),
  sets,
  target,
  rest,
  load: 4,
});
test("plan rest archives the set, continues its remaining sets, then starts the next exercise", () => {
  for (const mixed of [false, true]) {
    for (const skip of [false, true]) {
      const engine = new SessionEngine();
      let now = 100;
      engine.now = () => now;
      engine.cameraReady = true;
      const plan = new CatalogPlan(engine, new TimedTraining(() => now));
      const blocks = [
        { exercise: "squat" as const, sets: 3, target: 12, rest: 60, load: 0 },
        { exercise: "bench" as const, sets: 1, target: 12, rest: 60, load: 0 },
      ];
      if (mixed) plan.start(resolvePlan([...blocks, block("barbell-curl")], library));
      else engine.dispatch({ type: "start_program", blocks });
      const rest = () => mixed ? plan.command({ type: "rest_timer", seconds: 10 })
        : engine.dispatch({ type: "rest_timer", seconds: 10 });
      const endRest = () => mixed ? plan.command({ type: "session", action: "cancel_rest" })
        : engine.dispatch({ type: "session", action: "cancel_rest" });
      assert.ok(rest().ok);
      assert.equal(rest().ok, false);
      assert.equal(engine.pending.length, 1);
      if (skip) {
        assert.ok((mixed ? plan.skipRemainingSets() : engine.skipRemainingSets()).ok);
      } else {
        assert.ok(endRest().ok);
        assert.equal(engine.exercise, "squat");
        assert.equal(engine.currentRecord().setIndex, 2);
        rest();
        now += 10;
        if (mixed) plan.tick(); else engine.tick();
        assert.equal(engine.currentRecord().setIndex, 3);
        rest();
        assert.ok(endRest().ok);
      }
      assert.equal(engine.exercise, "bench");
      assert.equal(engine.currentRecord().blockIndex, 1);
      assert.equal(engine.currentRecord().setIndex, 1);
      assert.deepEqual(engine.pending.map(row => row.setIndex), skip ? [1] : [1, 2, 3]);
    }
  }
});
test("every library movement starts a plan set with its own identity, goal, load and tracker", () => {
  assert.equal(library.length, 582);
  for (const movement of library) {
    const engine = new SessionEngine(),
      timed = new TimedTraining(),
      plan = new CatalogPlan(engine, timed);
    const b = block(movement.slug, 1, 8);
    const items = resolvePlan([b], library);
    engine.cameraReady = items[0].camera;
    assert.ok(plan.start(items).ok, movement.slug);
    if ("exercise" in b) {
      assert.equal(engine.exercise, b.exercise);
      assert.equal(engine.checkpoint()?.goal, 8);
      assert.equal(engine.checkpoint()?.load, 4);
    } else {
      const record = timed.checkpoint()!;
      assert.equal(record.movementSlug, movement.slug);
      assert.equal(record.load, 4);
      assert.equal(
        b.unit === "reps" ? record.statistics?.goalReps : record.goalSeconds,
        8,
      );
    }
    assert.ok(plan.complete().ok);
    assert.equal(plan.active, false);
  }
});
test("mixed plan archives each group once, pauses rest, skips rest, and counts only training time", () => {
  let now = 0;
  const engine = new SessionEngine();
  engine.now = () => now;
  const timed = new TimedTraining(() => now);
  engine.cameraReady = true;
  const plan = new CatalogPlan(engine, timed);
  assert.ok(
    plan.start(
      resolvePlan(
        [
          block("bodyweight-squat", 1, 4, 8),
          block("barbell-curl", 2, 5, 5),
          block("dumbbell-wrist-curl", 1, 6),
        ],
        library,
      ),
    ).ok,
  );
  now = 2;
  assert.ok(plan.complete().ok);
  assert.equal(plan.overlay().remaining, 8);
  now = 4;
  plan.pause();
  now = 40;
  assert.equal(plan.tick(), undefined);
  assert.equal(plan.overlay().remaining, 6);
  plan.command({ type: "session", action: "resume" });
  now = 46;
  assert.ok(plan.tick()?.ok);
  assert.equal(timed.movement?.slug, "barbell-curl");
  timed.setManualReps(5);
  assert.ok(plan.tick()?.ok);
  assert.equal(timed.pending.length, 1);
  assert.ok(plan.command({ type: "session", action: "cancel_rest" }).ok);
  assert.equal(timed.checkpoint()?.setIndex, 2);
  assert.equal(timed.manualReps, undefined);
  plan.complete();
  now += 5;
  plan.tick();
  assert.equal(timed.snapshot()?.statistics.mode, "timer");
  now += 5;
  assert.equal(plan.tick(), undefined);
  now++;
  assert.ok(plan.tick()?.ok);
  assert.equal(plan.active, false);
  const rows = [...engine.pending, ...timed.pending];
  assert.deepEqual(
    rows.map((r) => [r.blockIndex, r.setIndex]),
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 1],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.sessionId)).size, 1);
  assert.equal(new Set(rows.map((r) => r.id)).size, 4);
  assert.equal(timed.pending[2].duration, 6);
});
test("the app validates catalog identity and units before requesting a camera, and can start a timer-only plan without one", async () => {
  let cameras = 0;
  const app = appControls({
    movementLibrary: library,
    startCamera: async () => {
      cameras++;
    },
  });
  const b = block("dumbbell-wrist-curl");
  assert.equal(blockUnit(b), "seconds");
  for (const patch of [{ movementSlug: "missing" }, { unit: "reps" }]) {
    const receipt = await app.dispatch({
      type: "start_catalog_program",
      blocks: [{ ...b, ...patch }],
    });
    assert.equal(receipt.ok, false);
  }
  assert.equal(
    (await app.dispatch({ type: "start_catalog_program", blocks: [b] })).ok,
    true,
  );
  assert.equal(cameras, 0);
  assert.equal(
    (
      await app.dispatch({
        type: "start_catalog_program",
        blocks: [block("barbell-curl")],
      })
    ).ok,
    false,
  );
  assert.equal((await app.dispatch({ type: "complete_plan_set" })).ok, true);
  assert.equal(app.dataRef.current.timedRecords?.length, 1);
  assert.equal(app.dataRef.current.timedCheckpoint, null);
  assert.equal(
    (
      await app.dispatch({
        type: "start_catalog_program",
        blocks: [block("barbell-curl")],
      })
    ).ok,
    false,
  );
  assert.equal(cameras, 1);
  assert.equal(app.catalogPlan.active, false);
});
test("v4 favorites and plans survive adding a mixed plan, deletion, restore and interrupted-set recovery", () => {
  const base = dataSchema.parse({
    version: 4,
    settings: { voice: false },
    records: [],
    freePractice: { movementSlugs: ["barbell-curl"] },
    plans: [{ id: "old", name: "旧计划", blocks: [block("push-up")] }],
  });
  const saved = saveNamedPlan(
    { ...base, settings: { voice: false }, version: 5 },
    "混合计划",
    [block("barbell-curl", 2), block("front-plank")],
  );
  const trashed = moveToTrash(saved, { kind: "plan", id: saved.plans![1].id });
  const restored = restoreTrash(trashed, trashed.trash![0].id);
  const engine = new SessionEngine(),
    timed = new TimedTraining(),
    plan = new CatalogPlan(engine, timed);
  engine.cameraReady = true;
  plan.start(resolvePlan(restored.plans![1].blocks, library));
  plan.complete();
  plan.tick();
  const recovered = recoverTimedCheckpoint({
    ...restored,
    timedCheckpoint: timed.checkpoint(),
  });
  assert.ok(dataSchema.safeParse(recovered).success);
  assert.deepEqual(practiceMovements(recovered), ["barbell-curl"]);
  assert.deepEqual(recovered.plans, saved.plans);
  assert.equal(recovered.timedRecords![0].setIndex, 2);
  assert.equal(recovered.timedRecords![0].blockIndex, 0);
  assert.equal(recovered.timedRecords![0].interrupted, true);
});
