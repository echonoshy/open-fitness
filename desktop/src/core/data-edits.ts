import type { Data } from "../platform";
import { factSchema, type Fact } from "./knowledge";
import { mergeRecords } from "./history";
import { catalogPlanSchema, type PlanBlock } from "./catalog-plan";
import { defaultPlanIcon, type PlanColor, type PlanIcon } from "./data";
import { mergeTimedRecords } from "./timed-training";

export function saveProfileFact(
  data: Data,
  input: { category: string; key: string; value: string },
  previous?: Pick<Fact, "category" | "key">,
): Data {
  const fact = factSchema.parse(input);
  const matches = (
    f: Pick<Fact, "category" | "key">,
    identity: Pick<Fact, "category" | "key">,
  ) => f.category === identity.category && f.key.trim() === identity.key.trim();
  if (
    previous &&
    !matches(fact, previous) &&
    data.profile?.some((f) => matches(f, fact))
  ) {
    throw Error("此分类已有同名资料，请换一个名称，避免覆盖其他资料。");
  }
  return {
    ...data,
    profile: [
      ...(data.profile ?? []).filter(
        (f) => !matches(f, fact) && !(previous && matches(f, previous)),
      ),
      { ...fact, updatedAt: new Date().toISOString() },
    ],
  };
}

export function saveNamedPlan(
  data: Data,
  name: string,
  blocks: PlanBlock[],
  draft?: { editingId: string | null; icon: PlanIcon; color?: PlanColor },
) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw Error("请输入 1–80 字的计划名称");
  const parsed = catalogPlanSchema.parse(blocks);
  const plans = data.plans ?? [];
  const named = plans.find((p) => p.name === trimmed);
  const existing = draft ? plans.find((p) => p.id === draft.editingId) : named;
  if (draft?.editingId != null && !existing) throw Error("此计划已删除，请重新选择。");
  if (draft && named && existing?.name !== trimmed)
    throw Error("已有同名计划，请换一个名称。");
  const color = draft?.color ?? existing?.color;
  const plan = {
    id: existing?.id ?? crypto.randomUUID(),
    name: trimmed,
    blocks: parsed,
    icon: draft?.icon ?? existing?.icon ?? defaultPlanIcon,
    ...(color && { color }),
  };
  return {
    ...data,
    plans: existing
      ? plans.map((p) => (p.id === existing.id ? plan : p))
      : [...plans, plan],
  };
}

export function mergeImportedData(
  data: Data,
  incoming: Pick<
    Data,
    | "records"
    | "profile"
    | "plans"
    | "references"
    | "trash"
    | "homeShortcuts"
    | "freePractice"
    | "timedRecords"
  >,
) {
  // Importing an older snapshot of the live local set must not archive it:
  // otherwise savePending would later skip the complete record with this ID.
  const records = mergeRecords(
    data.records,
    incoming.records.filter((row) => row.id !== data.checkpoint?.id),
  );
  const profile = [...(data.profile ?? [])];
  for (const fact of incoming.profile ?? []) {
    if (
      !profile.some((f) => f.category === fact.category && f.key === fact.key)
    )
      profile.push(fact);
  }
  const plans = [...(data.plans ?? [])];
  for (const plan of incoming.plans ?? []) {
    if (!plans.some((p) => p.id === plan.id)) plans.push(plan);
  }
  const references = { ...incoming.references, ...data.references };
  const trash = [...(data.trash ?? [])];
  for (const entry of incoming.trash ?? [])
    if (!trash.some((e) => e.id === entry.id)) trash.push(entry);
  const added = {
    records: records.length - data.records.length,
    profile: profile.length - (data.profile?.length ?? 0),
    plans: plans.length - (data.plans?.length ?? 0),
    references:
      Object.keys(references).length -
      Object.keys(data.references ?? {}).length,
  };
  const freePractice = incoming.freePractice
    ? {
        movementSlugs: [
          ...new Set([
            ...(data.freePractice?.movementSlugs ?? []),
            ...incoming.freePractice.movementSlugs,
          ]),
        ],
      }
    : data.freePractice;
  const practiceAdded =
    (freePractice?.movementSlugs.length ?? 0) -
    (data.freePractice?.movementSlugs.length ?? 0);
  const timedRecords = mergeTimedRecords(
    data.timedRecords ?? [],
    incoming.timedRecords ?? [],
    data.timedCheckpoint?.id,
  );
  return {
    data: {
      ...data,
      records,
      profile,
      plans,
      references,
      trash,
      freePractice,
      homeShortcuts: data.homeShortcuts ?? incoming.homeShortcuts,
      timedRecords,
    },
    message: `新增 ${added.records} 组记录${incoming.timedRecords?.length ? `、${timedRecords.length - (data.timedRecords?.length ?? 0)} 组计时记录` : ""}、${added.profile} 条资料、${added.plans} 份计划、${added.references} 个参考动作${incoming.freePractice ? `、${practiceAdded} 个自由跟练动作` : ""}；${incoming.records.length - added.records} 组重复记录已跳过，另有 ${trash.length - (data.trash?.length ?? 0)} 项加入最近删除。同名资料、同 ID 计划和已有参考动作保留本机版本。`,
  };
}
