import { readFileSync } from "node:fs";
import type { Movement } from "../../src/core/movement-library";

// Keep real built entries when installed. Exercise behavior for optional movements
// using their checked-in metadata, even on a checkout with only the bundled media.
const installed: Movement[] = JSON.parse(
  readFileSync(
    new URL("../../public/library/catalog.json", import.meta.url),
    "utf8",
  ),
).movements;
const bySlug = new Map(installed.map((item) => [item.slug, item]));

const data = new URL("../../../data/", import.meta.url);
const { exercises } = JSON.parse(
  readFileSync(new URL("library.json", data), "utf8"),
);
const { names, classifications } = JSON.parse(
  readFileSync(new URL("library.zh-CN.json", data), "utf8"),
);
const { movements: copy } = JSON.parse(
  readFileSync(
    new URL("library.instructions.zh-CN.json", data),
    "utf8",
  ),
);

type SourceExercise = Pick<
  Movement,
  | "slug"
  | "name"
  | "equipment"
  | "primaryMuscles"
  | "secondaryMuscles"
  | "durationSeconds"
> & { difficulty: string };

export const catalog: Movement[] = exercises.map(
  (item: SourceExercise): Movement =>
    bySlug.get(item.slug) ?? {
      slug: item.slug,
      name: names[item.slug],
      originalName: item.name,
      equipment: item.equipment,
      primaryMuscles:
        classifications[item.slug]?.primaryMuscles ?? item.primaryMuscles,
      secondaryMuscles:
        classifications[item.slug]?.secondaryMuscles ?? item.secondaryMuscles,
      level: item.difficulty,
      description: copy[item.slug].description,
      instructions: copy[item.slug].instructions,
      durationSeconds: item.durationSeconds,
      video: "",
      poster: "",
    },
);
