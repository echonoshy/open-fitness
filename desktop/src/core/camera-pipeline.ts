import { CameraFramer } from "./camera-framing";
import { SessionEngine } from "./session";
import type { Point } from "./engine";

/** Shared by live capture and sequence regressions; counting always sees source coordinates. */
export function processCameraPose(
  framer: CameraFramer,
  engine: SessionEngine,
  points: Point[],
  time: number,
  aspect: number,
) {
  const current = engine.snapshot();
  const accepted = framer.update(points, time, {
    exercise: engine.exercise,
    training: current.status === "training" && !current.preparing,
    activeSet: engine.active,
    moving:
      current.status === "training" &&
      !current.preparing &&
      engine.exercise !== "plank" &&
      current.phase !== "IDLE",
    set: engine.recordId,
    aspect,
  });
  if (framer.reacquiredTarget) engine.prepareAfterReposition();
  const source = accepted ? points : [];
  engine.frame(source, time, aspect);
  if (!accepted)
    engine.trackingNotice =
      framer.snapshot().hint || "位置变化较大，正在确认连续画面";
  return source;
}
