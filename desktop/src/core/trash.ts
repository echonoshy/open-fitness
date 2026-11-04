import type { Data } from "../platform";
import type { Exercise } from "./engine";
import type { TrashEntry } from "./data";
type Target =
  | { kind: "plan"; id: string }
  | { kind: "profile"; category: string; key: string }
  | { kind: "reference"; exercise: Exercise };

export function moveToTrash(data: Data, target: Target): Data {
  const meta = { id: crypto.randomUUID(), deletedAt: new Date().toISOString() };
  let entry: TrashEntry, next: Data;
  if (target.kind === "plan") {
    const value = data.plans?.find((p) => p.id === target.id);
    if (!value) throw Error("计划已不存在");
    entry = { ...meta, kind: "plan", value };
    next = { ...data, plans: data.plans?.filter((p) => p.id !== target.id) };
  } else if (target.kind === "profile") {
    const matches = (f: { category: string; key: string }) =>
      f.category === target.category && f.key === target.key;
    const value = data.profile?.find(matches);
    if (!value) throw Error("资料已不存在");
    entry = { ...meta, kind: "profile", value };
    next = { ...data, profile: data.profile?.filter((f) => !matches(f)) };
  } else {
    const value = data.references?.[target.exercise];
    if (!value) throw Error("参考动作已不存在");
    entry = { ...meta, kind: "reference", exercise: target.exercise, value };
    const references = { ...data.references };
    delete references[target.exercise];
    next = { ...data, references };
  }
  return { ...next, trash: [...(data.trash ?? []), entry] };
}

export function restoreTrash(data: Data, id: string): Data {
  const entry = data.trash?.find((x) => x.id === id);
  if (!entry) throw Error("此项目已恢复或已永久删除");
  let next: Data;
  if (entry.kind === "plan") {
    if (
      data.plans?.some(
        (p) => p.id === entry.value.id || p.name === entry.value.name,
      )
    )
      throw Error("已有同名计划，请先修改现有计划名称或移入最近删除，再恢复。");
    next = { ...data, plans: [...(data.plans ?? []), entry.value] };
  } else if (entry.kind === "profile") {
    if (
      data.profile?.some(
        (f) => f.category === entry.value.category && f.key === entry.value.key,
      )
    )
      throw Error("此分类已有同名资料，请先改名或移入最近删除，再恢复。");
    next = { ...data, profile: [...(data.profile ?? []), entry.value] };
  } else {
    if (data.references?.[entry.exercise])
      throw Error("此动作已有参考，请先将现有参考移入最近删除，再恢复。");
    next = {
      ...data,
      references: { ...data.references, [entry.exercise]: entry.value },
    };
  }
  return { ...next, trash: data.trash?.filter((x) => x.id !== id) };
}
