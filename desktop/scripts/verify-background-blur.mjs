// Isolated experiment. Does not modify src/, public/, release/ or user workouts.
// Usage: node scripts/verify-background-blur.mjs [offline|realtime|camera|record|stability|interactive|all]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experiment = path.join(desktop, "scripts/background-blur");
const output = path.join(desktop, "output/background-blur-20261028");
const phase = process.argv[2] ?? "all";
const require = createRequire(import.meta.url);
async function playwright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require("playwright"); } catch {}
  const cache = path.join(homedir(), ".npm/_npx");
  for (const name of await fs.readdir(cache).catch(() => [])) {
    try { return require(path.join(cache, name, "node_modules/playwright")); } catch {}
  }
  throw Error("Playwright is required for isolated Electron validation; set PLAYWRIGHT_MODULE to its installed directory.");
}
async function fingerprint(directory) {
  const hashes = {};
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else hashes[path.relative(directory, file)] = createHash("sha256").update(await fs.readFile(file)).digest("hex");
    }
  }
  await walk(directory); return hashes;
}
const before = await fingerprint(path.join(desktop, "src"));
await fs.mkdir(output, { recursive: true });
for (const [entry, outfile] of [["scripts/background-blur/baseline.worker.ts", "baseline-worker.js"], ["src/media/pose.worker.ts", "production-worker.js"], ["scripts/background-blur/pose.worker.ts", "blur-worker.js"], ["scripts/background-blur/view.ts", "view.js"]]) {
  await build({ absWorkingDir: desktop, entryPoints: [entry], bundle: true, format: "iife", platform: "browser", target: "es2022", outfile: path.join(output, outfile), sourcemap: true });
}
await fs.copyFile(path.join(experiment, "index.html"), path.join(output, "index.html"));
const model = await fs.readFile(path.join(desktop, "public/models/pose_landmarker_full.task"));
await fs.writeFile(path.join(output, `${phase}-provenance.json`), JSON.stringify({
  date: new Date().toISOString(), phase, source: before, experiment: await fingerprint(experiment),
  modelSha256: createHash("sha256").update(model).digest("hex"),
  baselineWorker: "scripts/background-blur/baseline.worker.ts (preserved before integration)", candidateWorker: "scripts/background-blur/pose.worker.ts", productionWorker: "src/media/pose.worker.ts",
  options: { delegate: "CPU", numPoses: 1, runningMode: "VIDEO", minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5 },
  notes: "Independent Electron profile. No training data or source modifications. Recorded fixtures use deterministic 15 fps JPEG frames; live capture is assessed separately.",
}, null, 2));
const { _electron } = await playwright();
const app = await _electron.launch({ executablePath: require("electron"), args: [path.join(experiment, "harness.cjs")], env: { ...process.env, BLUR_OUTPUT: output }, timeout: 60000 });
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")) errors.push(m.text()); });
await page.waitForFunction(() => !!window.blurBench);
console.log("READY", phase, output);
async function save(name, value) { await fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2)); }
try {
  if (phase === "integrated") {
    const r = await page.evaluate(() => window.blurBench.toggleParity());
    await save("integrated-toggle-parity.json", r); console.log("INTEGRATED", JSON.stringify({ ...r, rows: undefined }));
    if (r.pointMismatches || r.stateMismatches || r.displayMismatches || r.productionCount !== 4) throw Error("Integrated toggle regression");
  }
  if (["all", "offline"].includes(phase)) {
    const summaries = [];
    for (const exercise of ["pushup", "squat"]) {
      const count = (await fs.readdir(path.join(desktop, "output/pose-model-comparison/frames", exercise))).filter(f => f.endsWith(".jpg")).length;
      const result = await page.evaluate(({ exercise, count }) => window.blurBench.offline(exercise, count, [30, 60, 90]), { exercise, count });
      for (const shot of result.screenshots) await fs.writeFile(path.join(output, `${exercise}-${shot.frame}.png`), Buffer.from(shot.data.split(",")[1], "base64"));
      delete result.screenshots; await save(`${exercise}-offline.json`, result);
      summaries.push(result.summary); console.log("OFFLINE", JSON.stringify(result.summary));
    }
    const failure = await page.evaluate(() => window.blurBench.effectFailure());
    await save("effect-failure.json", failure); await save("offline-summary.json", summaries);
    console.log("EFFECT FAILURE", JSON.stringify(failure));
    await page.screenshot({ path: path.join(output, "verification-window.png") });
  }
  if (["all", "realtime"].includes(phase)) {
    const runs = [];
    for (const source of ["pushup", "squat"]) for (const mode of ["baseline", "blur", "blur", "baseline"]) {
      const r = await page.evaluate(({ source, mode }) => window.blurBench.realtime(source, mode, 12), { source, mode });
      runs.push(r); await save("realtime.json", runs); console.log("REALTIME", JSON.stringify({ ...r, rows: undefined }));
    }
  }
  if (["all", "camera"].includes(phase)) {
    const runs = [];
    for (const mode of ["baseline", "blur", "blur", "baseline"]) {
      const r = await page.evaluate(mode => window.blurBench.realtime("camera", mode, 10), mode);
      runs.push(r); await save("camera.json", runs); console.log("CAMERA", JSON.stringify({ ...r, rows: undefined }));
    }
  }
  if (phase === "lifecycle") {
    const failure = await page.evaluate(() => window.blurBench.effectFailure());
    await save("effect-failure.json", failure);
    const initial = await page.locator("body").ariaSnapshot();
    await fs.writeFile(path.join(output, "preview-initial.yml"), initial);
    const checks = [];
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "播放对照", exact: true }).click();
      await page.waitForFunction(() => window.blurBench.running && document.getElementById("metrics").textContent.includes('"frames"'));
      await page.getByRole("button", { name: "固定当前取景", exact: true }).click();
      const locked = await page.locator(".frame").first().getAttribute("style");
      await page.waitForTimeout(500);
      const after = await page.locator(".frame").first().getAttribute("style");
      if (locked !== after) throw Error("Manual preview framing changed while locked");
      await page.getByRole("button", { name: "恢复自动取景", exact: true }).click();
      await page.getByRole("button", { name: "恢复全身", exact: true }).click();
      const transforms = await page.locator(".frame").evaluateAll(es => es.map(e => getComputedStyle(e).transform));
      if (transforms[0] !== transforms[1]) throw Error("Source and effect transform differ");
      await page.getByRole("button", { name: "停止", exact: true }).click();
      await page.waitForFunction(() => !window.blurBench.running);
      checks.push({ iteration: i, locked, transforms, stopped: true });
    }
    await save("lifecycle.json", { failure, checks }); console.log("LIFECYCLE", JSON.stringify({ failure, checks }));
  }
  if (phase === "stability") {
    const initial = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type: p.type, memory: p.memory })));
    const memorySamples = [];
    const started = Date.now();
    const timer = setInterval(() => {
      void app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type: p.type, memory: p.memory })))
        .then(processes => memorySamples.push({ seconds: (Date.now() - started) / 1000, processes })).catch(() => {});
    }, 15000);
    let r;
    try { r = await page.evaluate(() => window.blurBench.realtime("pushup", "blur", 120)); }
    finally { clearInterval(timer); }
    const final = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ type: p.type, memory: p.memory })));
    await save("stability.json", { initial, final, memorySamples, ...r }); console.log("STABILITY", JSON.stringify({ ...r, rows: undefined, initial, final }));
  }
  if (["all", "record"].includes(phase)) {
    for (const source of ["pushup", "squat"]) {
      const r = await page.evaluate(source => window.blurBench.realtime(source, "blur", 9, true), source);
      await save(`record-${source}.json`, r); console.log("RECORD", r.recordingName);
    }
  }
  if (phase === "interactive") {
    console.log("Interactive preview ready; close its window to exit.");
    await new Promise(resolve => app.on("close", resolve));
  }
} catch (e) {
  await save(`${phase}-failure.json`, { message: String(e), stack: e.stack, errors }); throw e;
} finally {
  const after = await fingerprint(path.join(desktop, "src"));
  await save(`${phase}-integrity.json`, { sourceUnchanged: JSON.stringify(before) === JSON.stringify(after), errors });
  if (phase !== "interactive") await app.close();
}
