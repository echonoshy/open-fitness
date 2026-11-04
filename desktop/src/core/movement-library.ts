import type { Exercise } from "./engine";
import {
  effectiveMovementProfile,
  statisticLabel,
} from "./movement-statistics";

export interface Movement {
  slug: string;
  name: string;
  originalName: string;
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  level: string;
  description: string;
  instructions: string[];
  video: string;
  poster: string;
  durationSeconds: number;
  videoQuality?: "enhanced-720p";
  trainingExercise?: Exercise;
}

export function movementCapability(item: Movement) {
  return item.trainingExercise === "plank"
    ? "姿态计时"
    : item.trainingExercise
      ? "自动计数"
      : statisticLabel(effectiveMovementProfile(item).mode);
}

export const movementEquipment: Record<string, string> = {
  Bodyweight: "自重",
  Dumbbell: "哑铃",
  Barbell: "杠铃",
  Machine: "器械",
  "Cable Machine": "绳索器械",
  Kettlebell: "壶铃",
  Band: "弹力带",
  Bench: "训练凳",
  Bicycle: "自行车",
  "Weight Plate": "杠铃片",
  Backpack: "背包",
  Sled: "雪橇",
  "Stability Ball": "健身球",
  Towel: "毛巾",
  TRX: "TRX 悬吊带",
  "Battle Ropes": "战绳",
  Dowel: "木杆",
  "Foam Roller": "泡沫轴",
  "Medicine Ball": "药球",
  Slider: "滑盘",
  "Wrist Roller": "腕力卷绳器",
};
export const movementMuscles: Record<string, string> = {
  Chest: "胸部",
  Back: "背部",
  Shoulders: "肩部",
  Biceps: "肱二头肌",
  Triceps: "肱三头肌",
  Core: "核心",
  Glutes: "臀部",
  Quadriceps: "股四头肌",
  Hamstrings: "腿后侧",
  Calves: "小腿",
  Trapezius: "斜方肌",
  "Lower Back": "下背部",
  Forearms: "前臂",
  Adductors: "内收肌",
  Abductors: "外展肌",
  Neck: "颈部",
  Tibialis: "胫骨前肌",
  "Hip Flexors": "髋屈肌",
};
export const movementLevels: Record<string, string> = {
  beginner: "入门",
  intermediate: "进阶",
  advanced: "高阶",
  expert: "专业",
};
export const primaryMovementSlugs: Record<Exercise, string> = {
  squat: "bodyweight-squat",
  pushup: "push-up",
  bench: "barbell-bench-press",
  deadlift: "barbell-deadlift",
  lunge: "forward-lunge",
  shoulder_press: "standing-dumbbell-overhead-press",
  curl: "dumbbell-curl",
  pullup: "pull-ups",
  plank: "front-plank",
};

let cached: Promise<Movement[]> | undefined;
export function loadMovementLibrary(): Promise<Movement[]> {
  return (cached ??= fetch("./movekit-library/catalog.json")
    .then(async (response) => {
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw Error("动作图解暂时无法读取，请重新加载。");
      const data = (await response.json()) as { movements: Movement[] };
      if (!data.movements?.length)
        throw Error("动作图解尚未准备好，请重新加载。");
      return data.movements;
    })
    .catch((error) => {
      cached = undefined;
      throw error;
    }));
}

const normalized = (value: string) => value.toLowerCase().replace(/[-_]/g, " ");

/** Match part of a name with one mistyped, missing, extra or transposed character. */
function nearSubstring(word: string, term: string) {
  for (let start = 0; start + term.length - 1 <= word.length; start++) {
    let i = 0;
    while (i < term.length && term[i] === word[start + i]) i++;
    if (i === term.length) return true;
    const at = start + i;
    const rest = term.slice(i + 1);
    if (
      word.startsWith(rest, at + 1) || // replace
      word.startsWith(rest, at) || // remove an extra character from the query
      word.startsWith(term.slice(i), at + 1) || // insert a missing character
      (i + 1 < term.length &&
        term[i + 1] === word[at] &&
        term[i] === word[at + 1] &&
        word.startsWith(term.slice(i + 2), at + 2))
    )
      return true;
  }
  return false;
}

/** All query terms must match, so “哑铃 卧推” does not return every dumbbell lift. */
export function filterMovements(
  items: Movement[],
  filters: {
    query?: string;
    equipment?: string;
    muscle?: string;
    level?: string;
    trainable?: boolean;
  },
) {
  const terms = normalized(filters.query?.trim() ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const exact: Movement[] = [];
  const nearby: Movement[] = [];
  for (const item of items) {
    if (filters.equipment && !item.equipment.includes(filters.equipment))
      continue;
    if (
      filters.muscle &&
      ![...item.primaryMuscles, ...item.secondaryMuscles].includes(
        filters.muscle,
      )
    )
      continue;
    if (filters.level && item.level !== filters.level) continue;
    if (filters.trainable && movementCapability(item) === "计时记录") continue;
    if (!terms.length) {
      exact.push(item);
      continue;
    }
    const haystack = normalized(
      [
        item.name,
        item.originalName,
        item.slug,
        ...item.equipment.flatMap((x) => [x, movementEquipment[x] ?? x]),
        ...item.primaryMuscles.flatMap((x) => [x, movementMuscles[x] ?? x]),
        ...item.secondaryMuscles.flatMap((x) => [x, movementMuscles[x] ?? x]),
      ].join(" "),
    );
    const missing = terms.filter((term) => !haystack.includes(term));
    if (!missing.length) {
      exact.push(item);
    } else if (!exact.length && missing.every((term) => term.length >= 3)) {
      const words = haystack.split(/\s+/);
      if (
        missing.every((term) => words.some((word) => nearSubstring(word, term)))
      )
        nearby.push(item);
    }
  }
  return exact.length ? exact : nearby;
}
