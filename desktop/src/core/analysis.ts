import { type Exercise, type Angles, type Point } from "./engine";
export type Features = Record<string, number | boolean>;
export function frameFeatures(a: Angles, p: Point[]): Features {
  const shoulder = (p[11].y + p[12].y) / 2,
    wrist = (p[15].y + p[16].y) / 2;
  const torso = Math.max(Math.abs((p[23].y + p[24].y) / 2 - shoulder), 0.001);
  return {
    trunk: a.trunk_lean,
    knee: a.knee,
    elbow: a.elbow,
    hip: a.hip,
    sho_y: shoulder,
    wri_y: wrist,
    torso,
    overhead: wrist < shoulder - 0.03,
    knee_split: Math.abs(p[25].y - p[26].y) / torso,
  };
}
export function classify(f: Features[]): Exercise | null {
  if (!f.length) return null;
  const values = (k: string) => f.map((x) => Number(x[k]));
  const avg = (k: string) => values(k).reduce((a, b) => a + b, 0) / f.length;
  const max = (k: string) => Math.max(...values(k));
  const rom = (k: string) => max(k) - Math.min(...values(k));
  if (avg("trunk") > 55) return rom("elbow") > 25 ? "pushup" : "plank";
  if (avg("overhead") > 0.7 && rom("elbow") > 30)
    return rom("sho_y") > 1.3 * rom("wri_y") ? "pullup" : "shoulder_press";
  if (rom("knee") > 35)
    return max("trunk") > 55
      ? "deadlift"
      : max("knee_split") > 0.35
        ? "lunge"
        : "squat";
  if (max("trunk") > 55 && rom("hip") > 30) return "deadlift";
  if (rom("elbow") > 40 && avg("overhead") < 0.3) return "curl";
  return null;
}
export class AutoDetector {
  frames: { t: number; f: Features }[] = [];
  votes: (Exercise | null)[] = [];
  next = Number.NaN;
  update(f: Features, t: number) {
    if (Number.isNaN(this.next)) this.next = t + 2;
    this.frames.push({ t, f });
    this.frames = this.frames.filter((x) => t - x.t <= 2);
    if (t < this.next || this.frames.length < 20) return null;
    this.next = t + 0.5;
    const vote = classify(this.frames.map((x) => x.f));
    this.votes.push(vote);
    this.votes = this.votes.slice(-3);
    return vote &&
      this.votes.length === 3 &&
      this.votes.every((v) => v === vote)
      ? vote
      : null;
  }
}
export function velocityLoss(values: number[]) {
  if (values.length < 4) return 0;
  const base = Math.max(...values.slice(0, 3));
  return base > 0
    ? Math.max(0, 1 - (values.at(-1)! + values.at(-2)!) / 2 / base)
    : 0;
}
export function resample(v: number[], n = 50) {
  if (!v.length) return [];
  return Array.from({ length: n }, (_, i) => {
    const p = (i * (v.length - 1)) / (n - 1),
      k = Math.floor(p);
    return v[k] + (v[Math.min(k + 1, v.length - 1)] - v[k]) * (p - k);
  });
}
export function similarity(a: number[], b: number[]) {
  const x = resample(a),
    y = resample(b);
  if (!x.length || !y.length) return undefined;
  let previous = Array(y.length + 1).fill(Infinity);
  previous[0] = 0;
  for (const v of x) {
    const row = Array(y.length + 1).fill(Infinity);
    for (let j = 1; j <= y.length; j++)
      row[j] =
        Math.abs(v - y[j - 1]) +
        Math.min(previous[j], row[j - 1], previous[j - 1]);
    previous = row;
  }
  return Math.round(
    100 * Math.max(0, 1 - previous[y.length] / (x.length + y.length) / 25),
  );
}
export type Reference = {
  trajectory: number[];
  score: number;
  recorded: string;
  recordId?: string;
  repIndex?: number;
  startedAt?: string;
};
