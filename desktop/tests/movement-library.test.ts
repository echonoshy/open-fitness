import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  filterMovements,
  primaryMovementSlugs,
  movementEquipment,
  movementMuscles,
  movementLevels,
  type Movement,
} from "../src/core/movement-library";
import { EXERCISES } from "../src/core/engine";

const entry = (
  slug: string,
  name: string,
  equipment: string[],
  muscles: string[],
  extra: Partial<Movement> = {},
): Movement => ({
  slug,
  name,
  originalName: slug.replaceAll("-", " "),
  equipment,
  primaryMuscles: muscles,
  secondaryMuscles: [],
  level: "beginner",
  description: "动作介绍。",
  instructions: ["准备姿势", "执行动作", "控制节奏", "还原姿势"],
  video: `./movekit-library/hd/${slug}.mp4`,
  poster: `./movekit-library/hd/${slug}.webp`,
  durationSeconds: 7,
  ...extra,
});
const sample = [
  entry("dumbbell-bench-press", "哑铃卧推", ["Dumbbell", "Bench"], ["Chest"], {
    secondaryMuscles: ["Triceps"],
  }),
  entry("barbell-bench-press", "杠铃卧推", ["Barbell"], ["Chest"], {
    trainingExercise: "bench",
    level: "intermediate",
  }),
  entry("dumbbell-curl", "哑铃弯举", ["Dumbbell"], ["Biceps"], {
    trainingExercise: "curl",
  }),
];

test("visual catalogue search combines terms and understands Chinese and English names", () => {
  assert.deepEqual(
    filterMovements(sample, { query: "哑铃 卧推" }).map((x) => x.slug),
    ["dumbbell-bench-press"],
  );
  assert.deepEqual(
    filterMovements(sample, { query: "DUMBBELL bench-press" }).map(
      (x) => x.slug,
    ),
    ["dumbbell-bench-press"],
  );
  assert.equal(filterMovements(sample, { query: "不存在的动作" }).length, 0);
});

test("filters include all required equipment and auxiliary muscles, and distinguish supported training", () => {
  assert.equal(
    filterMovements(sample, { query: "肱三头肌" })[0].slug,
    "dumbbell-bench-press",
  );
  assert.equal(
    filterMovements(sample, {
      equipment: "Dumbbell",
      muscle: "Chest",
      level: "intermediate",
    }).length,
    0,
  );
  assert.equal(
    filterMovements(sample, { equipment: "Bench", muscle: "Triceps" })[0].slug,
    "dumbbell-bench-press",
  );
  assert.equal(
    filterMovements(sample, { trainable: true, level: "intermediate" })[0].slug,
    "barbell-bench-press",
  );
  assert.equal(
    filterMovements(sample, { trainable: true, query: "哑铃 卧推" }).length,
    1,
  );
  assert.equal(filterMovements(sample, {}).length, sample.length);
});

test("typed searches tolerate a single typo within a longer name and keep all other filters", () => {
  const plain = entry(
    "bulgarian-split-squat",
    "保加利亚分腿蹲",
    ["Bodyweight"],
    ["Glutes"],
  );
  const loaded = entry(
    "dumbbell-bulgarian-split-squat",
    "哑铃保加利亚分腿蹲",
    ["Dumbbell"],
    ["Glutes"],
    { level: "intermediate" },
  );
  const catalog = [...sample, plain, loaded];
  for (const query of [
    "宝加利亚",
    "保利亚",
    "保加加利亚",
    "保利加亚",
    "bulgarain",
  ]) {
    assert.deepEqual(
      filterMovements(catalog, { query }),
      [plain, loaded],
      query,
    );
  }
  assert.deepEqual(filterMovements(catalog, { query: "宝加利亚 哑铃" }), [
    loaded,
  ]);
  assert.deepEqual(
    filterMovements(catalog, { query: "宝加利亚", level: "beginner" }),
    [plain],
  );
  assert.deepEqual(
    filterMovements(catalog, { query: "宝加利亚", equipment: "Barbell" }),
    [],
  );
  assert.deepEqual(filterMovements(catalog, { query: "宝加" }), []);
  assert.deepEqual(filterMovements(catalog, { query: "宝咖利亚" }), []);
  // An exact result takes precedence over nearby terms elsewhere in the catalogue.
  assert.deepEqual(filterMovements(sample, { query: "杠铃卧推" }), [sample[1]]);
});

test("every MoveKit entry has a unique slug, Chinese title, and known filter labels", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../../data/movekit-library.json", import.meta.url),
      "utf8",
    ),
  );
  const translation = JSON.parse(
    await readFile(
      new URL("../../data/movekit-library.zh-CN.json", import.meta.url),
      "utf8",
    ),
  );
  const slugs = source.exercises.map((x: { slug: string }) => x.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(slugs.length, Object.keys(translation.names).length);
  for (const item of source.exercises) {
    assert.match(translation.names[item.slug], /[\u4e00-\u9fff]/);
    assert.ok(
      item.videoWatermarkedUrl.includes("video-watermarked"),
      item.slug,
    );
    assert.ok(item.posterImageUrl.startsWith("https://"), item.slug);
    assert.ok(item.videoPreviewUrl.startsWith("https://"), item.slug);
    assert.ok(movementLevels[item.difficulty], item.slug);
    item.equipment.forEach((value: string) =>
      assert.ok(movementEquipment[value], value),
    );
    [...item.primaryMuscles, ...item.secondaryMuscles].forEach(
      (value: string) => assert.ok(movementMuscles[value], value),
    );
  }
  assert.deepEqual(
    Object.keys(primaryMovementSlugs).sort(),
    Object.keys(EXERCISES).sort(),
  );
  for (const slug of Object.values(primaryMovementSlugs))
    assert.ok(slugs.includes(slug), slug);
  for (const [slug, value] of Object.entries(
    translation.classifications ?? {},
  )) {
    assert.ok(slugs.includes(slug), slug);
    const classification = value as {
      primaryMuscles: string[];
      secondaryMuscles: string[];
    };
    assert.ok(classification.primaryMuscles.length > 0, slug);
    const muscles = [
      ...classification.primaryMuscles,
      ...classification.secondaryMuscles,
    ];
    assert.equal(new Set(muscles).size, muscles.length, slug);
    muscles.forEach((muscle) => assert.ok(movementMuscles[muscle], muscle));
  }
});

test("every catalogue movement has its own Chinese introduction and ordered technique instructions", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../../data/movekit-library.json", import.meta.url),
      "utf8",
    ),
  );
  const { movements } = JSON.parse(
    await readFile(
      new URL(
        "../../data/movekit-library.instructions.zh-CN.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(movements).sort(),
    source.exercises.map((x: { slug: string }) => x.slug).sort(),
  );
  const descriptions = new Set<string>();
  for (const { slug } of source.exercises) {
    const item = movements[slug];
    assert.match(item.description, /[\u4e00-\u9fff]/, slug);
    assert.ok(
      item.description.length >= 15 && item.description.length <= 220,
      slug,
    );
    descriptions.add(item.description);
    assert.ok(
      item.instructions.length >= 4 && item.instructions.length <= 6,
      slug,
    );
    assert.equal(
      new Set(item.instructions).size,
      item.instructions.length,
      slug,
    );
    for (const text of item.instructions) {
      assert.match(text, /[\u4e00-\u9fff]/, slug);
      assert.doesNotMatch(text, /https?:|MoveKit|TODO|待补充|敬请期待/i, slug);
      assert.doesNotMatch(text.replace(/TRX/g, ""), /[A-Za-z]{3,}/, slug);
    }
  }
  assert.equal(
    descriptions.size,
    source.exercises.length,
    "each introduction should describe its specific movement",
  );
});
