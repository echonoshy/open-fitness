import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeImportedData,
  saveNamedPlan,
  saveProfileFact,
} from "../src/core/data-edits";
import { dataSchema } from "../src/core/data";
import { moveToTrash, restoreTrash } from "../src/core/trash";
import type { Data } from "../src/platform";

const empty = (): Data => ({ settings: { voice: false }, records: [] });
const block = {
  exercise: "squat" as const,
  sets: 3,
  target: 12,
  rest: 60,
  load: 0,
};
const original = () =>
  saveProfileFact(empty(), {
    category: "goals",
    key: "目标",
    value: "每周训练",
  });

test("editing a profile name replaces its original identity and survives serialization", () => {
  const data = original();
  const updated = saveProfileFact(
    data,
    { category: "goals", key: " 新目标 ", value: " 三次 " },
    { category: "goals", key: "目标" },
  );
  const restored = dataSchema.parse(JSON.parse(JSON.stringify(updated)));
  assert.equal(restored.profile?.length, 1);
  assert.equal(restored.profile?.[0].key, "新目标");
  assert.equal(restored.profile?.[0].value, "三次");
  assert.equal(data.profile?.[0].key, "目标");
});

test("whitespace in a profile name does not create duplicate keys", () => {
  const data = saveProfileFact(original(), {
    category: "goals",
    key: " 目标 ",
    value: "更新内容",
  });
  assert.equal(data.profile?.length, 1);
  assert.equal(data.profile?.[0].value, "更新内容");
});

test("renaming cannot silently overwrite another profile entry", () => {
  const data = saveProfileFact(original(), {
    category: "goals",
    key: "另一目标",
    value: "保留",
  });
  assert.throws(
    () =>
      saveProfileFact(
        data,
        { category: "goals", key: "另一目标", value: "新值" },
        { category: "goals", key: "目标" },
      ),
    /同名资料/,
  );
  assert.equal(data.profile?.length, 2);
});

test("profile names remain independent across categories", () => {
  const data = saveProfileFact(original(), {
    category: "preferences",
    key: "目标",
    value: "另一个分类",
  });
  assert.equal(data.profile?.length, 2);
});

test("saving a named plan preserves its ID and backup import does not resurrect an older duplicate", () => {
  const first = saveNamedPlan(empty(), "计划", [block]);
  const updated = saveNamedPlan(first, " 计划 ", [{ ...block, target: 15 }]);
  assert.equal(updated.plans?.[0].id, first.plans?.[0].id);
  assert.equal(first.plans?.[0].blocks[0].target, 12);
  const restored = mergeImportedData(updated, first).data;
  assert.equal(restored.plans?.length, 1);
  assert.equal(restored.plans?.[0].blocks[0].target, 15);
});

test("invalid plan names and out-of-range targets are rejected", () => {
  assert.throws(() => saveNamedPlan(empty(), " ", [block]));
  assert.throws(() =>
    saveNamedPlan(empty(), "计划", [{ ...block, target: 101 }]),
  );
});

test("editing a legacy plan preserves its ID, changed blocks and chosen icon through restore", () => {
  const plan = { id: "legacy", name: "旧计划", blocks: [block] };
  const data = { ...empty(), plans: [plan] };
  const edit = { editingId: plan.id, icon: "biceps", color: "teal" } as const;
  const updated = saveNamedPlan(data, " 周末训练 ", [{ ...block, sets: 4 }], edit);
  const deleted = moveToTrash(updated, { kind: "plan", id: plan.id });
  const restored = restoreTrash(deleted, deleted.trash![0].id);
  assert.deepEqual(dataSchema.parse(restored).plans, [{
    id: plan.id, name: "周末训练", blocks: [{ ...block, sets: 4 }], icon: "biceps", color: "teal",
  }]);
  assert.throws(() => saveNamedPlan(deleted, "周末训练", [block], edit), /已删除/);
  assert.equal(data.plans[0].name, "旧计划");
});

test("creating or renaming a plan cannot overwrite another plan with the same name", () => {
  const create = { editingId: null, icon: "calendar" as const };
  const first = saveNamedPlan(empty(), "周一", [block], create);
  const second = saveNamedPlan(first, "周二", [block], create);
  assert.throws(() => saveNamedPlan(second, "周二", [block], create), /同名计划/);
  assert.throws(() => saveNamedPlan(second, "周二", [block], {
    editingId: first.plans[0].id, icon: "activity",
  }), /同名计划/);
});

test("profile-only backups report actual additions and reimport is idempotent", () => {
  const backup = saveNamedPlan(original(), "计划", [block]);
  backup.references = {
    squat: { trajectory: [175, 80, 175], score: 90, recorded: "2026-10-21" },
  };
  const merged = mergeImportedData(empty(), backup);
  assert.match(
    merged.message,
    /新增 0 组记录、1 条资料、1 份计划、1 个参考动作/,
  );
  const repeated = mergeImportedData(merged.data, backup);
  assert.deepEqual(repeated.data, merged.data);
  assert.match(
    repeated.message,
    /新增 0 组记录、0 条资料、0 份计划、0 个参考动作/,
  );
});
