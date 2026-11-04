import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

// Keep the original knowledge database available to the coach; the visual
// catalogue is a separate read-only source and never changes saved exercise IDs.
export async function buildMovementLibrary() {
  const directory = "public/movekit-library/hd";
  const manifest = JSON.parse(
    await readFile(`${directory}/manifest.json`, "utf8"),
  );
  const enhanced = new Map(manifest.clips.map((clip) => [clip.slug, clip]));
  const files = new Set(await readdir(directory));
  // Vite copies public/ as-is. Do not silently ship retired source or reference clips.
  for (const oldPath of [
    "public/movekit-library/files",
    "public/exercise-reference",
  ]) {
    const oldFiles = await readdir(oldPath).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (oldFiles.some((name) => /\.(mp4|webp)$/i.test(name)))
      throw Error(
        `请先将旧版 MoveKit 素材移出 ${oldPath}，再构建 720p 动作库。`,
      );
  }
  const source = JSON.parse(
    await readFile("../data/movekit-library.json", "utf8"),
  );
  const { names, classifications = {} } = JSON.parse(
    await readFile("../data/movekit-library.zh-CN.json", "utf8"),
  );
  const { movements: instructions } = JSON.parse(
    await readFile("../data/movekit-library.instructions.zh-CN.json", "utf8"),
  );
  const trainable = {
    "bodyweight-squat": "squat",
    "push-up": "pushup",
    "barbell-bench-press": "bench",
    "barbell-deadlift": "deadlift",
    "forward-lunge": "lunge",
    "standing-dumbbell-overhead-press": "shoulder_press",
    "dumbbell-curl": "curl",
    "pull-ups": "pullup",
    "front-plank": "plank",
  };
  const order = Object.keys(trainable);
  let missingMovements = 0;
  const movements = [];
  for (const item of source.exercises) {
    if (!names[item.slug]) throw Error(`动作缺少中文名称：${item.slug}`);
    const copy = instructions[item.slug];
    if (
      !copy?.description ||
      !Array.isArray(copy.instructions) ||
      copy.instructions.length < 4
    )
      throw Error(`动作缺少中文介绍或要领：${item.slug}`);
    const hd = enhanced.get(item.slug);
    if (
      !hd ||
      hd.height !== 720 ||
      !hd.decodeVerified ||
      hd.quality !== "enhanced-720p"
    )
      throw Error(`动作缺少已验证的 720p 成片记录：${item.slug}`);
    const filename = `${item.slug}.mp4`;
    const cover = `${item.slug}.webp`;
    if (!trainable[item.slug] && !files.has(filename) && !files.has(cover)) {
      missingMovements++;
      continue;
    }
    if (!files.delete(filename) || !files.delete(cover))
      throw Error(`动作高清成片或封面缺失：${item.slug}`);
    const bytes = await readFile(`${directory}/${filename}`);
    if (createHash("sha256").update(bytes).digest("hex") !== hd.sha256)
      throw Error(`动作 720p 成片校验失败：${item.slug}`);
    const poster = await readFile(`${directory}/${cover}`);
    if (createHash("sha256").update(poster).digest("hex") !== hd.posterSha256)
      throw Error(`动作 720p 封面校验失败：${item.slug}`);
    movements.push({
      slug: item.slug,
      name: names[item.slug],
      originalName: item.name,
      equipment: item.equipment,
      primaryMuscles:
        classifications[item.slug]?.primaryMuscles ?? item.primaryMuscles,
      secondaryMuscles:
        classifications[item.slug]?.secondaryMuscles ?? item.secondaryMuscles,
      level: item.difficulty,
      description: copy.description,
      instructions: copy.instructions,
      video: `./movekit-library/hd/${filename}`,
      poster: `./movekit-library/hd/${cover}`,
      durationSeconds: item.durationSeconds,
      videoQuality: hd.quality,
      trainingExercise: trainable[item.slug],
    });
  }
  if ([...files].some((name) => /\.(mp4|webp)$/i.test(name)))
    throw Error("高清素材目录存在清单以外的视频或封面。");
  if (missingMovements)
    console.warn(
      `MoveKit：${missingMovements} 个动作未安装本地 720p 成片和封面，已跳过。`,
    );
  movements.sort((a, b) => {
    const ai = order.indexOf(a.slug),
      bi = order.indexOf(b.slug);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
  });
  await mkdir("public/movekit-library", { recursive: true });
  await writeFile(
    "public/movekit-library/catalog.json",
    JSON.stringify({
      source: "MoveKit",
      sourceAssetType: source.assetType,
      assetType: "ai-enhanced-public-preview",
      retrievedAt: source.retrievedAt,
      movements,
    }),
  );
}
