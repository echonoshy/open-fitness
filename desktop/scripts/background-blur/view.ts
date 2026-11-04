import { SessionEngine } from "../../src/core/session";
import { CameraFramer, cameraTransform } from "../../src/core/camera-framing";
import { processCameraPose } from "../../src/core/camera-pipeline";
import { drawPose } from "../../src/media/camera";
import type { Exercise, Point } from "../../src/core/engine";

type Mode = "baseline" | "mask" | "blur" | "production";
type Result = { points: Point[]; ms: number; renderMs?: number; workerMs?: number; display?: ImageBitmap; maskSize?: number[]; effectError?: string; roundTripMs: number };
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const original = el<HTMLCanvasElement>("original"), blurred = el<HTMLCanvasElement>("blurred");
const originalBones = el<HTMLCanvasElement>("bones-original"), blurredBones = el<HTMLCanvasElement>("bones-blurred");
const status = (text: string) => { el("status").textContent = text; };
const metrics = (value: unknown) => { el("metrics").textContent = JSON.stringify(value, null, 2); };
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
let active: { stop: boolean } | undefined;
let currentFramer: CameraFramer | undefined;

class PoseWorker {
  worker: Worker;
  constructor(mode: Mode) { this.worker = new Worker(mode === "baseline" ? "baseline-worker.js" : mode === "production" ? "production-worker.js" : "blur-worker.js"); }
  async init(mode: Mode) {
    return this.request({ type: "init", mode, wasm: "coach://app/assets/wasm", model: "coach://app/assets/models/pose_landmarker_full.task" });
  }
  request(data: object, transfer: Transferable[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("模型处理超时")), 45000);
      this.worker.onerror = e => { clearTimeout(timer); reject(Error(e.message)); };
      this.worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        data.type === "error" ? reject(Error(data.message)) : resolve(data);
      };
      this.worker.postMessage(data, transfer);
    });
  }
  async frame(bitmap: ImageBitmap, timestamp: number, extra = {}): Promise<Result> {
    const start = performance.now();
    const r = await this.request({ type: "frame", bitmap, timestamp, ...extra }, [bitmap]);
    return { ...r, roundTripMs: performance.now() - start };
  }
  close() { this.worker.terminate(); }
}

function tracker(exercise: Exercise) {
  const engine = new SessionEngine(), framer = new CameraFramer();
  let now = 0;
  engine.now = () => now; engine.cameraReady = true; engine.exercise = exercise; engine.goal = 100;
  engine.dispatch({ type: "session", action: "start" });
  return {
    engine, framer,
    feed(points: Point[], time: number, aspect: number) {
      now = time;
      processCameraPose(framer, engine, points, time, aspect);
      return {
        count: engine.rows.length, phase: engine.counter.phase, angles: { ...engine.angles },
        preparing: engine.preparing, tracking: engine.tracking, notice: engine.trackingNotice,
        hold: engine.snapshot().hold, view: framer.snapshot(),
        faults: [...engine.faults], scores: engine.rows.map(r => r.score),
      };
    },
  };
}
function resize(w: number, h: number) {
  for (const c of [original, blurred, originalBones, blurredBones]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  for (const viewport of document.querySelectorAll<HTMLElement>(".viewport")) viewport.style.aspectRatio = `${w}/${h}`;
}
function paint(source: CanvasImageSource, result: Result, state: ReturnType<typeof tracker>) {
  original.getContext("2d")!.drawImage(source, 0, 0);
  blurred.getContext("2d")!.drawImage(result.display ?? source, 0, 0);
  result.display?.close();
  for (const c of [originalBones, blurredBones]) drawPose(c, result.points, state.engine.faults);
  for (const frame of document.querySelectorAll<HTMLElement>(".frame")) frame.style.transform = cameraTransform(state.framer.snapshot());
}
function stats(values: number[]) {
  if (!values.length) return { mean: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)! };
}
async function frameImage(exercise: string, index: number) {
  return createImageBitmap(await (await fetch(`/fixtures/frames/${exercise}/${String(index).padStart(4, "0")}.jpg`)).blob());
}
function maxPointDelta(a: Point[], b: Point[]) {
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (const key of ["x", "y", "z", "visibility", "presence"] as const) max = Math.max(max, Math.abs(((a[i] as any)[key] ?? 0) - ((b[i] as any)[key] ?? 0)));
    for (const key of ["x", "y", "z"] as const) max = Math.max(max, Math.abs((a[i].world?.[key] ?? 0) - (b[i].world?.[key] ?? 0)));
  }
  return max;
}
async function offline(exercise: Exercise, count: number, captures: number[] = []) {
  status(`逐帧对照：${exercise}`);
  const modes: Mode[] = ["baseline", "mask", "blur"];
  const workers = Object.fromEntries(modes.map(m => [m, new PoseWorker(m)])) as Record<Mode, PoseWorker>;
  const states = Object.fromEntries(modes.map(m => [m, tracker(exercise)])) as Record<Mode, ReturnType<typeof tracker>>;
  const rows: any[] = [], screenshots: { frame: number; data: string }[] = [];
  try {
    for (const m of modes) await workers[m].init(m);
    for (let i = 1; i <= count; i++) {
      const source = await frameImage(exercise, i); resize(source.width, source.height);
      const results: Partial<Record<Mode, Result>> = {}, snapshots: Record<string, unknown> = {};
      // Alternate execution order to reduce warm-up/order bias.
      for (const m of [...modes.slice(i % 3), ...modes.slice(0, i % 3)]) {
        const r = results[m] = await workers[m].frame(await createImageBitmap(source), i * 1000 / 15);
        if (i === 35) states[m].framer.command("lock");
        if (i === 55) states[m].framer.command({ type: "camera_view", action: "zoom_in", adjustment: "step" });
        if (i === 75) states[m].framer.command("auto");
        if (i === 95) states[m].framer.command("full");
        snapshots[m] = states[m].feed(r.points, i / 15, source.width / source.height);
      }
      const b = results.baseline!, m = results.mask!, r = results.blur!;
      paint(source, r, states.blur);
      rows.push({
        frame: i, pointDelta: maxPointDelta(b.points, r.points), maskPointDelta: maxPointDelta(b.points, m.points),
        allPointFieldsEqual: JSON.stringify(b.points) === JSON.stringify(r.points),
        stateEqual: JSON.stringify(snapshots.baseline) === JSON.stringify(snapshots.blur),
        maskStateEqual: JSON.stringify(snapshots.baseline) === JSON.stringify(snapshots.mask),
        maskSize: r.maskSize, effectError: r.effectError,
        timings: Object.fromEntries(modes.map(mode => { const v = results[mode]!; return [mode, { inference: v.ms, composite: v.renderMs ?? 0, roundTrip: v.roundTripMs }]; })),
        baseline: snapshots.baseline, blur: snapshots.blur,
      });
      if (captures.includes(i)) screenshots.push({ frame: i, data: comparisonImage().toDataURL("image/png") });
      source.close();
      if (i % 20 === 0) status(`逐帧对照：${exercise} ${i}/${count}`);
    }
    const timings = Object.fromEntries(modes.map(mode => [mode, Object.fromEntries(["inference", "composite", "roundTrip"].map(key => [key, stats(rows.slice(5).map(r => r.timings[mode][key]))]))]));
    const summary = { exercise, frames: count, pointDelta: Math.max(...rows.map(r => r.pointDelta)), pointMismatches: rows.filter(r => !r.allPointFieldsEqual).length, stateMismatches: rows.filter(r => !r.stateEqual).length, maskStateMismatches: rows.filter(r => !r.maskStateEqual).length, effectErrors: rows.filter(r => r.effectError).length, counts: Object.fromEntries(modes.map(m => [m, states[m].engine.rows.length])), timings };
    metrics(summary); return { summary, rows, screenshots };
  } finally { for (const w of Object.values(workers)) w.close(); }
}

function comparisonImage() {
  const c = document.createElement("canvas"); c.width = 1280; c.height = 414;
  const ctx = c.getContext("2d")!; ctx.fillStyle = "#171a16"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#edf2e7"; ctx.font = "18px sans-serif"; ctx.fillText("ORIGINAL / SAME FRAME", 20, 32); ctx.fillText("BACKGROUND BLUR / POSE FULL", 660, 32);
  ctx.drawImage(original, 0, 54, 640, 360); ctx.drawImage(blurred, 640, 54, 640, 360);
  return c;
}

async function sourceVideo(source: string) {
  const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.className = "source-video";
  document.body.append(video);
  let stream: MediaStream | undefined;
  try {
    if (source === "camera") {
      let devices = await navigator.mediaDevices.enumerateDevices();
      // Chromium can withhold device labels until a video track is active even
      // when the OS permission is already granted. Do not play or save this probe.
      if (devices.some(d => d.kind === "videoinput" && !d.label)) {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        try { devices = await navigator.mediaDevices.enumerateDevices(); }
        finally { probe.getTracks().forEach(t => t.stop()); }
      }
      const preferred = devices.find(d => d.kind === "videoinput" && /viaim.*connect/i.test(d.label))
        ?? devices.find(d => d.kind === "videoinput" && /MacBook.*Camera/i.test(d.label));
      if (!preferred) throw Error("未找到 viaim Connect 或 MacBook 摄像头；请连接设备后重试。");
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: preferred.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      video.srcObject = stream;
    } else { video.src = `/fixtures/${source === "pushup" ? "pushups" : "squats"}.demo.video.mp4`; video.loop = true; }
    await video.play();
    const label = stream?.getVideoTracks()[0].label ?? source;
    return { video, label, close() { video.pause(); stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; video.removeAttribute("src"); video.load(); video.remove(); } };
  } catch (e) { stream?.getTracks().forEach(t => t.stop()); video.remove(); throw e; }
}

async function realtime(source: string, mode: Mode, seconds = 12, record = false, targetWidth = 1280) {
  if (active) throw Error("请先停止当前验证");
  const token: { stop: boolean } = { stop: false };
  active = token;
  const worker = new PoseWorker(mode), state = tracker(source === "squat" ? "squat" : "pushup");
  currentFramer = state.framer;
  let input: Awaited<ReturnType<typeof sourceVideo>> | undefined;
  let recorder: MediaRecorder | undefined, recording: Promise<Blob> | undefined, recordStream: MediaStream | undefined;
  let callback = 0;
  const rows: any[] = [];
  try {
    status(`加载 ${mode}：${source}`); await worker.init(mode); input = await sourceVideo(source);
    const video = input.video;
    const width = source === "camera" ? video.videoWidth : Math.min(targetWidth, video.videoWidth);
    const height = Math.round(width * video.videoHeight / video.videoWidth);
    resize(width, height);
    const staging = document.createElement("canvas"); staging.width = width; staging.height = height;
    const ctx = staging.getContext("2d")!;
    const recordingCanvas = comparisonImage();
    if (record) {
      recordStream = recordingCanvas.captureStream(30);
      recorder = new MediaRecorder(recordStream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 4_000_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recording = new Promise(resolve => { recorder!.onstop = () => resolve(new Blob(chunks, { type: "video/webm" })); });
      recorder.start();
    }
    const start = performance.now(); let callbacks = 0, skipped = 0, busy = false;
    status(`${input.label} · ${mode} 运行中`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { token.stop = true; if (!busy) resolve(); }, seconds * 1000 + 5000);
      const done = (e?: unknown) => { clearTimeout(timer); video.cancelVideoFrameCallback(callback); e ? reject(e) : resolve(); };
      const loop = async (t: number, metadata: VideoFrameCallbackMetadata) => {
        if (token.stop || performance.now() - start >= seconds * 1000) { if (!busy) done(); return; }
        callback = video.requestVideoFrameCallback(loop); callbacks++;
        if (busy) { skipped++; return; }
        busy = true;
        try {
          const at = performance.now();
          const bitmap = await createImageBitmap(video, { resizeWidth: width, resizeHeight: height }); ctx.drawImage(bitmap, 0, 0);
          const r = await worker.frame(bitmap, t);
          state.feed(r.points, (t - start) / 1000, video.videoWidth / video.videoHeight);
          paint(staging, r, state);
          if (record) recordingCanvas.getContext("2d")!.drawImage(comparisonImage(), 0, 0);
          rows.push({ ms: r.ms, compositeMs: r.renderMs ?? 0, workerMs: r.workerMs ?? r.ms, endToEndMs: performance.now() - at, mediaTime: metadata.mediaTime, detected: r.points.length === 33, maskSize: r.maskSize, effectError: r.effectError, count: state.engine.rows.length });
          if (rows.length % 30 === 0) metrics({ mode, source: input!.label, frames: rows.length, fps: rows.length * 1000 / (performance.now() - start), count: state.engine.rows.length, inferenceMs: stats(rows.slice(5).map(r => r.ms)), compositeMs: stats(rows.slice(5).map(r => r.compositeMs)) });
        } catch (e) { token.stop = true; done(e); }
        finally { busy = false; if (token.stop || performance.now() - start >= seconds * 1000) done(); }
      };
      callback = video.requestVideoFrameCallback(loop);
    });
    const elapsed = performance.now() - start;
    let recordingName: string | undefined;
    if (recorder && recording) {
      recorder.stop(); const blob = await recording;
      recordingName = `comparison-${source}-${Date.now()}.webm`;
      await (window as any).blurArtifacts.save(recordingName, Array.from(new Uint8Array(await blob.arrayBuffer())));
    }
    const warm = rows.slice(5);
    const result = { source: input.label, mode, width, height, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, seconds: elapsed / 1000, frames: rows.length, fps: rows.length * 1000 / elapsed, callbacks, skipped, count: state.engine.rows.length, detected: rows.filter(r => r.detected).length, effectErrors: rows.filter(r => r.effectError).length, inferenceMs: stats(warm.map(r => r.ms)), compositeMs: stats(warm.map(r => r.compositeMs)), endToEndMs: stats(warm.map(r => r.endToEndMs)), recordingName, rows };
    metrics({ ...result, rows: undefined }); status("验证完成"); return result;
  } finally {
    if (recorder?.state === "recording") recorder.stop(); recordStream?.getTracks().forEach(t => t.stop());
    if (input) { input.video.cancelVideoFrameCallback(callback); input.close(); }
    worker.close(); active = undefined; currentFramer = undefined;
  }
}

async function effectFailure() {
  const worker = new PoseWorker("blur"); await worker.init("blur");
  const b = new PoseWorker("baseline"); await b.init("baseline");
  try {
    const source = await frameImage("pushup", 40);
    const baseline = await b.frame(await createImageBitmap(source), 1000);
    const failed = await worker.frame(await createImageBitmap(source), 1000, { loseEffectContext: true });
    const recovered = await worker.frame(await createImageBitmap(source), 1100);
    failed.display?.close(); recovered.display?.close(); source.close();
    const blank = new OffscreenCanvas(1280, 720);
    blank.getContext("2d")!.fillRect(0, 0, 1280, 720);
    const empty = await worker.frame(await createImageBitmap(blank), 1200);
    const noPerson = { points: empty.points.length, mask: empty.maskSize ?? null, display: !!empty.display };
    empty.display?.close();
    return { effectError: failed.effectError, preservedPoints: failed.points.length, pointDelta: maxPointDelta(baseline.points, failed.points), recoveredDisplay: !!recovered.display, recoveryError: recovered.effectError, noPerson };
  } finally { worker.close(); b.close(); }
}

async function toggleParity() {
  const baseline = new PoseWorker("baseline"), production = new PoseWorker("production");
  const a = tracker("pushup"), b = tracker("pushup");
  const rows = [];
  let enabled = true;
  try {
    await baseline.init("baseline"); await production.init("production");
    for (let i = 1; i <= 127; i++) {
      if ([30, 48, 70, 90].includes(i)) {
        enabled = !enabled;
        production.worker.postMessage({ type: "background-blur", enabled });
      }
      if (i === 100) {
        production.worker.postMessage({ type: "background-blur", enabled: false });
        production.worker.postMessage({ type: "background-blur", enabled: true });
      }
      if (i === 35) { a.framer.command("lock"); b.framer.command("lock"); }
      const source = await frameImage("pushup", i);
      const ra = await baseline.frame(await createImageBitmap(source), i * 1000 / 15);
      const rb = await production.frame(await createImageBitmap(source), i * 1000 / 15);
      const sa = a.feed(ra.points, i / 15, 16 / 9), sb = b.feed(rb.points, i / 15, 16 / 9);
      rows.push({ frame: i, enabled, display: !!rb.display, equalPoints: JSON.stringify(ra.points) === JSON.stringify(rb.points), equalState: JSON.stringify(sa) === JSON.stringify(sb), baselineCount: sa.count, productionCount: sb.count, effectError: rb.effectError });
      rb.display?.close(); source.close();
    }
    return { frames: rows.length, pointMismatches: rows.filter(r => !r.equalPoints).length, stateMismatches: rows.filter(r => !r.equalState).length, displayMismatches: rows.filter(r => r.enabled !== r.display).length, baselineCount: a.engine.rows.length, productionCount: b.engine.rows.length, rows };
  } finally { baseline.close(); production.close(); }
}

(window as any).blurBench = { offline, realtime, effectFailure, toggleParity, stats, get running() { return !!active; }, comparison: () => comparisonImage().toDataURL(), stop: () => { if (active) active.stop = true; } };
el("play").onclick = () => void realtime(el<HTMLSelectElement>("sample").value, "blur", 3600).catch(e => status(String(e)));
el("camera").onclick = () => void realtime("camera", "blur", 3600).catch(e => status(String(e)));
el("stop").onclick = () => { if (active) active.stop = true; };
for (const name of ["lock", "auto", "full"] as const) el(name).onclick = () => {
  currentFramer?.command(name);
  if (currentFramer) for (const frame of document.querySelectorAll<HTMLElement>(".frame")) frame.style.transform = cameraTransform(currentFramer.snapshot());
};
status("就绪 · 可播放样本或开始摄像头对照");
