import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { configureServices, service } from "../electron/services";
import {
  EXERCISE_REFERENCES,
  exerciseNarrationSegments,
} from "../src/core/exercise-reference";
import type { Exercise } from "../src/core/engine";
import { COACH_VOICES } from "../src/core/voices";
import { joinPcmWavs, readPcmWav } from "../src/core/pcm-wav";
configureServices(process.env.COACH_SERVICES_CONFIG);
const root = "public/exercise-narration";
await mkdir(root, { recursive: true });
const jobs = COACH_VOICES.flatMap((voice) =>
  (Object.keys(EXERCISE_REFERENCES) as Exercise[]).map((exercise) => ({
    voice,
    exercise,
  })),
);
const manifest: Record<string, unknown> = {};
let done = 0;
async function worker() {
  for (let job; (job = jobs.shift());) {
    const { voice, exercise } = job,
      text = exerciseNarrationSegments(exercise);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ voice, text, format: "pcm16-24k-v1" }))
      .digest("hex");
    const dir = `${root}/${voice.id}`,
      file = `${dir}/${exercise}.wav`,
      stamp = `${dir}/${exercise}.json`;
    await mkdir(dir, { recursive: true });
    let cached = false;
    try {
      cached =
        JSON.parse(await readFile(stamp, "utf8")).fingerprint === fingerprint;
      if (cached) readPcmWav(await readFile(file));
    } catch {
      cached = false;
    }
    if (!cached) {
      const clips: Uint8Array[] = [];
      for (const sentence of text)
        clips.push(
          (await service(
            "tts",
            { text: sentence, voice: voice.id },
            AbortSignal.timeout(60000),
          )) as Uint8Array,
        );
      const raw = `${dir}/${exercise}.raw.wav`,
        tmp = `${dir}/${exercise}.tmp.wav`;
      await writeFile(raw, joinPcmWavs(clips, 160));
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        raw,
        "-ar",
        "24000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        tmp,
      ]);
      await rename(tmp, file);
      const { unlink } = await import("node:fs/promises");
      await unlink(raw);
      await writeFile(
        stamp,
        JSON.stringify({ fingerprint, segments: text }) + "\n",
      );
    }
    const bytes = await readFile(file),
      audio = readPcmWav(bytes);
    manifest[`${voice.id}/${exercise}`] = {
      segments: text,
      fingerprint,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sampleRate: audio.sampleRate,
      seconds: audio.pcm.length / 2 / audio.sampleRate,
    };
    console.log(
      `${++done}/72 ${voice.id} ${exercise} ${cached ? "cached" : "generated"}`,
    );
  }
}
await Promise.all([worker(), worker()]);
await writeFile(
  `${root}/manifest.json`,
  JSON.stringify({ version: 1, clips: manifest }, null, 2) + "\n",
);
