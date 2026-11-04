import { useUiLocale } from "../i18n";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Dumbbell, FolderOpen, X } from "lucide-react";
import type { Data } from "../platform";
import { EXERCISES, type Exercise } from "../core/engine";
import {
  referenceCandidates,
  saveReferenceFromRecord,
} from "../core/references";
import { moveToTrash } from "../core/trash";
import { SectionHeading } from "./FeatureUI";
import "./reference-library.css";

type Props = {
  data: Data;
  persist: (update: (d: Data) => Data) => Promise<void>;
  report: (error: unknown) => void;
};
const dateText = (date: string, language: string) => new Date(date).toLocaleString(language);

export function ReferenceLibrary({ data, persist, report }: Props) {
  const { language, uiText } = useUiLocale();
  const [picker, setPicker] = useState<{ exercise?: Exercise } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const references = Object.entries(data.references ?? {});
  const remove = async (exercise: Exercise) => {
    setBusy(true);
    setNotice("");
    try {
      await persist((d) => moveToTrash(d, { kind: "reference", exercise }));
      setNotice(
        `${EXERCISES[exercise].label}参考已删除，可在「我的资料」的「最近删除」中恢复。`,
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="feature-panel reference-panel"
      aria-label={uiText("我的参考动作")}
    >
      <div className="reference-library-heading">
        <div>
          <SectionHeading title={uiText("我的参考动作")} icon={Activity} />
          <p className="muted">
            {uiText("选一次已完成的动作，作为后续同类动作的对照。每种动作保留一份参考。")}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setNotice("");
            setPicker({});
          }}
        >
          <FolderOpen size={16} />
          {uiText("从训练记录中选择")}
        </button>
      </div>
      {!references.length && (
        <div className="reference-empty">
          <span className="list-icon">
            <Dumbbell size={20} />
          </span>
          <div>
            <strong>{uiText("还没有设置参考动作")}</strong>
            <p>{uiText("点击「从训练记录中选择」，选出你想用来对照的一次动作。")}</p>
          </div>
        </div>
      )}
      {references.map(([id, reference]) => {
        const exercise = id as Exercise;
        if (!reference) return null;
        return (
          <div className="reference-saved-row" key={id}>
            <span className="list-icon">
              <Dumbbell size={18} />
            </span>
            <div>
              <strong>{uiText(EXERCISES[exercise].label)}</strong>
              <p>
                {uiText(reference.startedAt
                  ? `训练于 ${dateText(reference.startedAt, language)}`
                  : `保存于 ${dateText(reference.recorded, language)}`)}
                {uiText(reference.repIndex !== undefined
                  ? ` · 第 ${reference.repIndex + 1} 次`
                  : "")}
                {uiText(` · 保存时评分 ${reference.score} 分`)}
              </p>
            </div>
            <div className="row-actions">
              <button
                type="button"
                disabled={busy}
                aria-label={uiText(`更换${EXERCISES[exercise].label}参考`)}
                onClick={() => {
                  setNotice("");
                  setPicker({ exercise });
                }}
              >
                {uiText("更换")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={uiText(`删除${EXERCISES[exercise].label}参考`)}
                onClick={() => void remove(exercise)}
              >
                {uiText("删除参考")}
              </button>
            </div>
          </div>
        );
      })}
      <p className="panel-note">
        {uiText("用于比较动作轨迹的一致性，不改变原有评分标准；相似度高不代表动作一定标准。")}
      </p>
      {notice && (
        <p className="success-notice" role="status">
          <Check size={15} />
          {uiText(notice)}
        </p>
      )}
      {picker && (
        <ReferencePicker
          data={data}
          persist={persist}
          exercise={picker.exercise}
          onClose={() => setPicker(null)}
          onSaved={(exercise, replaced) => {
            setPicker(null);
            setNotice(
              `${EXERCISES[exercise].label}参考已${replaced ? "更换" : "设置"}，之后完成的同类动作会自动与它比较。`,
            );
          }}
        />
      )}
    </section>
  );
}

function ReferencePicker({
  data,
  persist,
  exercise,
  onClose,
  onSaved,
}: Omit<Props, "report"> & {
  exercise?: Exercise;
  onClose: () => void;
  onSaved: (exercise: Exercise, replaced: boolean) => void;
}) {
  const { language, uiText } = useUiLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<Exercise | "all">(exercise ?? "all");
  const [selected, setSelected] = useState<{
    recordId: string;
    index: number;
  } | null>(null);
  const [limit, setLimit] = useState(20);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = useMemo(
    () =>
      referenceCandidates(data.records, filter === "all" ? undefined : filter),
    [data.records, filter],
  );
  const chosen = candidates.find(
    (c) => c.record.id === selected?.recordId && c.index === selected.index,
  );
  const existing = chosen && data.references?.[chosen.record.exercise];
  const alreadySelected =
    !!chosen &&
    existing?.recordId === chosen.record.id &&
    existing.repIndex === chosen.index;
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const save = async () => {
    if (!chosen || saving || alreadySelected) return;
    setSaving(true);
    setError("");
    try {
      await persist((d) =>
        saveReferenceFromRecord(d, chosen.record.id, chosen.index),
      );
      onSaved(chosen.record.exercise, !!existing);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="reference-picker"
      aria-labelledby="reference-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <header className="reference-picker-heading">
        <div>
          <h2 id="reference-picker-title">
            {uiText(exercise
              ? `更换${EXERCISES[exercise].label}参考`
              : "从训练记录中选择")}
          </h2>
          <p>{uiText("只显示有可用轨迹数据的动作。选择一次后，再保存为参考。")}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={uiText("关闭参考动作选择")}
          disabled={saving}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="reference-picker-toolbar">
        <label>
          {uiText("训练动作")}
          <select
            aria-label={uiText("筛选参考动作")}
            disabled={saving || !!exercise}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as Exercise | "all");
              setSelected(null);
              setLimit(20);
              setError("");
            }}
          >
            <option value="all">{uiText("全部动作")}</option>
            {Object.entries(EXERCISES)
              .filter(([id]) => id !== "plank")
              .map(([id, spec]) => (
                <option key={id} value={id}>
                  {uiText(spec.label)}
                </option>
              ))}
          </select>
        </label>
        <span>{candidates.length}{uiText(" 次可选动作 · 最近训练在前")}</span>
      </div>
      <div
        className="reference-picker-list"
        role="radiogroup"
        aria-label={uiText("选择一次训练动作")}
        aria-busy={saving}
      >
        {!candidates.length && (
          <div className="reference-picker-empty">
            <FolderOpen size={28} strokeWidth={1.5} />
            <strong>
              {uiText(filter === "all"
                ? "暂无可用的动作轨迹"
                : `暂无${EXERCISES[filter].label}的可用轨迹`)}
            </strong>
            <p>
              {uiText(filter === "all"
                ? "先在「训练」页开启摄像头，完成并结束一组计次训练，再回来选择。"
                : `先完成并保存一组${EXERCISES[filter].label}训练，再回来选择。`)}
            </p>
            <small>
              {uiText("没有轨迹的旧记录、表格导入记录和持续计时的平板支撑无法作为对照样本。")}
            </small>
          </div>
        )}
        {candidates.slice(0, limit).map(({ record, rep, index }) => {
          const current = data.references?.[record.exercise];
          const isCurrent =
            current?.recordId === record.id && current.repIndex === index;
          const checked =
            selected?.recordId === record.id && selected.index === index;
          return (
            <label
              className={`reference-choice ${checked ? "selected" : ""}`}
              key={`${record.id}:${index}`}
            >
              <input
                type="radio"
                name="reference-rep"
                disabled={saving}
                checked={checked}
                onChange={() => {
                  setSelected({ recordId: record.id, index });
                  setError("");
                }}
              />
              <span className="reference-choice-title">
                <strong>
                  {uiText(EXERCISES[record.exercise].label)}{uiText(" · 第 ")}{index + 1}{uiText(" 次")}
                  {isCurrent && <em>{uiText("当前参考")}</em>}
                </strong>
                <small>
                  {dateText(record.startedAt, language)}
                  {uiText(record.setIndex !== undefined
                    ? ` · 第 ${record.setIndex} 组`
                    : "")}
                </small>
              </span>
              <span className="reference-choice-score">
                {uiText(rep.measured === false
                  ? "评分未测量"
                  : `${rep.score.toFixed(0)} 分`)}
                <small>{uiText("动作评分")}</small>
              </span>
            </label>
          );
        })}
        {candidates.length > limit && (
          <button
            className="reference-more"
            type="button"
            disabled={saving}
            onClick={() => setLimit((n) => n + 20)}
          >
            {uiText("显示更多动作（剩余 ")}{candidates.length - limit}{uiText(" 次）")}
          </button>
        )}
      </div>
      <footer className="reference-picker-footer">
        {error && <p role="alert">{uiText(error)}</p>}
        <p>
          {uiText(alreadySelected
            ? "这次动作已经是当前参考。"
            : chosen
              ? `${existing ? "将替换" : "将设置"}${EXERCISES[chosen.record.exercise].label}参考，仅用于之后完成的动作对比。`
              : "每种动作保留一份参考，保存后可在这里更换或删除。")}
        </p>
        <div>
          <button type="button" disabled={saving} onClick={onClose}>
            {uiText("取消")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={!chosen || saving || alreadySelected}
            onClick={() => void save()}
          >
            <Check size={16} />
            {uiText(saving ? "保存中…" : existing ? "更换参考动作" : "设为参考动作")}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
