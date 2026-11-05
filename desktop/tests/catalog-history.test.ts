import assert from "node:assert/strict";
import { catalog } from "./fixtures/movement-catalog";
import test from "node:test";
import {
  groupWorkouts,
  historyChoices,
  historySets,
  movementResults,
} from "../src/core/catalog-history";
import { activityOverview } from "../src/core/history";
import { coverageByMuscle, filterHistory } from "../src/core/progress";
import type { RecordRow } from "../src/core/session";
import type { TimedRecord } from "../src/core/timed-training";

const startedAt = "2026-11-03T10:00:00Z";
const now = new Date("2026-11-04T12:00:00Z");
const base: TimedRecord = {
  id: "one",
  sessionId: "session",
  setIndex: 1,
  movementSlug: "barbell-curl",
  movementName: "杠铃弯举",
  mode: "timed",
  startedAt,
  duration: 40,
  goalSeconds: 60,
  load: 5,
};
const estimate: NonNullable<TimedRecord["statistics"]> = {
  mode: "reps",
  reps: 9,
  seconds: 0,
  family: "屈肘",
  ruleVersion: 1,
  source: "estimated",
  goalReps: 12,
};
const plank: RecordRow = {
  id: "old",
  exercise: "plank",
  startedAt,
  duration: 35,
  reps: [],
  holdSeconds: 24,
  holdBest: 12,
  load: 0,
  goal: 30,
};

test("unified history covers every catalog slug, original records, old timers and archived movements", () => {
  const rows = historySets(
    [plank],
    [
      { ...base, statistics: estimate, manualReps: 4 },
      {
        ...base,
        id: "other",
        movementSlug: "archived",
        movementName: "旧动作",
      },
    ],
    catalog,
  );
  const choices = historyChoices(catalog, rows);
  assert.equal(
    new Set([...choices.recorded, ...choices.remaining].map(([slug]) => slug))
      .size,
    catalog.length + 1,
  );
  assert.equal(rows[0].exercise, "front-plank");
  assert.equal(rows[2].name, "旧动作");
  const totals = activityOverview(filterHistory(rows, {}, now), now);
  assert.deepEqual(
    [totals.sets, totals.days, totals.reps, totals.volume, totals.seconds],
    [3, 1, 4, 20, 115],
  );
  assert.equal(totals.weeks.at(-1)?.sets, 3);
  assert.equal(
    coverageByMuscle(rows, now).find((g) => g.muscle === "肱二头肌")?.sets,
    1,
  );
  assert.deepEqual(
    filterHistory(rows, { exercise: "archived", from: "2026-11-04" }, now),
    [],
  );
  assert.equal(movementResults(rows)[2].series[0].label, "本组时长");
  assert.equal(movementResults(rows)[0].series[0].best, 12);
});

test("manual zero overrides the estimate and timed measures keep their actual units and sources", () => {
  const rows = historySets(
    [],
    [
      { ...base, statistics: estimate },
      { ...base, statistics: estimate, manualReps: 0 },
      { ...base, statistics: { ...estimate, mode: "hold", seconds: 17 } },
      { ...base, statistics: { ...estimate, mode: "activity", seconds: 11 } },
    ],
    catalog,
  );
  const totals = activityOverview(rows, now);
  assert.equal(totals.reps, 9);
  assert.equal(totals.volume, 45);
  const series = new Map(
    movementResults(rows)[0].series.map((s) => [s.label, s]),
  );
  assert.deepEqual(series.get("手填次数")?.recent, [0]);
  assert.deepEqual(series.get("估算次数")?.recent, [9]);
  assert.equal(series.get("估算保持时间")?.best, 17);
  assert.equal(series.get("估算活动时间")?.best, 11);
  assert(!series.has("估算 1RM"));
});

test("mixed-engine sets share one workout and old unlinked records stay separate", () => {
  const rows = historySets(
    [plank, { ...plank, id: "another" }, { ...plank, id: "planned", sessionId: "session" }],
    [{ ...base, planName: "腕与腿", startedAt: "2026-11-03T10:05:00Z" }],
    catalog,
  );
  const groups = groupWorkouts(filterHistory(rows, {}, now));
  assert.deepEqual(groups[0][1].map(row => row.record.id), ["planned", "one"]);
  assert.equal(groups.length, 3);
});
