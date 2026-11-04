import { z } from "zod";
export const categories = [
  "identity",
  "body",
  "goals",
  "injuries",
  "equipment",
  "schedule",
  "nutrition",
  "preferences",
] as const;
export const categoryNames: Record<string, string> = {
  identity: "基本资料",
  body: "身体情况",
  goals: "训练目标",
  injuries: "伤病与限制",
  equipment: "可用器械",
  schedule: "训练安排",
  nutrition: "饮食偏好",
  preferences: "其他偏好",
};
export const factSchema = z
  .object({
    category: z.enum(categories),
    key: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(800),
  })
  .strict();
export type Fact = z.infer<typeof factSchema> & { updatedAt: string };
export type LibraryItem = {
  id: string;
  name: string;
  originalName?: string;
  originalInstructions?: string[];
  equipment?: string;
  level?: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  text?: string;
  source?: string;
};
let cache: Promise<LibraryItem[]> | undefined;
export function loadLibrary() {
  return (cache ??= fetch("./knowledge.json")
    .then((r) => {
      if (!r.ok) throw Error("本地知识库加载失败");
      return r.json() as Promise<LibraryItem[]>;
    })
    .catch((e) => {
      cache = undefined;
      throw e;
    }));
}
const synonyms: Record<string, string> = {
  深蹲: "squat",
  推举: "shoulder press overhead",
  肩: "shoulder",
  弯举: "curl biceps",
  俯卧撑: "push up push-up",
  卧推: "bench press",
  硬拉: "deadlift",
  弓步: "lunge",
  平板: "plank",
  引体: "pull up pull-up",
  哑铃: "dumbbell",
  杠铃: "barbell",
  自重: "body only",
  腹: "abdominals",
  胸: "chest",
  背: "back lats",
  腿: "quadriceps hamstrings",
  恢复: "recovery",
  计划: "programming",
};
export function searchLibrary(items: LibraryItem[], query: string, limit = 8) {
  let q = query.toLowerCase();
  for (const [a, b] of Object.entries(synonyms))
    if (q.includes(a)) q += " " + b;
  const tokens = [...new Set(q.match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [])];
  if (!tokens.length) return items.slice(0, limit);
  const docs = items.map((x) => ({
    x,
    title: [x.name, x.originalName].join(" ").toLowerCase(),
    text: [
      x.name,
      x.originalName,
      x.equipment,
      x.primaryMuscles?.join(" "),
      x.instructions?.join(" "),
      x.originalInstructions?.join(" "),
      x.text,
    ]
      .join(" ")
      .toLowerCase(),
  }));
  const frequency = tokens.map(
    (t) => docs.filter((d) => d.text.includes(t)).length,
  );
  return docs
    .map((d) => ({
      x: d.x,
      score: tokens.reduce(
        (sum, t, i) =>
          sum +
          (d.text.includes(t)
            ? Math.log(1 + items.length / (1 + frequency[i])) *
              (d.title.includes(t) ? 3 : 1)
            : 0),
        0,
      ),
    }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((d) => d.x);
}
export const equipmentOptions: Record<string, string> = {
  dumbbell: "哑铃",
  barbell: "杠铃",
  "body only": "自重",
  cable: "绳索",
  machine: "器械",
  bands: "弹力带",
  kettlebells: "壶铃",
};
export const muscleOptions: Record<string, string> = {
  chest: "胸部",
  back: "背部",
  shoulders: "肩部",
  biceps: "肱二头肌",
  triceps: "肱三头肌",
  quadriceps: "股四头肌",
  hamstrings: "腿后侧",
  glutes: "臀部",
  abdominals: "核心",
  calves: "小腿",
};
function canonical(value: string, options: Record<string, string>) {
  const aliases: Record<string, string> = {
    背: "back",
    背肌: "back",
    背阔肌: "lats",
    肩: "shoulders",
    肩膀: "shoulders",
    胸: "chest",
    腹: "abdominals",
    腹部: "abdominals",
    臀: "glutes",
    臀肌: "glutes",
    徒手: "body only",
    无器械: "body only",
    bodyweight: "body only",
    none: "body only",
    腿: "legs",
    腿部: "legs",
  };
  value = aliases[value] ?? value;
  return (
    Object.entries(options).find(
      ([key, label]) => value === key || value === label,
    )?.[0] ?? value.toLowerCase()
  );
}
export function findExercises(
  items: LibraryItem[],
  query = "",
  filters: { muscle?: string; equipment?: string; level?: string } = {},
  limit = 8,
) {
  const muscle = canonical(filters.muscle ?? "", muscleOptions),
    equipment = canonical(filters.equipment ?? "", equipmentOptions);
  const matches = (ms: string[]) =>
    !muscle ||
    (muscle === "back"
      ? ms.some((m) =>
          ["lats", "middle back", "lower back", "traps"].includes(m),
        )
      : muscle === "legs"
        ? ms.some((m) =>
            ["quadriceps", "hamstrings", "calves", "glutes"].includes(m),
          )
        : ms.includes(muscle));
  const selected = items.filter(
    (x) =>
      matches([...(x.primaryMuscles ?? []), ...(x.secondaryMuscles ?? [])]) &&
      (!equipment ||
        ((x.equipment ?? "body only") === equipment && !!x.instructions)) &&
      (!filters.level || x.level === filters.level),
  );
  return searchLibrary(selected, query, selected.length)
    .sort(
      (a, b) =>
        Number(matches(b.primaryMuscles ?? [])) -
        Number(matches(a.primaryMuscles ?? [])),
    )
    .slice(0, limit);
}
export async function relevantKnowledge(question: string, exercise: string) {
  const items = await loadLibrary();
  return searchLibrary(
    items.filter((x) => x.text),
    `${question} ${exercise.replaceAll("_", " ")}`,
    3,
  ).map((x) => ({
    title: x.name,
    text: x.text?.slice(0, 600),
    source: x.source,
  }));
}
export function plates(
  target: number,
  bar = 20,
  available = [25, 20, 15, 10, 5, 2.5, 1.25],
) {
  if (
    !Number.isFinite(target) ||
    target < bar ||
    target > 500 ||
    !Number.isFinite(bar) ||
    bar < 0 ||
    !available.length ||
    available.some((n) => !Number.isFinite(n) || n <= 0)
  )
    throw Error("重量或杠铃片参数无效");
  // Integer grams and dynamic programming handle non-canonical plate sets.
  const goal = Math.round((target - bar) * 500),
    sizes = [...new Set(available)]
      .sort((a, b) => b - a)
      .map((n) => Math.round(n * 1000));
  const dp = new Int32Array(goal + 1).fill(1e6),
    choice = new Int32Array(goal + 1).fill(-1);
  dp[0] = 0;
  for (let n = 1; n <= goal; n++)
    for (let j = 0; j < sizes.length; j++)
      if (sizes[j] <= n && dp[n - sizes[j]] + 1 < dp[n]) {
        dp[n] = dp[n - sizes[j]] + 1;
        choice[n] = j;
      }
  let reachable = goal;
  while (reachable > 0 && choice[reachable] < 0) reachable--;
  let n = reachable;
  const eachSide: number[] = [];
  while (n > 0) {
    const w = sizes[choice[n]];
    eachSide.push(w / 1000);
    n -= w;
  }
  return {
    target,
    bar,
    eachSide,
    actual: bar + reachable / 500,
    shortfall: target - bar - reachable / 500,
    assumption: "每种杠铃片有足够的成对数量",
  };
}
export function safetyResponse(text: string) {
  // Only an asserted current complaint can trigger an immediate operation.
  // Check each clause separately: a negated symptom must not mask a later real one.
  const asserted = (words: RegExp) => {
    const clauses = text.split(/[，,。！？!?；;\n]|但是|但|不过/);
    return clauses.some((clause) =>
      [...clause.matchAll(words)].some((m) => {
        const before = clause.slice(0, m.index),
          after = clause.slice(m.index! + m[0].length);
        if (/[“”「」『』"]/.test(clause)) return false;
        if (/如果|假如|假设|要是|万一|例如|比如/.test(before)) return false;
        if (
          /(没有|没|无|不再|并非|不是|未出现|不)(?:任何|明显的?|感觉到?|觉得|出现|有)?$/.test(
            before.trim(),
          )
        )
          return false;
        if (
          /^(?:已经|已|现在)?(?:好了|消失了|不疼了|不痛了)/.test(after.trim())
        )
          return false;
        const other = Math.max(
          ...[...before.matchAll(/朋友|同事|家人|别人|有人|他|她|病人/g)].map(
            (x) => x.index!,
          ),
          -1,
        );
        const self = before.lastIndexOf("我");
        if (other > self) return false;
        if (
          /昨天|前天|以前|曾经|上周|去年|过去/.test(before) &&
          !/现在|今天|此刻|仍然|还在/.test(before)
        )
          return false;
        if (/是什么|是什么意思|这个词|怎么理解|如何理解/.test(after))
          return false;
        // Generic "X怎么办/可以继续吗" goes through the model; "我现在X怎么办"
        // is a current personal complaint and still takes the immediate path.
        if (
          /怎么办|怎么处理|如何|可以|还能|会不会/.test(after) &&
          !/我|现在|突然|感觉|有点|快要/.test(before)
        )
          return false;
        return true;
      }),
    );
  };
  const urgent = asserted(/胸痛|呼吸困难|快晕|要晕|晕厥/g);
  if (urgent)
    return "先停止训练并坐到安全的位置。这类不适需要及时寻求医疗帮助；我不能靠摄像头判断原因。";
  if (
    asserted(/受伤|疼痛|痛得|头晕|带伤/g) &&
    /继续|硬撑|加重|带伤.*(?:练|训练)/.test(text)
  )
    return "先暂停训练，不要忍痛加量。等不适原因明确、获得适当建议后再安排训练。";
  return null;
}
