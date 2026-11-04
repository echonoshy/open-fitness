// Frozen pre-blur worker for controlled regression comparison (2026-10-28).
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
let model: PoseLandmarker;
let lastTimestamp = -1;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const files = await FilesetResolver.forVisionTasks(data.wasm);
      model = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.model, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      lastTimestamp = -1;
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const t = performance.now();
      try {
        // Integer milliseconds avoid inconsistent float-to-microsecond rounding
        // across MediaPipe's input streams during long-running capture.
        const timestamp = Math.max(
          Math.round(data.timestamp),
          lastTimestamp + 1,
        );
        lastTimestamp = timestamp;
        const result = model.detectForVideo(data.bitmap, timestamp);
        self.postMessage({
          type: "pose",
          // Existing exercises keep image coordinates. Push-ups additionally
          // use camera-relative world geometry for multi-view counting.
          points: (result.landmarks[0] ?? []).map((point, i) => ({
            ...point,
            world: result.worldLandmarks[0]?.[i],
          })),
          ms: performance.now() - t,
          timestamp: data.timestamp,
        });
      } finally {
        data.bitmap.close();
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      stage: data.type,
      message: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};
