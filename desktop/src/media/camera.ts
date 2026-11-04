import {
  EXERCISES,
  type Exercise,
  type Angles,
  type BodySide,
  type Point,
} from "../core/engine";
export class Camera {
  stream: MediaStream | null = null;
  worker: Worker | null = null;
  stopped = true;
  busy = false;
  callback = 0;
  generation = 0;
  brightness: number | null = null;
  private lightAt = 0;
  private cancelReady: (() => void) | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lightCanvas = document.createElement("canvas");
  private backgroundBlur = true;
  private effectVersion = 0;
  private effectWarning = "";
  constructor(
    public video: HTMLVideoElement,
    public pose: (points: Point[], time: number, ms: number) => void,
    public error: (message: string) => void,
    private effect?: {
      canvas: HTMLCanvasElement;
      enabled: boolean;
      notice: (message: string) => void;
    },
  ) {
    this.backgroundBlur = effect?.enabled ?? true;
  }
  setBackgroundBlur(enabled: boolean) {
    if (enabled === this.backgroundBlur && !this.effectWarning) return;
    this.backgroundBlur = enabled;
    this.effectVersion++;
    this.effectWarning = "";
    this.effect?.notice("");
    if (this.effect) this.effect.canvas.hidden = true;
    this.worker?.postMessage({ type: "background-blur", enabled });
  }
  async start(device?: string) {
    this.stop();
    const generation = ++this.generation;
    this.stopped = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: device ? { exact: device } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      if (this.stopped || generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("已取消开启");
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (this.stopped || generation !== this.generation)
        throw Error("已取消开启");
      const worker = new Worker(new URL("pose-worker.js", document.baseURI));
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("姿态模型加载超时")),
          45000,
        );
        this.cancelReady = () => {
          clearTimeout(timer);
          reject(Error("已取消开启"));
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(Error(e.message || "姿态线程启动失败"));
        };
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (data.type === "error") {
            clearTimeout(timer);
            console.error("[pose] initialization failed", data);
            reject(Error(data.message));
          }
        };
        worker.postMessage({
          type: "init",
          backgroundBlur: this.backgroundBlur && !!this.effect,
          wasm: new URL("wasm", document.baseURI).href,
          model: new URL("models/pose_landmarker_full.task", document.baseURI)
            .href,
        });
      });
      this.cancelReady = null;
      if (this.stopped || generation !== this.generation)
        throw Error("已取消开启");
      worker.onerror = (e) => this.fail(e.message);
      let frames = 0;
      let poseFrames = 0;
      let inferenceMs = 0;
      worker.onmessage = ({ data }) => {
        if (this.stopped || generation !== this.generation) {
          data.display?.close();
          return;
        }
        this.busy = false;
        if (data.type === "pose") {
          frames++;
          if (data.points.length === 33) poseFrames++;
          inferenceMs += data.ms;
          // Aggregate diagnostics only: never log camera images or coordinates.
          if (frames === 1 || frames % 300 === 0)
            console.debug(
              "[pose] frames",
              frames,
              "detected",
              poseFrames,
              "mean inference ms",
              Math.round(inferenceMs / frames),
            );
          this.pose(data.points, data.timestamp / 1000, data.ms);
          // Display is independent of the source-coordinate training pipeline.
          try {
            if (
              this.effect &&
              this.backgroundBlur &&
              data.effectVersion === this.effectVersion
            ) {
              if (data.effectError) throw Error(data.effectError);
              if (data.display) {
                const canvas = this.effect.canvas;
                if (
                  canvas.width !== data.display.width ||
                  canvas.height !== data.display.height
                ) {
                  canvas.width = data.display.width;
                  canvas.height = data.display.height;
                }
                canvas.getContext("2d")!.drawImage(data.display, 0, 0);
                canvas.hidden = false;
              }
            }
          } catch {
            if (this.effect) this.effect.canvas.hidden = true;
            this.worker?.postMessage({
              type: "background-blur",
              enabled: false,
            });
            this.effectWarning =
              "背景虚化暂不可用，已恢复原始画面；动作识别继续运行。可关闭再开启虚化重试。";
            this.effect?.notice(this.effectWarning);
          } finally {
            data.display?.close();
          }
        } else if (data.type === "error") {
          console.error("[pose] processing failed", data);
          this.fail(data.message);
        }
      };
      stream.getVideoTracks()[0].onended = () =>
        this.fail("摄像头已断开，请重新连接设备。");
      let lastVideo = performance.now();
      this.watchdog = setInterval(() => {
        if (
          document.visibilityState !== "visible" ||
          !this.video.checkVisibility()
        ) {
          lastVideo = performance.now();
          return;
        }
        if (!this.stopped && performance.now() - lastVideo > 8000)
          this.fail("摄像头连续未返回画面，训练已暂停，请重新连接设备后开启。");
      }, 1000);
      const loop = async (t: number) => {
        if (this.stopped) return;
        lastVideo = performance.now();
        this.callback = this.video.requestVideoFrameCallback(loop);
        if (this.busy) return;
        this.busy = true;
        try {
          if (t - this.lightAt > 1000) {
            this.lightAt = t;
            this.lightCanvas.width = 32;
            this.lightCanvas.height = 18;
            const ctx = this.lightCanvas.getContext("2d", {
              willReadFrequently: true,
            })!;
            ctx.drawImage(this.video, 0, 0, 32, 18);
            const pixels = ctx.getImageData(0, 0, 32, 18).data;
            let total = 0;
            for (let i = 0; i < pixels.length; i += 4)
              total +=
                0.2126 * pixels[i] +
                0.7152 * pixels[i + 1] +
                0.0722 * pixels[i + 2];
            this.brightness = total / (32 * 18 * 255);
          }
          const bitmap = await createImageBitmap(this.video);
          if (this.stopped) {
            bitmap.close();
            return;
          }
          worker.postMessage(
            {
              type: "frame",
              bitmap,
              timestamp: t,
              effectVersion: this.effectVersion,
            },
            [bitmap],
          );
        } catch (e) {
          this.busy = false;
          if (!this.stopped) this.fail(String(e));
        }
      };
      this.callback = this.video.requestVideoFrameCallback(loop);
      return stream.getVideoTracks()[0].label;
    } catch (e) {
      this.stop();
      throw e;
    }
  }
  fail(message: string) {
    this.stop();
    this.error(
      /activeTexture|webgl|context lost/i.test(message)
        ? "姿态识别的图形处理已中断，请重新开启摄像头；若仍失败，请退出并重新打开应用。"
        : message,
    );
  }
  stop() {
    this.stopped = true;
    this.generation++;
    this.video.cancelVideoFrameCallback(this.callback);
    this.cancelReady?.();
    this.cancelReady = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.stream && this.video.srcObject === this.stream)
      this.video.srcObject = null;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    if (this.effect) this.effect.canvas.hidden = true;
  }
}
export const bones = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [28, 30],
  [30, 32],
];
export function drawPose(
  canvas: HTMLCanvasElement,
  p: Point[],
  faults: string[] = [],
  feedback?: { exercise: Exercise; angles: Angles; side?: BodySide },
) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (p.length !== 33) return;
  ctx.strokeStyle = "#c9ed89";
  ctx.fillStyle = "#f0f2ed";
  ctx.lineWidth = 3;
  for (const [a, b] of bones) {
    if ((p[a].visibility ?? 0) < 0.5 || (p[b].visibility ?? 0) < 0.5) continue;
    const legs = faults.some((f) => ["knees_cave", "shallow"].includes(f));
    const torso = faults.some((f) =>
      [
        "back_lean",
        "back_round",
        "body_sag",
        "torso_lean",
        "lean_back",
        "shrug_neck",
      ].includes(f),
    );
    const arms = faults.some((f) =>
      ["elbow_swing", "elbow_flare", "uneven", "chin"].includes(f),
    );
    ctx.strokeStyle =
      (legs && a >= 23 && b >= 23) ||
      (torso && [11, 12, 23, 24].includes(a) && [11, 12, 23, 24].includes(b)) ||
      (arms && a <= 16 && b <= 16)
        ? "#ff907b"
        : "#c9ed89";
    ctx.beginPath();
    ctx.moveTo(p[a].x * canvas.width, p[a].y * canvas.height);
    ctx.lineTo(p[b].x * canvas.width, p[b].y * canvas.height);
    ctx.stroke();
  }
  for (const i of new Set(bones.flat())) {
    if ((p[i].visibility ?? 0) < 0.5) continue;
    ctx.beginPath();
    ctx.arc(p[i].x * canvas.width, p[i].y * canvas.height, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (feedback) {
    const spec = EXERCISES[feedback.exercise];
    const value = feedback.angles[spec.signal];
    const index =
      (spec.signal === "knee" ? 25 : spec.signal === "elbow" ? 13 : 23) +
      (feedback.side === "right" ? 1 : 0);
    if (Number.isFinite(value) && p[index]) {
      ctx.save();
      ctx.translate(p[index].x * canvas.width, p[index].y * canvas.height - 28);
      ctx.scale(-1, 1); // The whole camera canvas is mirrored, but labels must remain readable.
      ctx.fillStyle = "#202020e8";
      ctx.fillRect(-36, -24, 72, 32);
      ctx.fillStyle = "#d0ff71";
      ctx.font = "600 23px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round(value)}°`, 0, 0);
      ctx.restore();
    }
  }
}
