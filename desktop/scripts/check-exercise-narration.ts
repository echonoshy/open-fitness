import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  EXERCISE_REFERENCES,
  exerciseNarrationSegments,
} from "../src/core/exercise-reference";
import type { Exercise } from "../src/core/engine";
import { COACH_VOICES } from "../src/core/voices";
import { readPcmWav } from "../src/core/pcm-wav";
const root = new URL("../public/exercise-narration/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
let count = 0;
for (const voice of COACH_VOICES)
  for (const exercise of Object.keys(EXERCISE_REFERENCES) as Exercise[]) {
    const key = `${voice.id}/${exercise}`,
      item = manifest.clips[key];
    assert.deepEqual(
      item?.segments,
      exerciseNarrationSegments(exercise),
      `讲解内容已变更，请重新生成: ${key}`,
    );
    const bytes = await readFile(new URL(key + ".wav", root)),
      audio = readPcmWav(bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      item.sha256,
      `讲解文件校验失败: ${key}`,
    );
    assert.equal(audio.sampleRate, 24000);
    assert.ok(item.seconds > 3 && item.seconds < 35, `异常讲解时长: ${key}`);
    count++;
  }
console.log(
  `Validated ${count} bundled explanations (${COACH_VOICES.length} voices).`,
);
