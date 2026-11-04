import type { Data } from "../platform";
import type { Exercise, Rep } from "./engine";
import type { RecordRow } from "./session";
import { referenceEntrySchema } from "./data";

export function canUseAsReference(rep: Rep) {
  if (rep.assessment?.limited) return false;
  return referenceEntrySchema.safeParse({
    trajectory: rep.trajectory,
    score: rep.score,
    recorded: "",
  }).success;
}

export function referenceCandidates(records: RecordRow[], exercise?: Exercise) {
  return records
    .filter(
      (r) => r.exercise !== "plank" && (!exercise || r.exercise === exercise),
    )
    .slice()
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .flatMap((record) =>
      record.reps.flatMap((rep, index) =>
        canUseAsReference(rep) ? [{ record, rep, index }] : [],
      ),
    );
}

export function saveReferenceFromRecord(
  data: Data,
  recordId: string,
  repIndex: number,
  recorded = new Date().toISOString(),
): Data {
  const record = data.records.find((r) => r.id === recordId);
  if (!record) throw Error("这条训练记录已不存在，请重新选择。");
  const rep = record.reps[repIndex];
  if (
    record.exercise === "plank" ||
    !Number.isInteger(repIndex) ||
    !rep ||
    !canUseAsReference(rep)
  )
    throw Error("这次动作没有可用的轨迹数据，请选择其他动作。");
  const reference = referenceEntrySchema.parse({
    trajectory: rep.trajectory,
    score: rep.score,
    recorded,
    recordId: record.id,
    repIndex,
    startedAt: record.startedAt,
  });
  return {
    ...data,
    references: { ...data.references, [record.exercise]: reference },
  };
}
