import { EXERCISES, type Exercise } from "./engine";
import { stats } from "./history";
import {
  movementMuscles,
  primaryMovementSlugs,
  type Movement,
} from "./movement-library";
import { exerciseMuscles } from "./progress";
import type { RecordRow } from "./session";
import type { TimedRecord } from "./timed-training";

interface Performance {
  label: string;
  value: number;
  unit: string;
}

export interface HistorySet {
  exercise: string;
  name: string;
  startedAt: string;
  seconds: number;
  reps: number;
  volume: number;
  muscles: string[];
  performances: Performance[];
  record: RecordRow | TimedRecord;
}

export function historySets(
  measured: RecordRow[],
  timed: TimedRecord[],
  catalog: Movement[],
): HistorySet[] {
  const movements = new Map(catalog.map((m) => [m.slug, m]));
  const musclesBySlug = new Map(
    catalog.map((m) => [
      m.slug,
      [...new Set(m.primaryMuscles.map((key) => movementMuscles[key] ?? key))],
    ]),
  );
  const rows: HistorySet[] = [];
  for (const r of measured) {
    const exercise = primaryMovementSlugs[r.exercise];
    const s = stats(r);
    const performances: Performance[] = [];
    if (s.reps)
      performances.push({ label: "单组次数", value: s.reps, unit: "次" });
    if (r.exercise === "plank" && r.holdSeconds)
      performances.push({
        label: "连续支撑",
        value: r.holdBest ?? r.holdSeconds,
        unit: "秒",
      });
    if (!performances.length && r.duration > 0)
      performances.push({ label: "本组时长", value: r.duration, unit: "秒" });
    if (s.volume)
      performances.push({
        label: "单组训练量",
        value: s.volume,
        unit: "kg·次",
      });
    if (s.e1rm)
      performances.push({ label: "估算 1RM", value: s.e1rm, unit: "kg" });
    rows.push({
      exercise,
      name: movements.get(exercise)?.name ?? EXERCISES[r.exercise].label,
      startedAt: r.startedAt,
      seconds: r.duration,
      reps: s.reps,
      volume: s.volume,
      muscles: musclesBySlug.get(exercise) ?? exerciseMuscles[r.exercise],
      performances,
      record: r,
    });
  }
  for (const r of timed) {
    const movement = movements.get(r.movementSlug);
    const camera = r.statistics;
    const count =
      r.manualReps ?? (camera?.mode === "reps" ? camera.reps : undefined);
    const volume = (count ?? 0) * r.load;
    const performances: Performance[] = [];
    if (count !== undefined) {
      const source = r.manualReps === undefined ? "估算" : "手填";
      performances.push({ label: source + "次数", value: count, unit: "次" });
      if (volume)
        performances.push({
          label: source + "训练量",
          value: volume,
          unit: "kg·次",
        });
    }
    if (camera?.mode === "hold" || camera?.mode === "activity") {
      performances.push({
        label: camera.mode === "hold" ? "估算保持时间" : "估算活动时间",
        value: camera.seconds,
        unit: "秒",
      });
    } else if (camera?.mode !== "reps") {
      performances.push({ label: "本组时长", value: r.duration, unit: "秒" });
    }
    rows.push({
      exercise: r.movementSlug,
      name: movement?.name ?? r.movementName,
      startedAt: r.startedAt,
      seconds: r.duration,
      reps: count ?? 0,
      volume,
      muscles: musclesBySlug.get(r.movementSlug) ?? [],
      performances,
      record: r,
    });
  }
  return rows;
}

/** The history filter supplies sets oldest first. Keep that order within a workout. */
export function groupWorkouts(rows: HistorySet[]) {
  const groups = new Map<string, HistorySet[]>();
  for (const row of rows) {
    const r = row.record;
    const key = r.sessionId ? `session:${r.sessionId}`
      : `set:${"exercise" in r ? "pose" : "catalog"}:${r.id}`;
    const sets = groups.get(key);
    if (sets) sets.push(row);
    else groups.set(key, [row]);
  }
  return [...groups].sort(([, a], [, b]) =>
    Date.parse(b[b.length - 1].startedAt) - Date.parse(a[a.length - 1].startedAt));
}

export function historyChoices(catalog: Movement[], rows: HistorySet[]) {
  const names = new Map(catalog.map((m) => [m.slug, m.name]));
  for (const [id, slug] of Object.entries(primaryMovementSlugs)) {
    if (!names.has(slug)) names.set(slug, EXERCISES[id as Exercise].label);
  }
  for (const row of rows)
    if (!names.has(row.exercise)) names.set(row.exercise, row.name);
  const recorded = new Set(rows.map((r) => r.exercise));
  const choices = [...names];
  return {
    recorded: choices.filter(([slug]) => recorded.has(slug)),
    remaining: choices.filter(([slug]) => !recorded.has(slug)),
  };
}

// Rows arrive in chronological order from filterHistory. Compare like measurements
// within each movement, keeping manual corrections separate from camera estimates.
export function movementResults(rows: HistorySet[]) {
  type Series = { label: string; unit: string; best: number; recent: number[] };
  const groups = new Map<
    string,
    { name: string; sets: number; series: Map<string, Series> }
  >();
  for (const row of rows) {
    const group = groups.get(row.exercise) ?? {
      name: row.name,
      sets: 0,
      series: new Map<string, Series>(),
    };
    group.sets++;
    for (const p of row.performances) {
      const series = group.series.get(p.label) ?? {
        label: p.label,
        unit: p.unit,
        best: 0,
        recent: [],
      };
      series.best = Math.max(series.best, p.value);
      series.recent = [...series.recent.slice(-2), p.value];
      group.series.set(p.label, series);
    }
    groups.set(row.exercise, group);
  }
  return [...groups].map(([slug, group]) => ({
    slug,
    name: group.name,
    sets: group.sets,
    series: [...group.series.values()],
  }));
}
