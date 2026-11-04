import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SessionEngine, planSchema } from "../src/core/session";
import { AutoDetector, velocityLoss, similarity } from "../src/core/analysis";
import {
  stats,
  overview,
  personalRecords,
  migrateLegacy,
  mergeRecords,
  importCSV,
  exportCSV,
} from "../src/core/history";
import { plates, searchLibrary, safetyResponse } from "../src/core/knowledge";
import { dataSchema } from "../src/core/data";
import { events } from "../electron/sse";
import { coachTurn } from "../src/core/coach";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/upstream-parity.json", import.meta.url),
    "utf8",
  ),
);
const rep = () => ({
  count: 1,
  duration: 3,
  eccentric_s: 2,
  concentric_s: 1,
  min_angle: 80,
  full_depth: true,
  faults: [],
  score: 100,
});
test("empty attempts remain in history without creating personal records", () => {
  const empty = {
    id: "empty",
    exercise: "squat" as const,
    startedAt: "2026-10-22T10:00:00",
    duration: 5,
    reps: [],
    holdSeconds: 0,
    load: 0,
    goal: 12,
  };
  assert.deepEqual(personalRecords([empty]), {});
  const completed = { ...empty, id: "completed", reps: [rep()] };
  const hold = {
    ...empty,
    id: "hold",
    exercise: "plank" as const,
    holdSeconds: 30,
    holdBest: 20,
  };
  const best = personalRecords([empty, completed, hold]);
  assert.equal(best.squat.reps, 1);
  assert.equal(best.plank.hold, 20);
  assert.equal(overview([empty, completed, hold]).sets, 2);
});
for (const c of fixture.detect_cases)
  test("Python auto parity " + c.name, () => {
    const d = new AutoDetector();
    let first: number | null = null,
      value = null;
    for (let i = 0; i < c.frames.length; i++) {
      const r = d.update(c.frames[i], i / c.fps);
      if (r && first === null) {
        first = i;
        value = r;
      }
    }
    assert.equal(value, c.expected.exercise);
    assert.equal(first, c.expected.at_frame);
  });
test("program advances once, rests without extra archive, completes final hold", () => {
  const e = new SessionEngine();
  let t = 100;
  e.now = () => t;
  e.cameraReady = true;
  assert.equal(
    e.dispatch({
      type: "start_program",
      blocks: [
        { exercise: "squat", sets: 2, target: 1, rest: 5, load: 10 },
        { exercise: "plank", sets: 1, target: 2, rest: 5, load: 0 },
      ],
    }).ok,
    true,
  );
  e.acceptRep(rep());
  assert.equal(e.pending.length, 1);
  assert.equal(e.snapshot().status, "resting");
  e.archive();
  assert.equal(e.pending.length, 1);
  t += 5;
  e.tick();
  assert.equal(e.rows.length, 0);
  assert.equal(e.program?.set, 2);
  e.acceptRep(rep());
  assert.equal(e.pending.length, 2);
  t += 5;
  e.tick();
  assert.equal(e.exercise, "plank");
  e.plank.total = 2;
  e.plank.best = 2;
  e.finishSet();
  assert.equal(e.active, false);
  assert.equal(e.pending.length, 3);
  assert.equal(e.pending[2].holdBest, 2);
  assert.equal(e.events.filter((x) => x.type === "finish").length, 1);
});
test("program pause freezes automatic rest; manual change rejected; stop archives once", () => {
  const e = new SessionEngine();
  let t = 10;
  e.now = () => t;
  e.cameraReady = true;
  e.dispatch({
    type: "start_program",
    blocks: [{ exercise: "squat", sets: 2, target: 1, rest: 30, load: 0 }],
  });
  e.acceptRep(rep());
  t += 10;
  e.dispatch({ type: "session", action: "pause" });
  t += 100;
  e.tick();
  assert.equal(e.nextSet, true);
  assert.equal(
    e.dispatch({ type: "set_exercise", exercise: "curl" }).ok,
    false,
  );
  e.dispatch({ type: "session", action: "resume" });
  assert.equal(e.snapshot().remaining, 20);
  e.dispatch({ type: "stop_program" });
  assert.equal(e.pending.length, 1);
  assert.equal(e.active, false);
});
test("zero rest starts next set immediately; invalid plan never changes state", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  assert.equal(e.dispatch({ type: "start_program", blocks: [] }).ok, false);
  assert.equal(
    planSchema.safeParse([
      { exercise: "squat", sets: 1, target: 601, rest: 0, load: 0 },
    ]).success,
    false,
  );
  e.dispatch({
    type: "start_program",
    blocks: [{ exercise: "curl", sets: 2, target: 1, rest: 0, load: 5 }],
  });
  e.acceptRep(rep());
  assert.equal(e.snapshot().status, "training");
  assert.equal(e.rows.length, 0);
  assert.equal(e.pending.length, 1);
});
test("load is captured per rep, volume and Epley are grouped by load", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.load = 60;
  for (let i = 0; i < 5; i++) e.acceptRep(rep());
  e.load = 65;
  for (let i = 0; i < 2; i++) e.acceptRep(rep());
  e.dispatch({ type: "session", action: "end" });
  const s = stats(e.pending[0]);
  assert.equal(s.volume, 430);
  assert.equal(s.e1rm, 70);
  assert.equal(e.pending[0].reps[0].load_kg, 60);
});
test("fatigue and reference shape comparison", () => {
  assert.equal(velocityLoss([100, 100, 100]), 0);
  assert.equal(velocityLoss([100, 100, 100, 50, 50]), 0.5);
  assert.equal(similarity([160, 80, 160], [160, 80, 160]), 100);
  assert.ok(similarity([160, 130, 160], [160, 80, 160])! < 100);
});
test("CSV quoting, pounds, unsupported rows and no invented scores", () => {
  const imported = importCSV(
    'Date,Exercise Name,Reps,Weight (lbs),Notes\n"2026-10-21 10:00","Squat (Barbell)",5,100,"line1\nline2, quoted"\n2026-10-21,Unknown,5,10,no',
  );
  assert.equal(imported.records.length, 1);
  assert.equal(imported.skipped.length, 1);
  assert.ok(Math.abs(stats(imported.records[0]).volume - 226.796185) < 0.00001);
  assert.equal(stats(imported.records[0]).score, null);
  for (const format of ["strong", "hevy"] as const) {
    const round = importCSV(exportCSV(imported.records, format));
    assert.equal(round.records.length, 1);
    assert.equal(round.records[0].reps.length, 5);
  }
});
test("legacy import preserves metrics and deduplicates without personal fixture files", () => {
  const legacy = [
    {
      exercise: "squat",
      started: "2026-10-21T10:00:00Z",
      duration_s: 15,
      reps: [
        {
          eccentric_s: 2,
          concentric_s: 1,
          min_angle: 80,
          score: 90,
          faults: [],
          load_kg: 20,
        },
      ],
      summary: { load_kg: 20 },
    },
  ];
  const { records, skipped } = migrateLegacy(legacy);
  assert.equal(records.length, 1);
  assert.equal(skipped.length, 0);
  assert.equal(records[0].reps[0].score, 90);
  assert.equal(records[0].reps[0].load_kg, 20);
  assert.equal(mergeRecords(records, records).length, 1);
  dataSchema.parse({ settings: { voice: true }, records, version: 2 });
});
test("streak uses local calendar days across month boundaries", () => {
  const base = migrateLegacy([
    {
      started: "2026-09-30 18:00",
      exercise: "plank",
      reps: [],
      duration_s: 10,
      plank: { total_hold_s: 10, best_streak_s: 10 },
    },
  ]).records[0];
  const rs = [
    base,
    { ...base, id: "2", startedAt: "2026-10-01T10:00:00" },
    { ...base, id: "3", startedAt: "2026-10-02T10:00:00" },
  ];
  const s = overview(rs, new Date("2026-10-03T12:00:00"));
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});
test("plate calculator handles impossible target and noncanonical plates", () => {
  assert.deepEqual(plates(60).eachSide, [20]);
  assert.equal(plates(61).actual, 60);
  assert.deepEqual(plates(32, 20, [4, 3]).eachSide, [3, 3]);
  assert.throws(() => plates(10, 20));
});
test("knowledge bilingual search and safety are grounded", () => {
  assert.equal(
    searchLibrary(
      [
        { id: "a", name: "Barbell Squat" },
        { id: "b", name: "Curl" },
      ],
      "深蹲",
    )[0].id,
    "a",
  );
  assert.ok(safetyResponse("我胸痛还想继续练"));
  assert.equal(safetyResponse("没有胸痛"), null);
});
test("SSE parses split UTF8, multiline, completion and truncation", async () => {
  const encoded = new TextEncoder().encode(
    'data: {"type":"delta","text":"你好"}\n\ndata: {"type":"done"}\n\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < encoded.length; i += 3)
        c.enqueue(encoded.slice(i, i + 3));
      c.close();
    },
  });
  const out = [];
  for await (const e of events(stream)) out.push(e);
  assert.equal(out[0].text, "你好");
  assert.equal(out[1].type, "done");
});
test("read-only coach tools answer without fake control receipts", async () => {
  let round = 0,
    queried = false;
  const e = new SessionEngine();
  const result = await coachTurn(
    "最近训练怎么样",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async () => ({
      output:
        round++ === 0
          ? [
              {
                type: "function_call",
                call_id: "h",
                name: "history_query",
                arguments: "{}",
              },
            ]
          : [
              {
                type: "message",
                content: [{ type: "output_text", text: "记录中有三组训练。" }],
              },
            ],
    }),
    [],
    () => false,
    {
      query: async () => {
        queried = true;
        return { sets: 3 };
      },
    },
  );
  assert.equal(queried, true);
  assert.equal(result.receipts.length, 0);
  assert.match(result.text, /三组/);
});
test("risk expression pauses through actual executor before responding", async () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  const result = await coachTurn(
    "我胸痛，还想继续练",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async () => {
      throw Error("model should not be called");
    },
  );
  assert.equal(e.paused, true);
  assert.match(result.text, /训练已暂停/);
});
test("denying one symptom does not hide another risk", () => {
  assert.ok(safetyResponse("没有胸痛，但是呼吸困难"));
});
test("automatic mode cannot discard an active set", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.acceptRep(rep());
  assert.equal(e.dispatch({ type: "auto_detect", enabled: true }).ok, false);
  assert.equal(e.rows.length, 1);
});
test("crash checkpoint restores once and never overwrites archived record", async () => {
  const { recoverCheckpoint } = await import("../src/core/history");
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.acceptRep(rep());
  const checkpoint = e.checkpoint()!;
  assert.equal(checkpoint.interrupted, true);
  const restored = recoverCheckpoint({ records: [], checkpoint });
  assert.equal(restored.records.length, 1);
  assert.equal(restored.checkpoint, null);
  assert.equal(
    recoverCheckpoint({ ...restored, checkpoint }).records.length,
    1,
  );
  e.acceptRep(rep());
  e.dispatch({ type: "session", action: "end" });
  const saved = recoverCheckpoint({ records: e.pending, checkpoint });
  assert.equal(saved.records[0].reps.length, 2);
});
