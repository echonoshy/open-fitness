"""Extract local demonstration poses for rule calibration and SVG references.

Run with mediapipe, opencv-python and numpy installed. Results are cached outside
the shipped application; no camera recordings or network services are used.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault("GLOG_minloglevel", "3")

ROOT = Path(__file__).resolve().parents[1]


def extract(job):
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    movement, directory, fps = job
    source = ROOT / "public" / movement["video"].removeprefix("./")
    dest = Path(directory) / (movement["slug"] + ".json")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if dest.exists():
        previous = json.loads(dest.read_text())
        if previous.get("sha256") == digest and previous.get("fps") == fps:
            return movement["slug"], len(previous["frames"]), "cached"
    capture = cv2.VideoCapture(str(source))
    source_fps = capture.get(cv2.CAP_PROP_FPS)
    step = max(1, round(source_fps / fps))
    aspect = capture.get(cv2.CAP_PROP_FRAME_WIDTH) / capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(ROOT / "public/models/pose_landmarker_full.task")),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.4,
        min_pose_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    frames = []
    index = 0
    with vision.PoseLandmarker.create_from_options(options) as detector:
        while capture.isOpened():
            ok, frame = capture.read()
            if not ok:
                break
            if index % step == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), round(index / source_fps * 1000))
                points = []
                if result.pose_landmarks:
                    for p, w in zip(result.pose_landmarks[0], result.pose_world_landmarks[0]):
                        points.append([round(p.x, 4), round(p.y, 4), round(p.z, 4), round(p.visibility, 3), round(w.x, 4), round(w.y, 4), round(w.z, 4)])
                frames.append({"t": round(index / source_fps, 4), "points": points})
            index += 1
    capture.release()
    dest.write_text(json.dumps({"slug": movement["slug"], "sha256": digest, "fps": fps, "aspect": aspect, "frames": frames}, separators=(",", ":")))
    return movement["slug"], sum(bool(f["points"]) for f in frames), "extracted"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--fps", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    Path(args.output).mkdir(parents=True, exist_ok=True)
    movements = json.loads((ROOT / "public/library/catalog.json").read_text())["movements"]
    if args.limit:
        movements = movements[:args.limit]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for count, result in enumerate(pool.map(extract, [(m, args.output, args.fps) for m in movements]), 1):
            print(count, *result, flush=True)
