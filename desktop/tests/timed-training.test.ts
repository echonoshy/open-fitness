import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TimedTraining,
  recoverTimedCheckpoint,
  mergeTimedRecords,
} from "../src/core/timed-training";
import { dataSchema } from "../src/core/data";
import { mergeImportedData } from "../src/core/data-edits";
import {
  movementCapability,
  type Movement,
} from "../src/core/movement-library";
import { timedVoiceIntent } from "../src/core/timed-voice";
import { appControls } from "./helpers/app-controls";

const catalog: Movement[] = JSON.parse(
  readFileSync(
    new URL("../public/movekit-library/catalog.json", import.meta.url),
    "utf8",
  ),
).movements;
const movement = catalog.find((m) => m.slug === "dumbbell-lateral-raise")!;
assert.ok(movement && !movement.trainingExercise);
const make = () => {
  let seconds = 100;
  const training = new TimedTraining(() => seconds);
  training.select(movement);
  training.setCameraStatistics(false);
  return {
    training,
    advance: (s: number) => {
      seconds += s;
    },
  };
};
const command = (
  t: TimedTraining,
  action: "start" | "pause" | "resume" | "end" | "cancel_rest",
) => t.dispatch({ type: "session", action });

test("all catalogue movements have explicit capabilities; variants do not inherit counters", () => {
  assert.equal(catalog.length, 582);
  assert.equal(
    catalog.filter((m) => movementCapability(m) === "自动计数").length,
    8,
  );
  assert.equal(
    catalog.filter((m) => movementCapability(m) === "姿态计时").length,
    1,
  );
  assert.ok(
    catalog.filter((m) => movementCapability(m) === "估算计数").length > 300,
  );
  assert.ok(
    catalog.filter((m) => movementCapability(m) === "计时记录").length < 50,
  );
});

test("timer excludes pauses and rests, including a pause during rest", () => {
  const { training: t, advance } = make();
  command(t, "start");
  advance(12);
  command(t, "pause");
  advance(50);
  assert.equal(t.snapshot()!.elapsed, 12);
  command(t, "resume");
  advance(8);
  t.dispatch({ type: "rest_timer", seconds: 30 });
  advance(10);
  command(t, "pause");
  advance(100);
  assert.equal(t.snapshot()!.elapsed, 20);
  command(t, "resume");
  advance(23);
  assert.equal(t.snapshot()!.elapsed, 23);
  assert.equal(t.snapshot()!.status, "training");
  command(t, "end");
  assert.equal(t.pending[0].duration, 23);
});

test("cancel rest, new set, goals and manual counts preserve separate per-set records", () => {
  const { training: t, advance } = make();
  assert.throws(() => t.setManualReps(10), /先开始/);
  assert.equal(
    t.dispatch({ type: "new_set", target: 90, unit: "seconds" }).ok,
    true,
  );
  assert.equal(t.snapshot()!.setIndex, 1);
  advance(6);
  t.setManualReps(12);
  t.dispatch({ type: "set_load", kg: 5 });
  t.dispatch({ type: "rest_timer", seconds: 30 });
  advance(5);
  command(t, "cancel_rest");
  advance(4);
  assert.equal(t.snapshot()!.elapsed, 10);
  t.dispatch({ type: "new_set" });
  assert.equal(t.pending.length, 1);
  assert.equal(t.pending[0].manualReps, 12);
  assert.equal(t.pending[0].load, 5);
  assert.equal(t.snapshot()!.manualReps, undefined);
  assert.equal(t.snapshot()!.setIndex, 2);
  advance(5);
  command(t, "end");
  assert.equal(t.pending[1].duration, 5);
  assert.equal(t.pending[1].sessionId, t.pending[0].sessionId);
  assert.notEqual(t.pending[1].id, t.pending[0].id);
  command(t, "start");
  assert.equal(t.snapshot()!.setIndex, 1);
  assert.notEqual(t.checkpoint()!.sessionId, t.pending[0].sessionId);
});

test("timer validates input and never changes a set in response to a rep target", () => {
  const { training: t } = make();
  command(t, "start");
  for (const n of [-1, 1.5, 1001, Infinity, NaN])
    assert.throws(() => t.setManualReps(n));
  t.setManualReps(0);
  assert.equal(t.checkpoint()!.manualReps, 0);
  t.setManualReps(undefined);
  assert.equal(t.checkpoint()!.manualReps, undefined);
  const before = t.checkpoint()!.id;
  assert.equal(
    t.dispatch({ type: "new_set", target: 12, unit: "reps" }).ok,
    false,
  );
  assert.equal(t.dispatch({ type: "set_hold_goal", seconds: -1 }).ok, false);
  assert.equal(t.dispatch({ type: "set_load", kg: NaN }).ok, false);
  assert.equal(t.dispatch({ type: "auto_detect", enabled: true }).ok, false);
  assert.equal(t.checkpoint()!.id, before);
  assert.equal(t.pending.length, 0);
});

test("checkpoint recovery is idempotent and imports cannot overwrite a live timer", () => {
  const { training: t, advance } = make();
  command(t, "start");
  advance(15);
  t.setManualReps(8);
  const base = dataSchema.parse({
    settings: { voice: false },
    records: [],
    timedCheckpoint: t.checkpoint(),
  });
  const restored = recoverTimedCheckpoint(base);
  assert.equal(restored.timedRecords![0].interrupted, true);
  assert.equal(restored.timedRecords![0].manualReps, 8);
  assert.equal(restored.records.length, 0);
  assert.deepEqual(recoverTimedCheckpoint(restored), restored);
  const merged = mergeImportedData(
    { ...base, settings: { ...base.settings, voice: false } },
    {
      records: [],
      timedRecords: restored.timedRecords,
    },
  );
  assert.equal(merged.data.timedRecords.length, 0);
  assert.equal(merged.data.timedCheckpoint!.id, t.checkpoint()!.id);
  advance(5);
  command(t, "end");
  const completed = t.pending[0];
  assert.deepEqual(mergeTimedRecords([completed], restored.timedRecords!), [
    completed,
  ]);
  assert.equal(
    dataSchema.safeParse({
      ...base,
      timedRecords: [{ ...completed, manualReps: -1 }],
    }).success,
    false,
  );
});

test("actual App switches from counting to timed training and back without leaking results", async () => {
  const { training, advance } = make();
  training.select(null);
  const h = appControls({ timedTraining: training });
  await h.dispatch({ type: "session", action: "start" });
  await h.launchTraining(movement);
  assert.equal(h.engine.active, false);
  assert.equal(h.snapshot().timed!.movement.slug, movement.slug);
  assert.deepEqual(h.snapshot().faults, []);
  assert.deepEqual(h.snapshot().angles, {});
  assert.equal(h.snapshot().squatCheck, undefined);
  h.engine.cameraReady = false;
  await h.dispatch({ type: "session", action: "start" });
  assert.equal(h.engine.cameraReady, true, "catalog estimates open the camera");
  advance(12);
  await h.setManualReps(7);
  await h.dispatch({ type: "set_exercise", exercise: "curl" });
  assert.equal(h.snapshot().timed, undefined);
  assert.equal(h.snapshot().exercise, "curl");
  assert.equal(h.dataRef.current.timedRecords![0].duration, 12);
  assert.equal(h.dataRef.current.timedRecords![0].manualReps, 7);
  assert.equal(h.dataRef.current.timedCheckpoint, null);
});

test("failed timed save retains a retryable record and never emits a success receipt", async () => {
  const { training, advance } = make();
  let failing = false;
  const h = appControls({
    timedTraining: training,
    saveData: async () => {
      if (failing) throw Error("disk failed");
    },
  });
  await h.dispatch({ type: "session", action: "start" });
  advance(4);
  failing = true;
  await assert.rejects(
    h.dispatch({ type: "session", action: "end" }),
    /disk failed/,
  );
  assert.equal(training.pending.length, 1);
  assert.equal(h.dataRef.current.timedRecords?.length ?? 0, 0);
  failing = false;
  await h.dispatch({ type: "session", action: "start" });
  assert.equal(training.pending.length, 0);
  assert.equal(h.dataRef.current.timedRecords!.length, 1);
});

test("timed voice uses current movement, manual count and real timer, never old exercise state", async () => {
  const { training, advance } = make();
  const h = appControls({
    timedTraining: training,
    data: { settings: { voice: false }, records: [] },
    request: async () => {
      assert.fail("these local commands need no model or TTS");
    },
  });
  await h.ask("开始计时");
  advance(9);
  await h.ask("这组做了十二次");
  assert.equal(training.manualReps, 12);
  await h.ask("我练了多久");
  assert.match(h.messages.at(-1).content, /哑铃侧平举.*9 秒.*12 次/);
  await h.ask("暂停训练");
  advance(50);
  assert.equal(training.snapshot()!.elapsed, 9);
  await h.ask("结束并保存");
  assert.match(h.messages.at(-1).content, /记录已保存/);
  assert.equal(h.dataRef.current.timedRecords!.length, 1);
  assert.equal(h.dataRef.current.records.length, 0);
});

test("negated, quoted and hypothetical counts cannot mutate records through the local parser", () => {
  for (const text of [
    "不要记录为十二次",
    "如果我做了十二次呢",
    "教练说这组做了十二次",
    "这组做了十二次吗",
    "下次开始计时",
    "不要暂停训练",
  ])
    assert.equal(timedVoiceIntent(text).kind, "advice", text);
});

test("voice selects a named catalogue movement without starting it or reusing an unrelated counter", async () => {
  const h = appControls({
    movementLibrary: catalog,
    data: { settings: { voice: false }, records: [] },
    request: async () => {
      assert.fail("catalogue selection needs no model");
    },
  });
  await h.ask("换成哑铃侧平举");
  assert.equal(h.snapshot().timed!.movement.slug, movement.slug);
  assert.equal(h.snapshot().status, "ready");
  assert.match(h.messages.at(-1).content, /估算计数/);
  await h.ask("换成哑铃弯举");
  assert.equal(h.snapshot().timed, undefined);
  assert.equal(h.snapshot().exercise, "curl");
  assert.equal(h.engine.active, false);
  assert.match(h.messages.at(-1).content, /自动计数/);
});

test("a cancelled voice switch saves the old set but cannot select a new movement late", async () => {
  const { training, advance } = make();
  command(training, "start");
  advance(10);
  let finishWrite!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const h = appControls({
    timedTraining: training,
    movementLibrary: catalog,
    data: { settings: { voice: false }, records: [] },
    saveData: () => pending,
  });
  const turn = h.ask("换成哑铃弯举");
  await new Promise((resolve) => setImmediate(resolve));
  h.cancel();
  finishWrite();
  await turn;
  assert.equal(h.snapshot().timed!.movement.slug, movement.slug);
  assert.equal(h.dataRef.current.timedRecords!.length, 1);
  assert.equal(h.messages.filter((m) => m.role === "assistant").length, 0);
});
