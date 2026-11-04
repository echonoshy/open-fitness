import test from "node:test";
import assert from "node:assert/strict";
import {
  CameraFramer,
  bodyBounds,
  cameraTransform,
  cameraCommandSchema,
} from "../src/core/camera-framing";
import { localVoiceCommand } from "../src/core/voice-routing";
import { coachTurn, tools } from "../src/core/coach";
import { SessionEngine } from "../src/core/session";
import type { Point, Exercise } from "../src/core/engine";
function body(x = 0.5, y = 0): Point[] {
  const p = Array.from({ length: 33 }, () => ({
    x,
    y: 0.5 + y,
    z: 0,
    visibility: 0,
  }));
  for (const [i, dx, py] of [
    [0, 0, 0.24],
    [7, -0.02, 0.25],
    [8, 0.02, 0.25],
    [11, -0.045, 0.32],
    [12, 0.045, 0.32],
    [13, -0.08, 0.4],
    [14, 0.08, 0.4],
    [15, -0.1, 0.48],
    [16, 0.1, 0.48],
    [23, -0.035, 0.49],
    [24, 0.035, 0.49],
    [25, -0.035, 0.61],
    [26, 0.035, 0.61],
    [27, -0.035, 0.73],
    [28, 0.035, 0.73],
    [31, -0.05, 0.75],
    [32, 0.05, 0.75],
  ])
    p[i] = { x: x + dx, y: py + y, z: 0, visibility: 0.95 };
  return p;
}
function harness(exercise: Exercise = "squat") {
  const f = new CameraFramer();
  let t = 0;
  const step = (p: Point[], n = 1, training = true) => {
    let accepted = false;
    for (let i = 0; i < n; i++)
      accepted = f.update(p, (t += 0.04), { exercise, training, set: "one" });
    return accepted;
  };
  return { f, step };
}
test("automatic framing waits then gently crops a fully visible body", () => {
  const { f, step } = harness();
  const source = body();
  const before = structuredClone(source);
  step(source, 20);
  assert.equal(f.snapshot().zoom, 1);
  step(source, 150);
  assert.ok(Math.abs(f.snapshot().zoom * 0.51 - 0.65) < 0.015);
  assert.deepEqual(source, before);
});
test("small jitter and squat vertical movement do not steer the viewport", () => {
  const { f, step } = harness();
  step(body(), 250);
  const before = f.snapshot();
  for (let i = 0; i < 120; i++) {
    const p = body(0.5 + Math.sin(i) * 0.015);
    for (const n of [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24])
      p[n].y += 0.06 * (1 + Math.sin(i / 10));
    step(p);
  }
  const after = f.snapshot();
  assert.ok(Math.abs(after.x - before.x) < 0.002);
  assert.ok(Math.abs(after.y - before.y) < 0.003);
  assert.ok(after.zoom <= before.zoom + 0.001);
});
test("persistent lateral movement pans only within available source space", () => {
  const { f, step } = harness();
  step(body(), 250);
  for (let i = 1; i <= 50; i++) step(body(0.5 + i * 0.003));
  step(body(0.65), 180);
  const v = f.snapshot();
  assert.ok(v.x > 0.53);
  assert.ok(v.x <= 1 - 0.5 / v.zoom);
  assert.ok(v.zoom >= 1);
});
test("full body close to physical edges remains wide", () => {
  const { f, step } = harness();
  const p = body();
  p[0].y = 0.04;
  p[31].y = p[32].y = 0.96;
  step(p, 200);
  assert.equal(f.snapshot().zoom, 1);
  assert.equal(
    f.command({ type: "camera_view", action: "zoom_in", adjustment: "step" })
      .ok,
    true,
  );
  assert.equal(f.command("left").ok, true);
  assert.equal(f.snapshot().automatic, false);
});
test("missing limbs returns to complete view without blocking upper-body counting input", () => {
  const { f, step } = harness();
  step(body(), 200);
  const p = body();
  p[27].visibility = p[28].visibility = p[31].visibility = p[32].visibility = 0;
  assert.equal(bodyBounds(p, "curl"), null);
  step(p, 100);
  assert.ok(f.snapshot().zoom < 1.001);
  assert.equal(
    f.command({ type: "camera_view", action: "zoom_in", adjustment: "step" })
      .ok,
    true,
  );
  const arm = p.map((v) => ({ ...v, visibility: 0 }));
  for (const i of [11, 13, 15]) arm[i].visibility = 1;
  assert.equal(step(arm), true);
});
test("fixed and manually adjusted views remain fixed through movement and loss", () => {
  const { f, step } = harness();
  step(body(), 200);
  assert.equal(f.command("lock").ok, true);
  const before = f.snapshot();
  step(body(0.64), 90);
  step([], 100);
  const after = f.snapshot();
  assert.equal(after.zoom, before.zoom);
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.automatic, false);
  f.command("full");
  step(body(), 150);
  assert.equal(f.snapshot().zoom, 1);
  f.command("auto");
  step(body(), 200);
  assert.ok(f.snapshot().zoom > 1.25);
  f.command({ type: "camera_view", action: "zoom_out", adjustment: "step" });
  const manual = f.snapshot();
  step(body(), 200);
  assert.deepEqual(f.snapshot(), manual);
});
test("short occlusion holds, long occlusion widens, abrupt other person is rejected", () => {
  const { f, step } = harness();
  step(body(0.38), 200);
  const before = f.snapshot();
  step([], 10);
  assert.ok(Math.abs(f.snapshot().zoom - before.zoom) < 0.001);
  assert.equal(step(body(0.8), 150), false);
  assert.equal(f.snapshot().targetLost, true);
  assert.ok(f.snapshot().zoom < 1.001);
  assert.equal(step(body(0.38)), true);
  f.command("auto");
  assert.equal(step(body(0.8)), true);
});
test("overhead exercise reserves room above shoulders", () => {
  const p = body();
  assert.ok(bodyBounds(p, "shoulder_press")!.top < bodyBounds(p, "curl")!.top);
});
test("shared mirrored transform centers source point and never stretches aspect", () => {
  const t = cameraTransform({ zoom: 1.25, x: 0.6, y: 0.45 });
  assert.match(t, /translate\(12\.499/);
  assert.match(t, /scale\(-1.25, 1.25\)/);
});
test("camera schemas and exact voice commands reject guesses and negated questions", () => {
  assert.equal(
    cameraCommandSchema.safeParse({ type: "camera_view", action: "spin" })
      .success,
    false,
  );
  for (const text of [
    "不要放大画面",
    "能不能跟着我？",
    "如果我动了就跟着我",
    "明天开启摄像头",
    "为什么画面不跟着我",
  ])
    assert.equal(localVoiceCommand(text), null, text);
  assert.deepEqual(localVoiceCommand("帮我恢复自动取景。"), {
    type: "camera_view",
    action: "auto",
  });
  assert.deepEqual(localVoiceCommand("不要跟随"), {
    type: "camera_view",
    action: "lock",
  });
  assert.deepEqual(localVoiceCommand("关闭摄像头"), {
    type: "camera",
    enabled: false,
  });
  assert.ok(tools.some((t) => t.name === "camera_view"));
});
test("voice returns actual framing refusal and leaves workout untouched", async () => {
  const f = new CameraFramer(),
    e = new SessionEngine();
  e.cameraReady = true;
  e.dispatch({ type: "session", action: "start" });
  e.counter.count = 4;
  for (let i = 0; i < 20; i++)
    f.command({ type: "camera_view", action: "zoom_in", adjustment: "step" });
  const result = await coachTurn(
    "放大一点",
    e.snapshot(),
    async (raw) => {
      const c = cameraCommandSchema.parse(raw);
      assert.equal(c.type, "camera_view");
      return {
        ...f.command(c as Extract<typeof c, { type: "camera_view" }>),
        state: e.snapshot(),
      };
    },
    async () => {
      throw Error("Exact command must not call model");
    },
  );
  assert.equal(result.receipts[0].ok, false);
  assert.match(result.text, /3倍放大上限/);
  assert.equal(e.counter.count, 4);
  assert.equal(e.active, true);
});
test("model-routed natural framing command executes through real receipt", async () => {
  const f = new CameraFramer(),
    e = new SessionEngine();
  let rounds = 0;
  const result = await coachTurn(
    "镜头不要动了，保持在这里",
    e.snapshot(),
    async (raw) => {
      const c = cameraCommandSchema.parse(raw);
      assert.equal(c.type, "camera_view");
      return {
        ...f.command(c as Extract<typeof c, { type: "camera_view" }>),
        state: e.snapshot(),
      };
    },
    async () =>
      ++rounds === 1
        ? {
            output: [
              {
                type: "function_call",
                call_id: "view",
                name: "camera_view",
                arguments: JSON.stringify({ action: "lock" }),
              },
            ],
          }
        : { output: [] },
  );
  assert.equal(f.snapshot().automatic, false);
  assert.equal(result.receipts[0].ok, true);
  assert.match(result.text, /固定/);
});

test("hips appearing or disappearing cannot trigger a false person switch", () => {
  const { f, step } = harness();
  const p = body();
  step(p, 200);
  const partial = structuredClone(p);
  partial[23].visibility = partial[24].visibility = 0;
  for (let i = 0; i < 40; i++) assert.equal(step(i % 2 ? partial : p), true);
  assert.equal(f.snapshot().targetLost, false);
});

function atDistance(height: number) {
  return body().map((p) => ({
    ...p,
    x: 0.5 + ((p.x - 0.5) * height) / 0.51,
    y: 0.5 + ((p.y - 0.495) * height) / 0.51,
  }));
}

test("distant subject approaches two-thirds occupancy instead of a 1.35x ceiling", () => {
  const { f, step } = harness();
  step(atDistance(0.25), 300);
  assert.ok(f.snapshot().zoom > 2.5);
  assert.ok(Math.abs(f.snapshot().zoom * 0.25 - 0.65) < 0.02);
  assert.equal(f.snapshot().framingReason, "tracking");
});

test("same set adapts both nearer and farther after a stable relocation", () => {
  const { f, step } = harness();
  step(atDistance(0.25), 300);
  const distant = f.snapshot().zoom;
  for (let i = 1; i <= 50; i++) step(atDistance(0.25 + i * 0.007));
  step(atDistance(0.6), 200);
  assert.ok(Math.abs(f.snapshot().zoom * 0.6 - 0.65) < 0.02);
  assert.ok(f.snapshot().zoom < distant);
  for (let i = 1; i <= 50; i++) step(atDistance(0.6 - i * 0.007));
  step(atDistance(0.25), 250);
  assert.ok(
    f.snapshot().zoom > 2.5,
    "old near-person envelope must expire after settling",
  );
});

test("turning sideways and hiding the far hand preserves the same body scale", () => {
  const { f, step } = harness();
  const front = atDistance(0.25);
  step(front, 300);
  const before = f.snapshot().zoom;
  const side = front.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.4 }));
  side[16].visibility = 0.1;
  assert.ok(bodyBounds(side, "squat"));
  step(side, 150);
  assert.ok(Math.abs(f.snapshot().zoom - before) < 0.002);
  step(front, 150);
  assert.ok(Math.abs(f.snapshot().zoom - before) < 0.002);
});

test("initial side view can acquire a distant person with an occluded far hand", () => {
  const { f, step } = harness();
  const p = atDistance(0.25);
  p[16].visibility = 0.1;
  step(p, 300, false);
  assert.ok(f.snapshot().zoom > 2.5);
});

test("readiness fluctuations do not restart the framing stability wait", () => {
  const { f, step } = harness();
  const p = atDistance(0.25);
  for (let i = 0; i < 300; i++) step(p, 1, i % 2 === 0);
  assert.ok(f.snapshot().zoom > 2.5);
});

test("a crouch during a repetition cannot trigger zooming in", () => {
  const f = new CameraFramer();
  let t = 0;
  const feed = (p: Point[], frames: number, moving: boolean) => {
    for (let i = 0; i < frames; i++)
      f.update(p, (t += 0.04), {
        exercise: "squat",
        set: "one",
        training: true,
        moving,
      });
  };
  feed(atDistance(0.5), 250, false);
  const before = f.snapshot().zoom;
  feed(atDistance(0.3), 200, true);
  assert.ok(f.snapshot().zoom <= before + 0.002);
  assert.equal(f.snapshot().framingReason, "motion_hold");
});

test("brief missing feet hold framing, sustained loss widens, stable recovery reframes", () => {
  const { f, step } = harness();
  const p = atDistance(0.25);
  step(p, 300);
  const before = f.snapshot().zoom;
  const missing = structuredClone(p);
  for (const i of [27, 28, 31, 32]) missing[i].visibility = 0;
  step(missing, 25);
  assert.ok(Math.abs(f.snapshot().zoom - before) < 0.002);
  step(missing, 150);
  assert.equal(f.snapshot().zoom, 1);
  assert.match(f.snapshot().hint, /头部和脚部/);
  step(p, 300);
  assert.ok(f.snapshot().zoom > 2.5);
});

test("source view and maximum zoom limits explain unreachable occupancy", () => {
  const close = harness();
  close.step(atDistance(0.85), 250);
  assert.equal(close.f.snapshot().zoom, 1);
  assert.equal(close.f.snapshot().framingReason, "source_limit");
  assert.match(close.f.snapshot().hint, /后退/);
  const far = harness();
  far.step(atDistance(0.12), 350);
  assert.equal(far.f.snapshot().zoom, 3);
  assert.equal(far.f.snapshot().framingReason, "zoom_limit");
  assert.match(far.f.snapshot().hint, /靠近/);
});

test("manual frame stays fixed across distance changes until explicitly restored", () => {
  const { f, step } = harness();
  step(atDistance(0.6), 250);
  f.command("lock");
  const locked = f.snapshot().zoom;
  step(atDistance(0.25), 300);
  assert.equal(f.snapshot().zoom, locked);
  f.command("auto");
  step(atDistance(0.25), 300);
  assert.ok(f.snapshot().zoom > 2.5);
});
