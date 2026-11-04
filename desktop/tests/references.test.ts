import test from "node:test";
import assert from "node:assert/strict";
import type { Data } from "../src/platform";
import type { Rep } from "../src/core/engine";
import {
  referenceCandidates,
  saveReferenceFromRecord,
} from "../src/core/references";
import { dataSchema } from "../src/core/data";
import { moveToTrash, restoreTrash } from "../src/core/trash";
import { SessionEngine } from "../src/core/session";

const rep = (trajectory?: number[]): Rep => ({
  count: 1,
  duration: 3,
  eccentric_s: 2,
  concentric_s: 1,
  min_angle: 80,
  full_depth: true,
  faults: [],
  score: 90,
  trajectory,
});
const sample = (): Data => ({
  settings: { voice: false },
  records: [
    {
      id: "older",
      exercise: "squat",
      startedAt: "2026-10-20T10:00:00Z",
      duration: 12,
      reps: [rep(), rep([160, 80, 160]), rep([160])],
      holdSeconds: 0,
      load: 0,
      goal: 3,
    },
    {
      id: "newer",
      exercise: "curl",
      startedAt: "2026-10-21T10:00:00Z",
      duration: 10,
      reps: [rep([150, 60, 150])],
      holdSeconds: 0,
      load: 5,
      goal: 1,
    },
    {
      id: "hold",
      exercise: "plank",
      startedAt: "2026-10-22T10:00:00Z",
      duration: 30,
      reps: [],
      holdSeconds: 30,
      load: 0,
      goal: 30,
    },
  ],
});

test("reference candidates exclude missing/invalid trajectories and preserve actual rep indices", () => {
  const data = sample();
  data.records[0].reps.push(rep([160, NaN, 160]), rep(Array(101).fill(90)));
  assert.deepEqual(
    referenceCandidates(data.records).map((c) => [c.record.id, c.index]),
    [
      ["newer", 0],
      ["older", 1],
    ],
  );
  assert.deepEqual(
    referenceCandidates(data.records, "squat").map((c) => c.index),
    [1],
  );
  assert.equal(data.records[0].id, "older");
});

test("setting and replacing references preserves other actions and persists the source", () => {
  const source = sample();
  const first = saveReferenceFromRecord(
    source,
    "newer",
    0,
    "2026-10-22T11:00:00Z",
  );
  const second = saveReferenceFromRecord(first, "older", 1);
  assert.equal(source.references, undefined);
  assert.deepEqual(second.references?.curl, first.references?.curl);
  const restored = dataSchema.parse(JSON.parse(JSON.stringify(second)));
  assert.equal(restored.references?.squat?.recordId, "older");
  assert.equal(restored.references?.squat?.repIndex, 1);
  assert.equal(
    restored.references?.squat?.startedAt,
    source.records[0].startedAt,
  );
  const newerSample = {
    ...second,
    records: [
      ...second.records,
      { ...second.records[0], id: "replacement", reps: [rep([160, 90, 160])] },
    ],
  };
  const replacement = saveReferenceFromRecord(newerSample, "replacement", 0);
  assert.deepEqual(replacement.references?.squat?.trajectory, [160, 90, 160]);
  assert.deepEqual(replacement.references?.curl, first.references?.curl);
  assert.deepEqual(second.references?.squat?.trajectory, [160, 80, 160]);
});

test("stale records and unavailable repetitions cannot replace an existing reference", () => {
  const data = saveReferenceFromRecord(sample(), "older", 1);
  const original = JSON.stringify(data);
  for (const [id, index] of [
    ["removed", 0],
    ["older", 0],
    ["older", 2],
    ["older", -1],
    ["older", 1.5],
    ["hold", 0],
  ] as const)
    assert.throws(
      () => saveReferenceFromRecord(data, id, index),
      /不存在|没有可用/,
    );
  assert.equal(JSON.stringify(data), original);
});

test("reference source survives trash, reload and restore, and remains usable by the engine", () => {
  const data = saveReferenceFromRecord(sample(), "older", 1);
  const removed = moveToTrash(data, { kind: "reference", exercise: "squat" });
  const restored = restoreTrash(
    dataSchema.parse(JSON.parse(JSON.stringify(removed))) as Data,
    removed.trash![0].id,
  );
  assert.deepEqual(restored.references, data.references);
  const engine = new SessionEngine();
  engine.references = restored.references!;
  engine.trajectory = [160, 80, 160];
  const next = rep();
  engine.acceptRep(next);
  assert.equal(next.similarity, 100);
  assert.equal(next.score, 90);
  assert.equal(engine.goal, 12);
});
