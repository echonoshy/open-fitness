import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog as items } from "./fixtures/movement-catalog";
import { resolvePracticeCommand as resolve } from "../src/components/free-practice/voice-commands";

test("pause and resume are explicit, polite speech and punctuation accepted", () => {
  for (const text of ["暂停", "暂停一下。", "请帮我暂停跟练", "先停一下！"])
    assert.equal(resolve(text, items).kind, "pause", text);
  for (const text of ["继续", "继续练", "请继续播放。", "恢复跟练"])
    assert.equal(resolve(text, items).kind, "resume", text);
});
test("negations, questions, incidental mentions and compound commands do not trigger controls", () => {
  for (const text of [
    "不要暂停",
    "暂停是什么意思",
    "他刚才说继续",
    "暂停然后继续",
    "不要换成深蹲",
    "换成什么动作",
    "换成深蹲吗",
    "今天练得真好",
    "选第九十九个",
  ])
    assert.equal(resolve(text, items).kind, "unknown", text);
});
test("all catalog names remain reachable without a counting definition", () => {
  for (const item of items) {
    const command = resolve(`换成${item.name}`, items);
    assert.ok(
      command.kind === "movement" || command.kind === "search",
      item.name,
    );
    if (command.kind === "movement")
      assert.equal(command.item.slug, item.slug, item.name);
    else
      assert.ok(
        command.matches.some((match) => match.slug === item.slug),
        item.name,
      );
  }
});
test("common aliases select their specific default movements", () => {
  for (const [name, slug] of [
    ["深蹲", "bodyweight-squat"],
    ["平板支撑", "front-plank"],
    ["哑铃侧平举", "dumbbell-lateral-raise"],
  ]) {
    const command = resolve(`换成${name}`, items);
    assert.equal(command.kind, "movement");
    if (command.kind === "movement") assert.equal(command.item.slug, slug);
  }
});
test("ambiguous names open choices instead of selecting an arbitrary match", () => {
  const command = resolve("换成侧平举", items);
  assert.equal(command.kind, "search");
  if (command.kind === "search") {
    assert.ok(command.matches.length > 1);
    assert.deepEqual(resolve("第二个", items, command.matches), {
      kind: "movement",
      item: command.matches[1],
    });
    assert.deepEqual(resolve("选择第1个动作", items, command.matches), {
      kind: "movement",
      item: command.matches[0],
    });
  }
});
test("picker accepts bare names and cancellation only while open", () => {
  assert.equal(resolve("俯卧撑", items).kind, "unknown");
  assert.equal(resolve("俯卧撑", items, items).kind, "movement");
  assert.equal(resolve("取消", items).kind, "unknown");
  assert.equal(resolve("不换了", items, items).kind, "cancel");
  assert.equal(resolve("切换动作", items).kind, "picker");
  assert.equal(resolve("下一个动作", items).kind, "next");
});
test("missing names return a searchable empty result", () => {
  assert.deepEqual(resolve("换成不存在的动作", items), { kind: "unknown" });
  assert.deepEqual(resolve("换成超级飞跃", items), {
    kind: "search",
    query: "超级飞跃",
    matches: [],
  });
});
