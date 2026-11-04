import {
  mkdir,
  copyFile,
  readdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { buildMovementLibrary } from "./library-assets.mjs";
// Ship the same notices in desktop and Web builds, including offline copies.
await mkdir("public/licenses", { recursive: true });
for (const [source, filename] of [
  ["../LICENSE", "LICENSE.txt"],
  ["../ASSET-LICENSES.md", "ASSET-LICENSES.md"],
  ...(await readdir("../docs/licenses")).map((name) => [`../docs/licenses/${name}`, name]),
  ["node_modules/lucide-react/LICENSE", "lucide.txt"],
  ["node_modules/sql.js/LICENSE", "sql.js.txt"],
]) await copyFile(source, `public/licenses/${filename}`);
await mkdir("public/wasm", { recursive: true });
await mkdir("public/sqlite", { recursive: true });
await copyFile(
  "node_modules/sql.js/dist/sql-wasm.wasm",
  "public/sqlite/sql-wasm.wasm",
);
for (const f of await readdir("node_modules/@mediapipe/tasks-vision/wasm"))
  await copyFile(
    "node_modules/@mediapipe/tasks-vision/wasm/" + f,
    "public/wasm/" + f,
  );
await mkdir("public/models", { recursive: true });
const file = "public/models/pose_landmarker_full.task";
let model;
try {
  model = await readFile(file);
} catch {
  const r = await fetch(
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  );
  if (!r.ok) throw Error("模型下载失败");
  model = Buffer.from(await r.arrayBuffer());
}
if (
  createHash("sha256").update(model).digest("hex") !==
  "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"
)
  throw Error("姿态模型校验失败");
await writeFile(file, model);
// Full is the only supported pose model; keep retired caches out of builds.
await rm("public/models/pose_landmarker_lite.task", { force: true });
await rm("public/models/pose_landmarker_heavy.task", { force: true });
// MediaPipe's loader uses importScripts and a global ModuleFactory. A classic
// bundled worker keeps inference off the renderer while preserving that contract.
await build({
  entryPoints: ["src/media/pose.worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "public/pose-worker.js",
  minify: true,
});
const catalogSource = await readFile("../data/exercises.json", "utf8");
const catalog = JSON.parse(catalogSource);
const localization = JSON.parse(
  await readFile("../data/exercises.zh-CN.json", "utf8"),
);
if (
  localization.sourceSha256 !==
  createHash("sha256").update(catalogSource).digest("hex")
)
  throw Error("动作库原文已变更，请更新中文内容后重新构建");
const chinese = localization.exercises;
const knowledge = catalog.exercises.map(({ images, ...item }) => {
  const translation = chinese[item.id];
  if (
    !translation ||
    !/[\u4e00-\u9fff]/.test(translation.name) ||
    translation.instructions.length !== item.instructions.length
  )
    throw Error(`动作中文内容缺失或步骤数量不一致：${item.id}`);
  return {
    ...item,
    name: translation.name,
    instructions: translation.instructions,
    originalName: item.name,
    originalInstructions: item.instructions,
    source: "free-exercise-db / 公共领域 · 中文译文，英文原文可对照",
  };
});
for (const name of await readdir("../data/knowledge")) {
  if (name.endsWith(".md")) {
    const source = await readFile("../data/knowledge/" + name, "utf8");
    source.split(/\n(?=## )/).forEach((text, index) =>
      knowledge.push({
        id: `note-${name}-${index}`,
        name: text.split("\n")[0].replace(/^#+\s*/, ""),
        text,
        source: "本地训练知识 / " + name,
      }),
    );
  }
}
await writeFile("public/knowledge.json", JSON.stringify(knowledge));
await buildMovementLibrary();

await mkdir("public/vad", { recursive: true });
await copyFile(
  "node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx",
  "public/vad/silero_vad_v5.onnx",
);
for (const ext of ["wasm", "mjs"])
  await copyFile(
    `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.${ext}`,
    `public/vad/ort-wasm-simd-threaded.${ext}`,
  );
