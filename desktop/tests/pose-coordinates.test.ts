import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { angle, bodyAngles, type Point } from "../src/core/engine";
import { SessionEngine } from "../src/core/session";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/upstream-pose-angles.json", import.meta.url),
    "utf8",
  ),
);
for (const fixture of fixtures.cases) {
  test(`upstream Python normalized coordinates: ${fixture.name}`, () => {
    const [a, b, c] = fixture.points.map(([x, y, z]: number[]) => ({
      x,
      y,
      z,
    }));
    assert.ok(Math.abs(angle(a, b, c) - fixture.expected) < 1e-4);
  });
}

function leg(degrees: number): Point[] {
  const radians = (degrees * Math.PI) / 180;
  const points: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  points[23] = {
    x: 0.5,
    y: 0.3,
    z: 0,
    visibility: 1,
    world: { x: 0, y: -0.4, z: 0 },
  };
  points[11] = { x: 0.5, y: 0.12, z: 0, visibility: 1 };
  points[25] = {
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
    world: { x: 0, y: 0, z: 0.1 },
  };
  points[27] = {
    x: 0.5 + 0.2 * Math.sin(radians),
    y: 0.5 - 0.2 * Math.cos(radians),
    z: 0,
    visibility: 1,
    world: { x: 0, y: 0.4, z: 0 },
  };
  return points;
}

test("a straight image-space leg is not replaced by a bent world-space estimate", () => {
  const points = leg(180);
  const pose = bodyAngles(points, "squat");
  assert.equal(pose.visible, true);
  assert.equal(pose.angles.knee, 180);
  assert.ok(
    Math.abs(
      angle(points[23].world!, points[25].world!, points[27].world!) - 151.9275,
    ) < 1e-4,
  );
});

test("three normalized squat cycles count through smoothing despite conflicting world data", () => {
  const engine = new SessionEngine();
  engine.cameraReady = true;
  engine.dispatch({ type: "session", action: "start" });
  let time = 10;
  const frame = (degrees: number, frames = 8) => {
    for (let i = 0; i < frames; i++) engine.frame(leg(degrees), (time += 0.05));
  };
  frame(175, 20);
  for (let rep = 1; rep <= 3; rep++) {
    for (const degrees of [140, 110, 80, 95, 120, 145]) frame(degrees);
    assert.equal(engine.counter.count, rep - 1);
    frame(175, 16);
    assert.equal(engine.counter.count, rep);
    assert.equal(engine.counter.phase, "IDLE");
  }
  assert.equal(engine.rows.length, 3);
  assert.ok(engine.rows.every((row) => row.full_depth));
});
