import test from "node:test";
import assert from "node:assert/strict";
import {
  CameraFramer,
  cameraCommandSchema,
  bodyBounds,
  type CameraViewCommand,
} from "../src/core/camera-framing";
import { localVoiceCommand } from "../src/core/voice-routing";
import { coachTurn } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";
import type { Point } from "../src/core/engine";

function body(height = 0.25): Point[] {
  const points = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
    z: 0,
  }));
  for (const [i, x, y] of [
    [0, 0, -0.5],
    [7, -0.04, -0.48],
    [8, 0.04, -0.48],
    [11, -0.1, -0.35],
    [12, 0.1, -0.35],
    [15, -0.2, 0],
    [16, 0.2, 0],
    [23, -0.08, 0],
    [24, 0.08, 0],
    [25, -0.08, 0.25],
    [26, 0.08, 0.25],
    [27, -0.08, 0.48],
    [28, 0.08, 0.48],
    [31, -0.1, 0.5],
    [32, 0.1, 0.5],
  ])
    points[i] = {
      x: 0.5 + x * height,
      y: 0.5 + y * height,
      visibility: 0.95,
      z: 0,
    };
  return points;
}
function harness() {
  const f = new CameraFramer();
  let t = 0;
  const feed = (points: Point[], frames = 250, moving = false) => {
    for (let i = 0; i < frames; i++)
      f.update(points, (t += 0.04), {
        exercise: "squat",
        set: "one",
        training: false,
        moving,
      });
  };
  const say = (text: string) => {
    const c = cameraCommandSchema.parse(localVoiceCommand(text));
    assert.equal(c.type, "camera_view");
    return f.command(c as CameraViewCommand);
  };
  return { f, feed, say };
}
const near = (a: number, b: number, tolerance = 0.01) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} ≉ ${b}`);

test("zooming out at the full source frame reports the physical limit even without tracking", () => {
  const { f, feed, say } = harness();
  feed([]);
  const ratio = f.snapshot().targetSubjectRatio;
  for (let i = 0; i < 2; i++) {
    const receipt = say("缩小一点");
    assert.equal(receipt.ok, false);
    assert.match(receipt.message, /完整画面.*无法再缩小/);
    assert.equal(f.snapshot().targetSubjectRatio, ratio);
  }
  assert.equal(f.snapshot().zoom, 1);
});

test("voice zoom frames a small person in one adjustment and continues following", () => {
  const { f, feed, say } = harness();
  feed(body());
  const reply = say("放大一点");
  assert.equal(reply.ok, true);
  assert.match(reply.message, /继续跟随/);
  assert.equal(f.snapshot().automatic, true);
  near(f.snapshot().targetZoom!, 3);
  feed(body());
  near(f.snapshot().subjectRatio!, 0.75);
  feed(body(0.6));
  near(f.snapshot().subjectRatio!, 0.75);
  assert.ok(f.snapshot().zoom < 1.3);
  feed(body());
  near(f.snapshot().zoom, 3);
});
test("fixed wide view jumps to useful body size then remains fixed", () => {
  const { f, feed, say } = harness();
  feed(body());
  say("恢复全身");
  const result = say("把我放大一点");
  assert.equal(result.ok, true);
  assert.equal(f.snapshot().automatic, false);
  near(f.snapshot().targetZoom!, 2.8);
  assert.equal(f.snapshot().zoom, 1, "voice transition is smooth");
  feed(body());
  near(f.snapshot().zoom, 2.8);
  feed(body(0.6));
  near(f.snapshot().zoom, 2.8);
});
test("repeated zoom commands use the pending destination, not an intermediate frame", () => {
  const { f, feed, say } = harness();
  feed(body(0.4));
  say("恢复全身");
  say("放大一点");
  near(f.snapshot().targetZoom!, 1.75);
  say("再大一点");
  near(f.snapshot().targetZoom!, 2);
  assert.equal(say("还是太小了").ok, false);
});
test("fine zoom is relative ten percent and buttons retain fine fixed steps", () => {
  const { f, feed, say } = harness();
  feed(body(0.4));
  const before = f.snapshot().targetZoom!;
  say("稍微再大一点");
  near(f.snapshot().targetZoom!, before * 1.1);
  assert.equal(f.snapshot().automatic, true);
  feed(body(0.4));
  const current = f.snapshot().zoom;
  f.command({ type: "camera_view", action: "zoom_in", adjustment: "step" });
  near(f.snapshot().zoom, current + 0.1);
  assert.equal(f.snapshot().automatic, false);
});
test("absolute and relative zoom are distinct and keep fixed mode", () => {
  const { f, feed, say } = harness();
  say("固定画面");
  say("放大到一点五倍");
  near(f.snapshot().targetZoom!, 1.5);
  say("放大一倍");
  near(f.snapshot().targetZoom!, 3);
  say("缩小到2倍");
  near(f.snapshot().targetZoom!, 2);
  feed([]);
  near(f.snapshot().zoom, 2);
  assert.equal(f.snapshot().automatic, false);
});
test("explicit low zoom is not incorrectly raised to the ordinary minimum occupancy", () => {
  const { f, feed, say } = harness();
  feed(body(0.12));
  say("缩小到1倍");
  feed(body(0.12));
  near(f.snapshot().zoom, 1);
  assert.equal(f.snapshot().automatic, true);
  say("稍微放大一点");
  near(f.snapshot().targetZoom!, 1.1);
});
test("successive ordinary zoom-out requests reach the original wide view", () => {
  const { f, feed, say } = harness();
  feed(body());
  for (let i = 0; i < 5; i++) say("缩小一点");
  feed(body());
  near(f.snapshot().zoom, 1);
  assert.equal(f.snapshot().automatic, true);
  assert.equal(say("缩小一点").ok, false);
});
test("a zoom request cannot accidentally reverse direction at occupancy limits", () => {
  const { f, feed, say } = harness();
  feed(body(0.6));
  say("固定画面");
  say("放大到3倍");
  assert.equal(say("放大一点").ok, false);
  near(f.snapshot().targetZoom!, 3);
});
test("undo restores automatic preference and does not toggle redo", () => {
  const { f, feed, say } = harness();
  feed(body(0.4));
  say("放大一点");
  feed(body(0.4));
  near(f.snapshot().subjectRatio!, 0.75);
  say("太大了，回到刚才");
  feed(body(0.4));
  near(f.snapshot().subjectRatio!, 0.65);
  assert.equal(f.snapshot().automatic, true);
  assert.equal(f.snapshot().canUndo, false);
  assert.equal(say("回到刚才").ok, false);
});
test("undo reverses mode changes and preserves the last successful adjustment after refusal", () => {
  const { f, feed, say } = harness();
  feed(body());
  say("固定画面");
  say("回到刚才");
  assert.equal(f.snapshot().automatic, true);
  say("恢复全身");
  say("放大到3倍");
  assert.equal(say("放大到4倍").ok, false);
  say("回到刚才");
  near(f.snapshot().zoom, 1);
  assert.equal(f.snapshot().automatic, false);
});
test("missing body queues intent and applies only after a stable full body returns", () => {
  const { f, feed, say } = harness();
  const result = say("放大一点");
  assert.match(result.message, /站稳后调整/);
  feed([]);
  assert.equal(f.snapshot().zoom, 1);
  say("再大一点");
  near(f.snapshot().targetSubjectRatio!, 0.8);
  feed(body(0.4));
  assert.ok(f.snapshot().subjectRatio! > 0.77);
  assert.equal(f.snapshot().automatic, true);
});
test("precise zoom waits for body and undo cancels the pending request", () => {
  const { f, feed, say } = harness();
  const result = say("放大到2倍");
  assert.match(result.message, /站稳后调整/);
  say("回到刚才");
  feed(body(0.25));
  near(f.snapshot().subjectRatio!, 0.65);
  const pending = harness();
  pending.say("放大到2倍");
  pending.feed(body(0.25));
  near(pending.f.snapshot().zoom, 2);
});
test("voice zoom during a squat waits for standing instead of enlarging the crouch", () => {
  const { f, feed, say } = harness();
  feed(body(0.5));
  const before = f.snapshot().targetZoom!;
  feed(body(0.3), 60, true);
  assert.match(say("放大一点").message, /站稳后调整/);
  feed(body(0.3), 100, true);
  assert.ok(f.snapshot().zoom <= before + 0.005);
  feed(body(0.5));
  near(f.snapshot().subjectRatio!, 0.75);
});
test("automatic limits retain complete body and report the actual result", () => {
  const { f, feed, say } = harness();
  feed(body(0.6));
  const result = say("放大到3倍");
  assert.match(result.message, /全身和动作空间/);
  const bounds = bodyBounds(body(0.6), "squat")!;
  assert.ok(f.snapshot().targetZoom! * (bounds.bottom - bounds.top) <= 1.001);
  feed(body(0.6));
  const capped = say("放大到3倍");
  assert.equal(capped.ok, false);
  const far = harness();
  far.feed(body(0.12));
  assert.match(far.say("放大一点").message, /3倍放大上限/);
});
test("restoring automatic framing resets the preferred size to two thirds", () => {
  const { f, feed, say } = harness();
  feed(body(0.4));
  say("放大一点");
  say("恢复自动取景");
  feed(body(0.4));
  near(f.snapshot().subjectRatio!, 0.65);
});
test("parameter validation refuses incomplete or mismatched zoom without changing state", () => {
  const { f } = harness();
  const before = f.snapshot();
  for (const c of [
    { type: "camera_view", action: "zoom_to" },
    { type: "camera_view", action: "zoom_by", factor: 0 },
    { type: "camera_view", action: "zoom_in", zoom: 2 },
    { type: "camera_view", action: "lock", adjustment: "step" },
  ] as CameraViewCommand[])
    assert.equal(f.command(c).ok, false);
  assert.deepEqual(f.snapshot(), before);
});
test("exact zoom routing does not execute questions, negatives or compound requests", () => {
  for (const text of [
    "不要放大到2倍",
    "为什么放大到2倍",
    "如果我动就放大到2倍",
    "明天再放大一倍",
    "放大到2倍再往左",
    "微调一下",
    "能放大到2倍吗？",
    "别回到刚才",
    "他说太小了",
  ])
    assert.equal(localVoiceCommand(text), null, text);
  assert.deepEqual(localVoiceCommand("放大到2倍"), {
    type: "camera_view",
    action: "zoom_to",
    zoom: 2,
  });
  assert.deepEqual(localVoiceCommand("放大一倍"), {
    type: "camera_view",
    action: "zoom_by",
    factor: 2,
  });
});
test("coach dispatch carries exact magnitude and returns receipt without affecting training", async () => {
  const { f, feed } = harness();
  feed(body(0.25));
  const engine = new SessionEngine();
  engine.counter.count = 4;
  const result = await coachTurn(
    "放大到2倍",
    engine.snapshot(),
    async (raw) => {
      const c = cameraCommandSchema.parse(raw);
      assert.equal(c.type, "camera_view");
      return { ...f.command(c as CameraViewCommand), state: engine.snapshot() };
    },
    async () => {
      throw Error("Exact command should not request model");
    },
  );
  assert.match(result.text, /2.0倍.*继续跟随/);
  near(f.snapshot().targetZoom!, 2);
  assert.equal(engine.counter.count, 4);
});
