import assert from "node:assert/strict";
import test from "node:test";
import { dataSchema } from "../src/core/data";
import { createUiLocale } from "../src/i18n";

test("existing profiles default to Chinese and save an explicit language", () => {
  const old = dataSchema.parse({ settings: {}, records: [] });
  assert.equal(
    createUiLocale(old.settings.language ?? "zh-CN").uiText("训练"),
    "训练",
  );
  const data = dataSchema.parse({
    ...old,
    settings: { ...old.settings, language: "en" },
  });
  assert.equal(data.settings.language, "en");
  assert.equal(createUiLocale("en").uiText("训练"), "Train");
});

test("localized notices and labels preserve user-supplied names", () => {
  const { uiText, message } = createUiLocale("en");
  assert.equal(uiText("自动计数 / 姿态计时 · 12"), "Camera-tracked · 12");
  assert.equal(uiText("设置"), "Settings");
  assert.equal(
    message("编辑计划名称与图标，{0}", "设置"),
    "Edit the name and icon for 设置",
  );
  assert.equal(message("遗忘{0}", "我的目标"), "Forget 我的目标");
});
