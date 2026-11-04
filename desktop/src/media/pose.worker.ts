import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { BlurCompositor } from "./background-blur";
let model: PoseLandmarker;
let lastTimestamp = -1;
let blurEnabled = true;
let effectFailed = false;
let compositor: BlurCompositor | undefined;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      blurEnabled = data.backgroundBlur !== false;
      const files = await FilesetResolver.forVisionTasks(data.wasm);
      model = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.model, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        // Keep the graph stable across display toggles. setOptions would rebuild
        // it and reset the tracking state in the middle of a repetition.
        outputSegmentationMasks: true,
      });
      lastTimestamp = -1;
      self.postMessage({ type: "ready" });
    } else if (data.type === "background-blur") {
      blurEnabled = data.enabled;
      effectFailed = false;
      if (!blurEnabled) {
        compositor?.close();
        compositor = undefined;
      }
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
        model.detectForVideo(data.bitmap, timestamp, (result) => {
          const points = (result.landmarks[0] ?? []).map((point, i) => ({
            ...point,
            world: result.worldLandmarks[0]?.[i],
          }));
          const ms = performance.now() - t;
          let display: ImageBitmap | undefined, effectError: string | undefined;
          if (blurEnabled && !effectFailed) {
            try {
              compositor ??= new BlurCompositor();
              display = compositor.render(
                data.bitmap,
                result.segmentationMasks?.[0],
              );
            } catch (error) {
              // Preserve keypoints and counting when only the visual effect fails.
              effectError = String(error);
              effectFailed = true;
              compositor?.close();
              compositor = undefined;
            }
          }
          self.postMessage(
            {
              type: "pose",
              points,
              ms,
              timestamp: data.timestamp,
              display,
              effectError,
              effectVersion: data.effectVersion,
            },
            { transfer: display ? [display] : [] },
          );
          // Callback-owned masks are released by MediaPipe here, without clones.
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
