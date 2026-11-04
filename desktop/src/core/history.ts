import { EXERCISES, type Exercise, type Rep } from "./engine";
import type { RecordRow } from "./session";
import { velocityLoss } from "./analysis";
export const mean = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
export const dayKey = (date: string | Date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function stats(r: RecordRow) {
  const measured = r.reps.filter((x) => x.measured !== false),
    weights = new Map<number, number>(),
    faults: Record<string, number> = {};
  for (const rep of r.reps) {
    const kg = rep.load_kg ?? r.load;
    if (kg > 0) weights.set(kg, (weights.get(kg) ?? 0) + 1);
    for (const f of rep.faults) faults[f] = (faults[f] ?? 0) + 1;
  }
  return {
    reps: r.reps.length,
    score: mean(
      measured
        .filter((x) => !x.assessment?.limited)
        .map((x) => x.score)
        .filter(Number.isFinite),
    ),
    tempo: mean(measured.map((x) => x.eccentric_s).filter(Number.isFinite)),
    concentric: mean(
      measured.map((x) => x.concentric_s).filter(Number.isFinite),
    ),
    similarity: mean(
      measured.map((x) => x.similarity!).filter(Number.isFinite),
    ),
    volume: [...weights].reduce((s, [kg, n]) => s + kg * n, 0),
    e1rm: Math.max(
      0,
      ...[...weights].map(([kg, n]) => kg * (1 + Math.min(n, 30) / 30)),
    ),
    faults,
    fatigue: velocityLoss(
      measured.map((x) => x.velocity!).filter(Number.isFinite),
    ),
  };
}
export function overview(records: RecordRow[], now = new Date()) {
  const meaningful = records.filter((r) => r.reps.length || r.holdSeconds > 0);
  const days = [...new Set(meaningful.map((r) => dayKey(r.startedAt)))].sort();
  let longest = 0,
    run = 0,
    previous = "";
  for (const d of days) {
    const before = new Date(d + "T12:00:00");
    before.setDate(before.getDate() - 1);
    run = dayKey(before) === previous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = d;
  }
  let current = 0,
    cursor = new Date(now);
  if (!days.includes(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.includes(dayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (11 - i) * 7);
    const start = dayKey(end);
    end.setDate(end.getDate() + 7);
    const next = dayKey(end);
    const rs = meaningful.filter(
      (r) => dayKey(r.startedAt) >= start && dayKey(r.startedAt) < next,
    );
    return {
      start,
      sets: rs.length,
      reps: rs.reduce((n, r) => n + r.reps.length, 0),
      volume: rs.reduce((n, r) => n + stats(r).volume, 0),
      seconds: rs.reduce((n, r) => n + r.holdSeconds, 0),
    };
  });
  const faults: Record<string, number> = {};
  for (const r of meaningful)
    for (const [k, v] of Object.entries(stats(r).faults))
      faults[k] = (faults[k] ?? 0) + v;
  return {
    sets: meaningful.length,
    days: days.length,
    current,
    longest,
    weeks,
    faults,
    volume: meaningful.reduce((n, r) => n + stats(r).volume, 0),
    reps: meaningful.reduce((n, r) => n + r.reps.length, 0),
  };
}
export function personalRecords(records: RecordRow[]) {
  const out: Record<
    string,
    { reps: number; hold: number; e1rm: number; volume: number }
  > = {};
  for (const r of records) {
    if (!r.reps.length && r.holdSeconds <= 0) continue;
    const s = stats(r),
      v = out[r.exercise] ?? { reps: 0, hold: 0, e1rm: 0, volume: 0 };
    out[r.exercise] = {
      reps: Math.max(v.reps, s.reps),
      hold: Math.max(v.hold, r.holdBest ?? r.holdSeconds),
      e1rm: Math.max(v.e1rm, s.e1rm),
      volume: Math.max(v.volume, s.volume),
    };
  }
  return out;
}
export function stableId(value: unknown) {
  let h = 2166136261;
  for (const c of JSON.stringify(value))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
export function mergeRecords(existing: RecordRow[], incoming: RecordRow[]) {
  const ids = new Set(existing.map((r) => r.id));
  return [
    ...existing,
    ...incoming.filter((r) => {
      if (ids.has(r.id)) return false;
      ids.add(r.id);
      return true;
    }),
  ].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export function migrateLegacy(input: unknown) {
  if (!Array.isArray(input)) throw Error("旧记录应为 JSON 数组");
  const records: RecordRow[] = [],
    skipped: string[] = [];
  input.forEach((s, i) => {
    if (
      !s ||
      !(s.exercise in EXERCISES) ||
      !Array.isArray(s.reps) ||
      !Number.isFinite(Date.parse(s.started))
    ) {
      skipped.push(`第${i + 1}项格式无效`);
      return;
    }
    const reps: Rep[] = s.reps.map((r: any, n: number) => ({
      count: n + 1,
      duration: (r.eccentric_s ?? 0) + (r.concentric_s ?? 0),
      eccentric_s: r.eccentric_s ?? 0,
      concentric_s: r.concentric_s ?? 0,
      min_angle: r.min_angle ?? 0,
      full_depth: !r.faults?.includes("shallow"),
      faults: Array.isArray(r.faults) ? r.faults : [],
      score: r.score ?? 0,
      measured: typeof r.score === "number",
      load_kg: typeof r.load_kg === "number" ? r.load_kg : undefined,
      velocity: r.velocity ?? undefined,
      similarity: r.similarity ?? undefined,
    }));
    records.push({
      id: "python-" + stableId([s, i]),
      sessionId: "python-" + stableId([s.started, i]),
      source: "Python",
      exercise: s.exercise,
      startedAt: new Date(s.started).toISOString(),
      duration: Math.max(0, s.duration_s ?? 0),
      reps,
      holdSeconds: s.plank?.total_hold_s ?? 0,
      holdBest: s.plank?.best_streak_s ?? 0,
      load: s.summary?.load_kg ?? 0,
      goal: reps.length || s.plank?.total_hold_s || 0,
    });
  });
  return { records, skipped };
}
const aliases: Record<string, Exercise> = {
  "barbell squat": "squat",
  "squat (barbell)": "squat",
  "bench press": "bench",
  "bench press (barbell)": "bench",
  "barbell bench press": "bench",
  "push up": "pushup",
  "push-up": "pushup",
  "push ups": "pushup",
  "deadlift (barbell)": "deadlift",
  "overhead press": "shoulder_press",
  "shoulder press": "shoulder_press",
  "overhead press (barbell)": "shoulder_press",
  "dumbbell curl": "curl",
  "bicep curl (dumbbell)": "curl",
  "bicep curl": "curl",
  "pull up": "pullup",
  "pull-up": "pullup",
  lunges: "lunge",
};
export function mapExercise(name: string): Exercise | null {
  return (
    (Object.keys(EXERCISES).find(
      (k) =>
        k === name.toLowerCase() || EXERCISES[k as Exercise].label === name,
    ) as Exercise) ||
    aliases[name.toLowerCase()] ||
    null
  );
}
export function parseCSV(text: string) {
  const delimiter =
    text.split("\n")[0].split(";").length >
    text.split("\n")[0].split(",").length
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n")) {
      row.push(cell.replace(/\r$/, ""));
      cell = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw Error("CSV 引号未闭合");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
export function importCSV(text: string) {
  const [head, ...rows] = parseCSV(text);
  if (!head) throw Error("CSV 为空");
  const records: RecordRow[] = [],
    skipped: string[] = [];
  rows.forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return;
    const r = Object.fromEntries(
      head.map((h, j) => [h.trim().toLowerCase(), cells[j]?.trim() ?? ""]),
    );
    const get = (...keys: string[]) =>
      keys.map((k) => r[k]).find(Boolean) ?? "";
    const name = get("exercise name", "exercise_title", "exercise"),
      exercise = mapExercise(name),
      date = get("date", "start_time", "workout date"),
      reps = Number(get("reps") || 0),
      kg =
        Number(get("weight", "weight_kg", "weight (kg)") || 0) ||
        Number(get("weight_lbs", "weight (lbs)") || 0) * 0.45359237,
      hold = Number(get("seconds", "duration_seconds") || 0);
    if (
      !exercise ||
      !Number.isFinite(Date.parse(date)) ||
      ![reps, kg, hold].every(Number.isFinite) ||
      reps < 0 ||
      reps > 1000 ||
      !Number.isInteger(reps) ||
      kg < 0 ||
      kg > 500 ||
      hold < 0 ||
      hold > 86400
    ) {
      skipped.push(`第${i + 2}行：${name || "未知动作"} / 数据无效或尚不支持`);
      return;
    }
    records.push({
      id: "csv-" + stableId([r, i]),
      sessionId: "csv-" + stableId([date, get("workout name", "title")]),
      exercise,
      startedAt: new Date(date).toISOString(),
      duration: hold,
      holdSeconds: hold,
      load: kg,
      goal: reps || hold,
      source: "CSV",
      reps: Array.from({ length: reps }, (_, n) => ({
        count: n + 1,
        duration: 0,
        eccentric_s: 0,
        concentric_s: 0,
        min_angle: 0,
        full_depth: false,
        faults: [],
        score: 0,
        measured: false,
        load_kg: kg,
      })),
    });
  });
  return { records, skipped };
}
export function exportCSV(
  records: RecordRow[],
  format: "strong" | "hevy" = "strong",
) {
  const rows: unknown[][] = [
    format === "strong"
      ? [
          "Date",
          "Workout Name",
          "Exercise Name",
          "Set Order",
          "Weight",
          "Reps",
          "Distance",
          "Seconds",
          "Notes",
        ]
      : [
          "title",
          "start_time",
          "end_time",
          "exercise_title",
          "set_index",
          "set_type",
          "weight_kg",
          "reps",
          "duration_seconds",
          "exercise_notes",
        ],
  ];
  for (const r of records) {
    const groups = new Map<number, number>();
    for (const rep of r.reps) {
      const kg = rep.load_kg ?? r.load;
      groups.set(kg, (groups.get(kg) ?? 0) + 1);
    }
    if (!groups.size) groups.set(r.load, 0);
    let n = 0;
    for (const [kg, count] of groups) {
      n++;
      const note = `source=${r.source ?? "open-fitness"}; original_set=${r.id}${groups.size > 1 ? "; mixed-load segment" : ""}`;
      rows.push(
        format === "strong"
          ? [
              r.startedAt,
              "open-fitness",
              r.exercise,
              (r.setIndex ?? 1) + n - 1,
              kg,
              count,
              "",
              r.holdSeconds,
              note,
            ]
          : [
              "open-fitness",
              r.startedAt,
              new Date(
                Date.parse(r.startedAt) + r.duration * 1000,
              ).toISOString(),
              r.exercise,
              (r.setIndex ?? 1) + n - 1,
              "normal",
              kg,
              count,
              r.holdSeconds,
              note,
            ],
      );
    }
  }
  return (
    "\uFEFF" +
    rows
      .map((r) =>
        r.map((c) => '"' + String(c).replaceAll('"', '""') + '"').join(","),
      )
      .join("\r\n")
  );
}
export function setSummary(r: RecordRow) {
  const s = stats(r);
  return `${EXERCISES[r.exercise].label}完成${r.exercise === "plank" ? `${r.holdSeconds.toFixed(0)}秒，有效连续最长${(r.holdBest ?? 0).toFixed(0)}秒` : `${s.reps}次${s.score === null ? "" : `，平均动作分${s.score.toFixed(0)}`}${s.volume ? `，负重训练量${s.volume.toFixed(1)}公斤·次` : ""}`}。`;
}

export function recoverCheckpoint<
  T extends { records: RecordRow[]; checkpoint?: RecordRow | null },
>(data: T): T {
  return data.checkpoint
    ? {
        ...data,
        records: mergeRecords(data.records, [
          { ...data.checkpoint, interrupted: true },
        ]),
        checkpoint: null,
      }
    : data;
}
