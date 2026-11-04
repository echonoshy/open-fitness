import { dayKey, stats, personalRecords } from "./history";
import { EXERCISES, FAULTS, type Exercise } from "./engine";
import type { RecordRow } from "./session";
export interface HistoryFilter {
  exercise?: string;
  days?: number;
  from?: string;
  to?: string;
  period?: "this_week" | "last_week" | "this_month" | "last_month";
}
export function historyRange(filter: HistoryFilter = {}, now = new Date()) {
  let from = filter.from ?? "",
    to = filter.to ?? dayKey(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (filter.days) {
    start.setDate(start.getDate() - filter.days + 1);
    from = dayKey(start);
  }
  if (filter.period) {
    if (filter.period.includes("week")) {
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      if (filter.period === "last_week") {
        const end = new Date(start);
        end.setDate(end.getDate() - 1);
        to = dayKey(end);
        start.setDate(start.getDate() - 7);
      }
    } else {
      start.setDate(1);
      if (filter.period === "last_month") {
        const end = new Date(start);
        end.setDate(0);
        to = dayKey(end);
        start.setMonth(start.getMonth() - 1);
      }
    }
    from = dayKey(start);
  }
  return { from, to };
}
export function filterHistory<T extends { exercise: string; startedAt: string }>(
  records: T[],
  filter: HistoryFilter = {},
  now = new Date(),
) {
  const { from, to } = historyRange(filter, now);
  return records
    .filter(
      (r) =>
        Number.isFinite(Date.parse(r.startedAt)) &&
        (!filter.exercise || r.exercise === filter.exercise) &&
        dayKey(r.startedAt) >= from &&
        dayKey(r.startedAt) <= to,
    )
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
export function progressByExercise(records: RecordRow[]) {
  return Object.entries(EXERCISES).flatMap(([exercise, spec]) => {
    const rows = records
      .filter(
        (r) => r.exercise === exercise && (r.reps.length || r.holdSeconds),
      )
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    if (!rows.length) return [];
    const scored = rows.map(stats).filter((s) => s.score !== null);
    const recent = scored.slice(-3),
      prior = scored.slice(-6, -3);
    const average = (xs: typeof scored, key: "score" | "tempo") => {
      const values = xs
        .map((s) => s[key])
        .filter((v): v is number => v !== null);
      return values.length
        ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
            10
        : null;
    };
    const faults: Record<string, number> = {};
    for (const r of rows.slice(-3))
      for (const [f, n] of Object.entries(stats(r).faults))
        faults[f] = (faults[f] ?? 0) + n;
    const currentScore = average(recent, "score"),
      previousScore = average(prior, "score");
    return [
      {
        exercise,
        name: spec.label,
        sets: rows.length,
        reps: rows.reduce((n, r) => n + r.reps.length, 0),
        last: rows.at(-1)!.startedAt,
        recentScore: currentScore,
        previousScore,
        scoreDelta:
          recent.length === 3 && prior.length === 3
            ? Math.round((currentScore! - previousScore!) * 10) / 10
            : null,
        recentTempo: average(recent, "tempo"),
        previousTempo: average(prior, "tempo"),
        comparison: "最近3组有评分记录与此前3组对比；不足6组不判断趋势",
        topFaults: Object.entries(faults)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([key, count]) => ({
            key,
            count,
            text: FAULTS[key]?.text ?? key,
          })),
      },
    ];
  });
}
export const exerciseMuscles: Record<Exercise, string[]> = {
  squat: ["股四头肌", "臀部"],
  lunge: ["股四头肌", "臀部"],
  deadlift: ["臀部", "腿后侧", "背部"],
  pushup: ["胸部", "肱三头肌"],
  bench: ["胸部", "肱三头肌"],
  shoulder_press: ["肩部", "肱三头肌"],
  curl: ["肱二头肌"],
  pullup: ["背部", "肱二头肌"],
  plank: ["核心"],
};
export function muscleCoverage(records: RecordRow[], now = new Date()) {
  return coverageByMuscle(records
    .filter((r) => r.reps.length || r.holdSeconds)
    .map((r) => ({ startedAt: r.startedAt, muscles: exerciseMuscles[r.exercise] })), now);
}

export function coverageByMuscle(
  records: { startedAt: string; muscles: string[] }[],
  now = new Date(),
) {
  const { from } = historyRange({ days: 7 }, now);
  const groups = new Map<
    string,
    { muscle: string; sets: number; last: string }
  >();
  for (const r of records)
    if (Date.parse(r.startedAt) <= now.getTime())
      for (const muscle of r.muscles) {
        const g = groups.get(muscle) ?? { muscle, sets: 0, last: "" };
        if (dayKey(r.startedAt) >= from) g.sets++;
        if (r.startedAt > g.last) g.last = r.startedAt;
        groups.set(muscle, g);
      }
  return [...groups.values()].sort((a, b) => b.sets - a.sets);
}
export function achievements(row: RecordRow, previous: RecordRow[]) {
  const before = previous.filter(
    (r) =>
      r.id !== row.id &&
      r.exercise === row.exercise &&
      Date.parse(r.startedAt) <= Date.parse(row.startedAt) &&
      (r.reps.length || r.holdSeconds),
  );
  if (!before.length) return [];
  const best = personalRecords(before)[row.exercise],
    s = stats(row),
    out: string[] = [];
  if (s.reps > best.reps)
    out.push(`单组次数新纪录：${s.reps}次，之前${best.reps}次`);
  const hold = row.holdBest ?? row.holdSeconds;
  if (hold > best.hold && best.hold > 0)
    out.push(
      `连续支撑新纪录：${Math.round(hold)}秒，之前${Math.round(best.hold)}秒`,
    );
  if (s.volume > best.volume && best.volume > 0)
    out.push(`单组负重训练量新纪录：${s.volume.toFixed(1)}公斤·次`);
  if (s.e1rm > best.e1rm && best.e1rm > 0)
    out.push(`估算最大力量新高：${s.e1rm.toFixed(1)}公斤（估算值）`);
  return out;
}
