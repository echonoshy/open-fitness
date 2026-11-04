import test from "node:test";
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dataSchema } from "../src/core/data";
import { moveToTrash, restoreTrash } from "../src/core/trash";
import {
  mergeImportedData,
  saveNamedPlan,
  saveProfileFact,
} from "../src/core/data-edits";
import { parseSelectedFiles, readLegacyDatabase } from "../src/web-files";
import {
  decodeBytes,
  encodeBytes,
  readWebResponse,
} from "../src/core/web-protocol";
import { searchLibrary } from "../src/core/knowledge";
import type { Data } from "../src/platform";

const empty = (): Data => ({ settings: { voice: false }, records: [] });
function fixture() {
  const data = saveNamedPlan(
    saveProfileFact(empty(), {
      category: "goals",
      key: "训练目标",
      value: "每周三次",
    }),
    "计划",
    [{ exercise: "squat", sets: 3, target: 12, rest: 60, load: 0 }],
  );
  data.references = {
    squat: { trajectory: [170, 90, 170], score: 90, recorded: "2026-10-21" },
  };
  return data;
}
test("deleted plans, facts and references survive reload and can all be restored", () => {
  const original = fixture();
  let data = moveToTrash(original, { kind: "plan", id: original.plans![0].id });
  data = moveToTrash(data, {
    kind: "profile",
    category: "goals",
    key: "训练目标",
  });
  data = moveToTrash(data, { kind: "reference", exercise: "squat" });
  assert.equal(data.profile?.length, 0);
  assert.equal(data.plans?.length, 0);
  assert.equal(data.references?.squat, undefined);
  data = {
    ...dataSchema.parse(JSON.parse(JSON.stringify(data))),
    settings: data.settings,
  };
  for (const entry of data.trash!) data = restoreTrash(data, entry.id);
  assert.deepEqual(data.profile, original.profile);
  assert.deepEqual(data.plans, original.plans);
  assert.deepEqual(data.references, original.references);
  assert.equal(data.trash?.length, 0);
});
test("restoring never overwrites content created after deletion", () => {
  let data = moveToTrash(fixture(), {
    kind: "profile",
    category: "goals",
    key: "训练目标",
  });
  data = saveProfileFact(data, {
    category: "goals",
    key: "训练目标",
    value: "新资料",
  });
  assert.throws(() => restoreTrash(data, data.trash![0].id), /同名资料/);
  assert.equal(data.profile![0].value, "新资料");
  assert.equal(data.trash?.length, 1);
});
test("complete backup migration preserves recoverable deleted data without duplicates", () => {
  const source = moveToTrash(fixture(), {
    kind: "reference",
    exercise: "squat",
  });
  const copy = mergeImportedData(empty(), source).data;
  const twice = mergeImportedData(copy, source).data;
  assert.equal(twice.trash?.length, 1);
  assert.deepEqual(
    restoreTrash(twice, twice.trash![0].id).references,
    fixture().references,
  );
});
test("browser import reads JSON and CSV locally and rejects oversized or ambiguous input", async () => {
  const data = JSON.stringify(fixture());
  const selected = await parseSelectedFiles("backup", [
    new File([data], "backup.json"),
  ]);
  assert.equal(
    dataSchema.parse(JSON.parse(selected[0].text!)).plans?.length,
    1,
  );
  assert.equal(
    (
      await parseSelectedFiles("csv", [new File(["a,b\n1,2"], "training.csv")])
    )[0].text,
    "a,b\n1,2",
  );
  await assert.rejects(
    parseSelectedFiles("backup", [
      new File([new Uint8Array(20_000_001)], "huge.json"),
    ]),
    /20 MB/,
  );
  await assert.rejects(
    parseSelectedFiles("legacy", [
      new File(["[]"], "workout_log.json"),
      new File(["[]"], "workout_log.json"),
    ]),
    /同名/,
  );
});
test("legacy SQLite facts are read locally with Unicode intact", async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(
    "CREATE TABLE facts(category TEXT,key TEXT,value TEXT,updated_at TEXT)",
  );
  db.run("INSERT INTO facts VALUES (?,?,?,?)", [
    "goals",
    "主要目标",
    "每周三次",
    "2026-10-21",
  ]);
  const facts = await readLegacyDatabase(db.export(), SQL);
  db.close();
  assert.equal(facts[0].key, "主要目标");
  assert.equal(facts[0].value, "每周三次");
});
function response(lines: unknown[], split = false) {
  const bytes = new TextEncoder().encode(
    lines.map((x) => JSON.stringify(x)).join("\n") + "\n",
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        if (split)
          for (let i = 0; i < bytes.length; i += 2)
            controller.enqueue(bytes.slice(i, i + 2));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}
test("Web transport preserves fragmented Chinese text and binary audio", async () => {
  const bytes = new Uint8Array([0, 128, 255, 9, 3]);
  const chunks: any[] = [];
  const result = await readWebResponse(
    response(
      [
        { type: "chunk", chunk: { type: "text", delta: "训练开始" } },
        {
          type: "chunk",
          chunk: {
            type: "audio",
            audio: encodeBytes(bytes),
            sampleRate: 48000,
          },
        },
        { type: "result", result: { completed: true } },
      ],
      true,
    ),
    undefined,
    (chunk) => chunks.push(chunk),
  );
  assert.equal(chunks[0].delta, "训练开始");
  assert.deepEqual(chunks[1].audio, bytes);
  assert.deepEqual(decodeBytes(encodeBytes(bytes)), bytes);
  assert.equal(result.completed, true);
});
test("Web transport reports service failures and truncated streams instead of success", async () => {
  await assert.rejects(
    readWebResponse(response([{ type: "error", message: "语音服务不可用" }])),
    /不可用/,
  );
  await assert.rejects(
    readWebResponse(
      response([{ type: "chunk", chunk: { type: "text", delta: "未完成" } }]),
    ),
    /提前结束/,
  );
  await assert.rejects(readWebResponse(new Response("<html></html>")), /后端/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    readWebResponse(response([{ type: "result", result: {} }]), abort.signal),
  );
});
test("Chinese catalog remains searchable by English original names", () => {
  const items = [
    {
      id: "squat",
      name: "杠铃深蹲",
      originalName: "Barbell Squat",
      instructions: ["双脚站稳。"],
    },
  ];
  assert.equal(searchLibrary(items, "深蹲")[0].id, "squat");
  assert.equal(searchLibrary(items, "Barbell Squat")[0].id, "squat");
});

test("Chinese catalog covers every source exercise without dropping instruction steps", () => {
  const source = readFileSync(
    new URL("../../data/exercises.json", import.meta.url),
    "utf8",
  );
  const catalog = JSON.parse(source).exercises;
  const localized = JSON.parse(
    readFileSync(
      new URL("../../data/exercises.zh-CN.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    localized.sourceSha256,
    createHash("sha256").update(source).digest("hex"),
  );
  assert.equal(Object.keys(localized.exercises).length, catalog.length);
  for (const item of catalog) {
    const translation = localized.exercises[item.id];
    assert.match(translation.name, /[\u4e00-\u9fff]/, item.id);
    assert.equal(
      translation.instructions.length,
      item.instructions.length,
      item.id,
    );
    item.instructions.forEach((step: string, index: number) => {
      if (step.trim())
        assert.match(
          translation.instructions[index],
          /[\u4e00-\u9fff]/,
          `${item.id} step ${index}`,
        );
    });
  }
});
