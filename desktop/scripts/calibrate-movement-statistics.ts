import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  movementProfile,
  motionValue,
  MovementStatistics,
} from "../src/core/movement-statistics";
import type { Movement } from "../src/core/movement-library";
import type { Point } from "../src/core/engine";
import { catalogCameraGuide } from "../src/components/catalog-camera-guides";

const root = resolve(import.meta.dirname, "..");
const input = resolve(
  process.argv[2] ?? "../output/movement-statistics-20261103/poses",
);
const output = resolve(input, "..");
const catalog: Movement[] = JSON.parse(
  readFileSync(resolve(root, "public/movekit-library/catalog.json"), "utf8"),
).movements;
type Extracted = {
  sha256: string;
  aspect: number;
  frames: { t: number; points: number[][] }[];
};
const calibrations: Record<string, unknown> = {};
const rows: Record<string, unknown>[] = [];
const q = (a: number[], n: number) =>
  a.slice().sort((a, b) => a - b)[Math.floor((a.length - 1) * n)];
for (const movement of catalog) {
  const path = resolve(input, movement.slug + ".json");
  if (!existsSync(path))
    throw Error(`Missing extracted video: ${movement.slug}`);
  const data: Extracted = JSON.parse(readFileSync(path, "utf8"));
  const frames = data.frames.map((f) => ({
    t: f.t,
    points: f.points.map(
      (p) =>
        ({
          x: p[0],
          y: p[1],
          z: p[2],
          visibility: p[3],
          world: { x: p[4], y: p[5], z: p[6] },
        }) as Point,
    ),
  }));
  const profile = movementProfile(movement);
  // Prefer bilateral average. For alternating or single-limb movements, use a
  // different bilateral reduction only if the video shows a stronger cycle.
  const choices = (["mean", "min", "max"] as const).map((aggregation) => {
    const measured = frames
      .map((f, i) => ({
        i,
        value: motionValue(f.points, profile.metric, data.aspect, aggregation),
      }))
      .filter((x): x is { i: number; value: number } => x.value !== null);
    const v = measured.map((x) => x.value),
      range = v.length ? q(v, 0.95) - q(v, 0.05) : 0;
    const candidate = new MovementStatistics({
      ...profile,
      aggregation,
      minRange: Math.max(
        profile.minRange * 0.65,
        Math.min(profile.minRange, range * 0.45),
      ),
    });
    for (const f of frames) candidate.frame(f.points, f.t, data.aspect);
    return { aggregation, measured, range, reps: candidate.reps };
  });
  let choice = choices[0];
  if (
    profile.mode === "reps" &&
    (!choice.reps || choice.range < profile.minRange * 1.25)
  )
    choice =
      choices.filter((c) => c.reps > 0).sort((a, b) => b.range - a.range)[0] ??
      choice;
  profile.aggregation = choice.aggregation;
  const measured = choice.measured;
  const values = measured.map((x) => x.value);
  const range = values.length ? q(values, 0.95) - q(values, 0.05) : 0;
  // Keep a meaningful floor: the video must not teach the live counter to count jitter.
  const minRange =
    Math.round(
      Math.max(
        profile.minRange * 0.65,
        Math.min(profile.minRange, range * 0.45),
      ) * 10,
    ) / 10;
  const target = values.length
    ? Math.round(q(values, 0.5) * 10) / 10
    : undefined;
  const candidate = new MovementStatistics({ ...profile, minRange }, target);
  for (const f of frames) candidate.frame(f.points, f.t, data.aspect);
  const fallback =
    profile.mode === "reps" &&
    (values.length < frames.length * 0.35 ||
      range < minRange * 1.25 ||
      candidate.reps === 0);
  calibrations[movement.slug] = {
    target,
    minRange,
    aggregation: profile.aggregation,
    ...(fallback ? { fallback: true } : {}),
  };
  const mode = movement.trainingExercise
    ? movement.trainingExercise === "plank"
      ? "existing-hold"
      : "existing-reps"
    : fallback
      ? "activity"
      : profile.mode;
  rows.push({
    slug: movement.slug,
    name: movement.name,
    mode,
    family: profile.family,
    metric: profile.metric,
    frames: frames.length,
    measuredFrames: values.length,
    range: Math.round(range * 10) / 10,
    videoReps: candidate.reps,
    videoSeconds: Math.round(candidate.seconds * 10) / 10,
    guide: !!movement.trainingExercise || !!catalogCameraGuide(movement.slug),
    reason: fallback
      ? "视频中周期信号不足，降为活动计时"
      : (profile.reason ?? ""),
    sha256: data.sha256,
  });
}
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(root, "src/core/movement-calibration.json"),
  JSON.stringify(calibrations) + "\n",
);
writeFileSync(
  resolve(output, "coverage.json"),
  JSON.stringify(rows, null, 2) + "\n",
);
const labels: Record<string,string> = {"existing-reps":"原有自动计数","existing-hold":"原有姿态计时",reps:"估算计数",hold:"保持计时",activity:"活动计时",timer:"普通计时"};
writeFileSync(
  resolve(output, "动作统计覆盖清单.csv"),
  "\uFEFF" +
    [
      "动作名称,统计方式,动作分组,说明,摄像头摆位引导,动作标识",
      ...rows.map((r) =>
        [r.name,labels[String(r.mode)],r.family,r.reason||"按所选动作规则统计，新增结果为估算",r.guide?"已提供":"仅计时",r.slug].map(v=>JSON.stringify(v)).join(","),
      ),
    ].join("\n"),
);
console.log(
  JSON.stringify(
    {
      movements: rows.length,
      guides: Object.keys(guides).length,
      modes: rows.reduce<Record<string, number>>(
        (a, r) => ((a[String(r.mode)] = (a[String(r.mode)] ?? 0) + 1), a),
        {},
      ),
      missingGuides: rows.filter((r) => !r.guide).map((r) => r.slug),
    },
    null,
    2,
  ),
);
