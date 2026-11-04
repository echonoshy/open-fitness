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
