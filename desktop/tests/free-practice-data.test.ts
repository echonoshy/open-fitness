import { test } from "node:test";
import assert from "node:assert/strict";
import { dataSchema } from "../src/core/data";
import {
  practiceMovements,
  updatePracticeMovements,
  DEFAULT_PRACTICE_MOVEMENTS,
} from "../src/core/free-practice";
import { mergeImportedData } from "../src/core/data-edits";
import type { Data } from "../src/platform";
const empty = (): Data => ({ settings: { voice: true }, records: [] });

test("existing data gets defaults without altering its training data", () => {
  const data = empty();
  assert.deepEqual(practiceMovements(data), DEFAULT_PRACTICE_MOVEMENTS);
  assert.equal(data.freePractice, undefined);
  assert.deepEqual(dataSchema.parse(data).records, []);
});
test("add/remove operations retain order, deduplicate, and preserve an explicitly empty list", () => {
  const old = empty();
  const added = updatePracticeMovements(old, (values) => [
    ...values,
    "dumbbell-lateral-raise",
    "push-up",
  ]);
  assert.equal(practiceMovements(added).length, 5);
  assert.equal(added.records, old.records);
  assert.equal(added.settings, old.settings);
  assert.deepEqual(
    practiceMovements(updatePracticeMovements(added, () => [])),
    [],
  );
  assert.deepEqual(practiceMovements(old), DEFAULT_PRACTICE_MOVEMENTS);
});
test("formal backup schema preserves movement list including empty list", () => {
  for (const movementSlugs of [[], ["front-plank", "dumbbell-lateral-raise"]]) {
    const data = { ...empty(), freePractice: { movementSlugs } };
    assert.deepEqual(
      dataSchema.parse(JSON.parse(JSON.stringify(data))).freePractice,
      data.freePractice,
    );
  }
});
test("import merges practice selections without overwriting settings or duplicating items", () => {
  const data = { ...empty(), freePractice: { movementSlugs: ["push-up"] } };
  const incoming = {
    records: [],
    freePractice: { movementSlugs: ["push-up", "front-plank"] },
  };
  const merged = mergeImportedData(data, incoming).data;
  assert.deepEqual(merged.freePractice?.movementSlugs, [
    "push-up",
    "front-plank",
  ]);
  assert.equal(merged.settings, data.settings);
  assert.deepEqual(
    mergeImportedData(merged, incoming).data.freePractice,
    merged.freePractice,
  );
  assert.deepEqual(
    mergeImportedData(merged, { records: [] }).data.freePractice,
    merged.freePractice,
  );
});
test("an explicitly empty backed-up list does not silently refill defaults", () => {
  const merged = mergeImportedData(empty(), {
    records: [],
    freePractice: { movementSlugs: [] },
  }).data;
  assert.deepEqual(practiceMovements(merged), []);
});

test("v5 upgrades and full backup imports preserve shortcut order independently of favorites, including an empty selection", () => {
  const v5 = { ...empty(), version: 5, freePractice: {movementSlugs: ["front-plank"]} };
  assert.equal(dataSchema.parse(v5).homeShortcuts, undefined);
  const saved = { ...v5, version: 6, homeShortcuts: ["barbell-curl", "push-up", "barbell-curl"] };
  const restored = mergeImportedData(empty(), dataSchema.parse(saved)).data;
  assert.deepEqual(restored.homeShortcuts, ["barbell-curl", "push-up"]);
  assert.deepEqual(restored.freePractice, v5.freePractice);
  assert.deepEqual(mergeImportedData({...restored, homeShortcuts: []}, saved).data.homeShortcuts, []);
  assert.deepEqual(mergeImportedData(empty(), {...saved, homeShortcuts: []}).data.homeShortcuts, []);
});
