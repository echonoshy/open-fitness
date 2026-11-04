import test from "node:test";
import assert from "node:assert/strict";
import { cleanTranscript } from "../src/core/listening";
import { cameraEnvironment, countingHints } from "../src/core/environment";
import {
  filterHistory,
  progressByExercise,
  achievements,
  muscleCoverage,
} from "../src/core/progress";
import { findExercises } from "../src/core/knowledge";
import { queryData } from "../src/core/coach-data";
import {
  metricSummary,
  replyChecks,
  takeSentences,
} from "../src/core/diagnostics";
import { SessionEngine, type RecordRow } from "../src/core/session";
import { coachTurn } from "../src/core/coach";
const rep = (score = 90) => ({
  count: 1,
  duration: 3,
  eccentric_s: 2,
  concentric_s: 1,
  min_angle: 70,
  full_depth: true,
  faults: [],
  score,
});
const record = (id: string, date: string, score = 90): RecordRow => ({
  id,
  exercise: "squat",
  startedAt: date,
  duration: 10,
  reps: [rep(score)],
  holdSeconds: 0,
  load: 10,
  goal: 1,
});
const call = (name: string, args = {}) => ({
  type: "function_call",
  name,
  call_id: name,
  arguments: JSON.stringify(args),
});
const response = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});
test("noise transcript filters preserve Chinese short commands and valid thanks", () => {
  for (const t of ["停", "不", "好", "谢谢", "设置十次", "开始休息"])
    assert.equal(cleanTranscript(t), t);
  for (const t of [
    "（音乐）",
    "感谢观看！",
    "字幕由某某提供",
    "Music Music Music Music Music Music",
    "测试测试测试测试",
  ])
    assert.equal(cleanTranscript(t), "");
});
test("free-training goal fires once without archiving or stopping further reps", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "set_rep_goal", reps: 2 });
  e.dispatch({ type: "session", action: "start" });
  e.acceptRep(rep());
  e.acceptRep(rep());
  e.acceptRep(rep());
  assert.equal(e.events.filter((x) => x.type === "goal").length, 1);
  assert.equal(e.pending.length, 0);
  assert.equal(e.active, true);
  assert.equal(e.rows.length, 3);
  e.dispatch({ type: "session", action: "end" });
  assert.equal(e.pending[0].reps.length, 3);
  e.dispatch({ type: "session", action: "start" });
  e.acceptRep(rep());
  e.acceptRep(rep());
  assert.equal(e.events.filter((x) => x.type === "goal").length, 2);
});
test("free plank goal summary is deduplicated", () => {
  const e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "set_exercise", exercise: "plank" });
  e.dispatch({ type: "session", action: "start" });
  e.plank.total = 30;
  e.announceGoal();
  e.announceGoal();
  assert.equal(e.events.filter((x) => x.type === "goal").length, 1);
  assert.equal(e.pending.length, 0);
});
test("environment catches dark, cropped limbs and low FPS using consistent units", () => {
  const points = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  points[27].y = 1.1;
  points[28].visibility = 0.1;
  const env = cameraEnvironment(points, "squat", 0.1, 10);
  assert.deepEqual(env.missing, ["脚踝"]);
  const hints = countingHints({
    environment: env,
    tracking: false,
    status: "training",
    exercise: "squat",
    phase: "IDLE",
  }).join(" ");
  assert.match(hints, /偏暗/);
  assert.match(hints, /脚踝/);
  assert.match(hints, /帧率/);
});
test("calendar ranges respect local weeks and exclude future records", () => {
  const now = new Date("2026-10-21T12:00:00");
  const rows = [
    record("a", "2026-10-18T23:59:00"),
    record("b", "2026-10-19T00:00:00"),
    record("c", "2026-10-22T00:00:00"),
  ];
  assert.deepEqual(
    filterHistory(rows, { period: "last_week" }, now).map((r) => r.id),
    ["a"],
  );
  assert.deepEqual(
    filterHistory(rows, { period: "this_week" }, now).map((r) => r.id),
    ["b"],
  );
  assert.deepEqual(
    filterHistory(rows, { from: "2026-10-18", to: "2026-10-18" }, now).map(
      (r) => r.id,
    ),
    ["a"],
  );
});
test("query rejects ambiguous or invalid date ranges", async () => {
  await assert.rejects(
    queryData({ type: "history_query", days: 7, period: "last_week" }, [], []),
    /只能选一种/,
  );
  await assert.rejects(
    queryData({ type: "history_query", from: "2026-02-30" }, [], []),
  );
  await assert.rejects(
    queryData(
      { type: "history_query", from: "2026-10-22", to: "2026-10-21" },
      [],
      [],
    ),
    /晚于/,
  );
});
test("trend needs six measured sets and imported unscored rows do not depress average", () => {
  const rows = Array.from({ length: 6 }, (_, i) =>
    record(String(i), `2026-10-${10 + i}T12:00:00`, i < 3 ? 70 : 90),
  );
  assert.equal(progressByExercise(rows)[0].scoreDelta, 20);
  assert.equal(progressByExercise(rows.slice(1))[0].scoreDelta, null);
  const imported = record("csv", "2026-10-16T12:00:00", 0);
  imported.reps[0].measured = false;
  assert.equal(progressByExercise([...rows, imported])[0].scoreDelta, 20);
});
test("PR compares prior sets, skips first record and includes muscle coverage", () => {
  const a = record("a", "2026-10-20T12:00:00"),
    b = record("b", "2026-10-21T12:00:00");
  b.reps.push(rep());
  assert.deepEqual(achievements(a, []), []);
  assert.match(achievements(b, [a, b])[0], /新纪录/);
  assert.equal(
    muscleCoverage([a, b], new Date("2026-10-21T18:00:00"))[0].sets,
    2,
  );
});
test("catalog filters combine muscle, equipment, level and secondary muscles", () => {
  const rows = [
    {
      id: "1",
      name: "Dumbbell row",
      equipment: "dumbbell",
      primaryMuscles: ["middle back"],
      secondaryMuscles: ["biceps"],
      instructions: ["row"],
      level: "beginner",
    },
    {
      id: "2",
      name: "Barbell row",
      equipment: "barbell",
      primaryMuscles: ["middle back"],
      instructions: ["row"],
      level: "expert",
    },
  ];
  assert.deepEqual(
    findExercises(rows, "", {
      equipment: "哑铃",
      muscle: "背部",
      level: "beginner",
    }).map((r) => r.id),
    ["1"],
  );
  assert.equal(findExercises(rows, "", { muscle: "肱二头肌" }).length, 1);
  assert.equal(findExercises(rows, "", { equipment: "machine" }).length, 0);
});
test("reply diagnostics reject unsupported historical numbers and leaked protocol", () => {
  assert.ok(
    replyChecks("上次平均评分99分。", "score:80").includes(
      "ungrounded_numbers",
    ),
  );
  assert.deepEqual(replyChecks("建议先休息60秒。", ""), []);
  assert.ok(
    replyChecks("已切换到深蹲。", "").includes("unconfirmed_execution"),
  );
  assert.ok(replyChecks("<tool_call>", "").includes("protocol_leak"));
  assert.deepEqual(takeSentences("负重2.5公斤。保持呼吸！下一句"), {
    sentences: ["负重2.5公斤。", "保持呼吸！"],
    rest: "下一句",
  });
});
test("read-only answer emits checked sentences before model completes with tools disabled", async () => {
  const e = new SessionEngine();
  let n = 0,
    completed = false;
  const sentences: string[] = [];
  const result = await coachTurn(
    "如何呼吸",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async (payload: any, onText) => {
      n++;
      assert.equal(payload.tool_choice, "none");
      assert.deepEqual(payload.tools, []);
      onText?.("保持自然呼吸。");
      assert.equal(sentences.length, 1);
      assert.equal(completed, false);
      onText?.("不要憋气。");
      completed = true;
      return response("保持自然呼吸。不要憋气。");
    },
    [],
    () => false,
    { onSentence: (s) => sentences.push(s) },
  );
  assert.equal(result.text, sentences.join(""));
  assert.equal(n, 1, "general advice should need only one model request");
});
test("false execution in streamed read-only answer is never spoken", async () => {
  const e = new SessionEngine();
  let n = 0;
  const spoken: string[] = [];
  const r = await coachTurn(
    "解释深蹲",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async (_p, onText) => {
      if (n++ === 0) return { output: [call("no_action")] };
      onText?.("已切换到深蹲。");
      return response("已切换到深蹲。");
    },
    [],
    () => false,
    { onSentence: (s) => spoken.push(s) },
  );
  assert.doesNotMatch(spoken.join(""), /已切换/);
  assert.match(r.text, /没有执行任何操作/);
});
test("query does not prematurely suppress remaining compound control", async () => {
  const e = new SessionEngine();
  let n = 0;
  const r = await coachTurn(
    "查历史再设十次",
    e.snapshot(),
    async (raw) => e.dispatch(raw),
    async () => ({
      output:
        n++ === 0
          ? [call("history_query")]
          : n === 2
            ? [call("set_rep_goal", { reps: 10 })]
            : response("好了").output,
    }),
    [],
    () => false,
    { query: async () => ({ sets: 1 }) },
  );
  assert.equal(e.goal, 10);
  assert.equal(r.receipts.length, 1);
});
test("cancelled sentence stream cannot emit later audio or execute anything", async () => {
  const e = new SessionEngine();
  let n = 0,
    cancelled = false;
  const spoken: string[] = [];
  await assert.rejects(
    coachTurn(
      "解释",
      e.snapshot(),
      async (raw) => e.dispatch(raw),
      async (_p, onText) => {
        if (n++ === 0) return { output: [call("no_action")] };
        onText?.("第一句。");
        cancelled = true;
        onText?.("第二句。");
        return response("第一句。第二句。");
      },
      [],
      () => cancelled,
      { onSentence: (s) => spoken.push(s) },
    ),
    /已取消/,
  );
  assert.deepEqual(spoken, ["第一句。"]);
});
test("service summaries separate cancelled/errors from success percentiles", () => {
  const result = metricSummary([
    { kind: "llm", ms: 100, firstMs: 20, outcome: "ok" },
    { kind: "llm", ms: 300, firstMs: 40, outcome: "ok" },
    { kind: "llm", ms: 9000, outcome: "cancelled" },
    { kind: "llm", ms: 2000, outcome: "error" },
  ])[1];
  assert.equal(result.totalP95Ms, 300);
  assert.equal(result.cancelled, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.firstP50Ms, 20);
});
test("Chinese body-part aliases prioritize primary target muscles", () => {
  const rows = [
    {
      id: "squat",
      name: "Dumbbell squat",
      equipment: "dumbbell",
      primaryMuscles: ["quadriceps"],
      secondaryMuscles: ["lower back"],
      instructions: ["squat"],
    },
    {
      id: "row",
      name: "Dumbbell row",
      equipment: "dumbbell",
      primaryMuscles: ["middle back"],
      instructions: ["row"],
    },
  ];
  assert.equal(
    findExercises(rows, "", { muscle: "背", equipment: "哑铃" }, 1)[0].id,
    "row",
  );
  assert.equal(findExercises(rows, "", { muscle: "腿" }, 1)[0].id, "squat");
});
test("grounding recognizes ISO dates rendered as Chinese dates", () => {
  assert.deepEqual(
    replyChecks("上周10月1日至7日无记录。", "range:2026-10-01,2026-10-07"),
    [],
  );
});
test("specific history scope survives omitted model parameter without guessing multi-exercise queries", async () => {
  const { scopedHistoryQuery } = await import("../src/core/coach-data");
  assert.equal(
    scopedHistoryQuery({ type: "history_query" }, "查询10月的深蹲记录")
      .exercise,
    "squat",
  );
  assert.equal(
    scopedHistoryQuery({ type: "history_query" }, "深蹲和硬拉记录").exercise,
    undefined,
  );
  assert.equal(
    scopedHistoryQuery({ type: "history_query" }, "深蹲以外的所有记录")
      .exercise,
    undefined,
  );
});
