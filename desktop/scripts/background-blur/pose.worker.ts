// Isolated candidate; production baseline is compiled from src/media/pose.worker.ts.
// Keep the same model, CPU delegate, thresholds, coordinates and timestamps.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { BlurCompositor } from "./compositor";
let model: PoseLandmarker;
let lastTimestamp = -1;
let compositor: BlurCompositor | undefined;
let mode: "mask" | "blur" = "blur";
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      mode = data.mode ?? "blur";
      const files = await FilesetResolver.forVisionTasks(data.wasm);
      model = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.model, delegate: "CPU" },
        runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputSegmentationMasks: true,
      });
      lastTimestamp = -1;
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const t = performance.now();
      try {
        const timestamp = Math.max(Math.round(data.timestamp), lastTimestamp + 1);
        lastTimestamp = timestamp;
        model.detectForVideo(data.bitmap, timestamp, result => {
          const points = (result.landmarks[0] ?? []).map((point, i) => ({ ...point, world: result.worldLandmarks[0]?.[i] }));
          const ms = performance.now() - t;
          const mask = result.segmentationMasks?.[0];
          let display: ImageBitmap | undefined, effectError: string | undefined;
          const renderAt = performance.now();
          // Effect errors must not discard otherwise valid keypoints or pause counting.
          if (mode === "blur") {
            try {
              compositor ??= new BlurCompositor();
              if (data.loseEffectContext) compositor.gl.getExtension("WEBGL_lose_context")?.loseContext();
              display = compositor.render(data.bitmap, mask);
            } catch (error) {
              effectError = String(error); compositor?.close(); compositor = undefined;
            }
          }
          const renderMs = performance.now() - renderAt;
          self.postMessage({
            type: "pose", points, ms, timestamp: data.timestamp,
            renderMs, workerMs: performance.now() - t,
            maskSize: mask ? [mask.width, mask.height] : null,
            display, effectError,
          }, { transfer: display ? [display] : [] });
          // Callback-owned masks are released by MediaPipe after this returns.
        });
      } finally { data.bitmap.close(); }
    }
  } catch (error) {
    self.postMessage({ type: "error", stage: data.type, message: String(error) });
  }
};
