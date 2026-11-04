import { useUiLocale } from "../i18n";
import { blockForMovement, blockName, blockUnit, type PlanBlock, type PlanCommand } from "../core/catalog-plan";
import { practiceMovements } from "../core/free-practice";
import { MovementPicker } from "./MovementPicker";
import { PlanAppearanceDialog, PlanBadge, type PlanAppearance } from "./PlanAppearance";
import type { LibrarySource } from "./MovementLibrary";
import { HistoryDateRange } from "./HistoryDateRange";
import { TimedRecordDetail } from "./TimedRecordDetail";
import { historyChoices, historySets, movementResults } from "../core/catalog-history";
import { primaryMovementSlugs } from "../core/movement-library";
import {
  recoverTimedCheckpoint,
  type TimedRecord,
} from "../core/timed-training";
import {
  filterHistory,
  progressByExercise,
  coverageByMuscle,
} from "../core/progress";
import { countingHints } from "../core/environment";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Dumbbell,
  FolderOpen,
  Heart,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import {
  Distribution,
  EmptyState,
  Metric,
  PageHeading as Heading,
  SectionHeading,
  TabNavigation,
  chartColors,
} from "./FeatureUI";
import { desktop, importFiles, exportFile, type Data } from "../platform";
import { moveToTrash, restoreTrash } from "../core/trash";
import { profileCopy } from "./profile-copy";
import {
  mergeImportedData,
  saveNamedPlan,
  saveProfileFact,
} from "../core/data-edits";
import { EXERCISES, FAULTS, type Exercise } from "../core/engine";
import {
  type Block,
  type Command,
  type Snapshot,
  type RecordRow,
} from "../core/session";
import {
  stats,
  recoverCheckpoint,
  activityOverview,
  importCSV,
  exportCSV,
  setSummary,
} from "../core/history";
import { categories, categoryNames } from "../core/knowledge";
import { dataSchema, defaultPlanColor, defaultPlanIcon, type SavedPlan } from "../core/data";
type Props = {
  data: Data;
  persist: (update: (d: Data) => Data) => Promise<void>;
  report: (e: unknown) => void;
};
const label = (e: string) => EXERCISES[e as Exercise]?.label ?? e;
const n = (v: number | null | undefined, d = 1) =>
  v == null ? "未测量" : v.toFixed(d);
const starterBlocks = (): PlanBlock[] => [
  { exercise: "squat", sets: 3, target: 12, rest: 60, load: 0 },
];
function nextPlanName(base: string, plans: SavedPlan[] = []) {
  const names = new Set(plans.map((plan) => plan.name));
  let name = base;
  for (let suffix = 2; names.has(name); suffix++) name = `${base} ${suffix}`;
  return name;
}
export function Planner({
  data,
  persist,
  report,
  control,
  state,
  library,
}: {
  control: (c: Command | PlanCommand) => Promise<void>;
  state: Snapshot;
  library: LibrarySource;
} & Props) {
  const { language, uiText, message } = useUiLocale();
  const [appearance, setAppearance] = useState<PlanAppearance | null>(null),
    [blocks, setBlocks] = useState<PlanBlock[]>(starterBlocks),
    [notice, setNotice] = useState("");
  const defaultIdentity = {
    name: nextPlanName(uiText("我的训练计划"), data.plans), icon: defaultPlanIcon, color: defaultPlanColor,
  };
  const identity = appearance ?? defaultIdentity;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [selection, setSelection] = useState<{ id: string; phase: "editing" | "saved" } | null>(null);
  const justSaved = selection?.phase === "saved";
  const [saving, setSaving] = useState(false);
  const identityButton = useRef<HTMLButtonElement>(null);
  const overview = useRef<HTMLElement>(null);
  const newPlan = () => {
    setSelection(null);
    setAppearance(null);
    setBlocks(starterBlocks());
    setNotice("");
  };
  const selectPlan = (plan: SavedPlan, mode: "load" | "edit") => {
    setSelection({ id: plan.id, phase: "editing" });
    setAppearance({ name: plan.name, icon: plan.icon ?? defaultPlanIcon, color: plan.color ?? defaultPlanColor });
    setBlocks(structuredClone(plan.blocks));
    setNotice("");
    if (mode === "load") overview.current?.focus();
    else identityButton.current?.focus();
  };
  const [starting, setStarting] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const revise = (nextBlocks: PlanBlock[], nextAppearance = identity) => {
    if (justSaved) setSelection(null);
    setAppearance(justSaved && nextAppearance.name === identity.name
      ? { ...nextAppearance, name: defaultIdentity.name }
      : nextAppearance);
    setBlocks(nextBlocks);
    setNotice("");
  };
  const change = (i: number, field: "sets" | "target" | "rest" | "load", value: number) => {
    if (blocks[i][field] !== value)
      revise(blocks.map((block, j) => j === i ? { ...block, [field]: value } : block));
  };
  const save = async () => {
    if (justSaved || saving) return;
    const selectedId = selection?.id ?? null;
    setSaving(true);
    setNotice("");
    try {
      let saved: SavedPlan | undefined;
      await persist((d) => {
        const name = identity.name.trim();
        const next = saveNamedPlan(d, name, blocks, { editingId: selectedId, icon: identity.icon, color: identity.color });
        saved = next.plans.find((p) => selectedId === null ? p.name === name : p.id === selectedId);
        return next;
      });
      if (saved) {
        setSelection({ id: saved.id, phase: "saved" });
        setAppearance({ ...identity, name: saved.name });
      }
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  };
  const removePlan = async (plan: SavedPlan) => {
    setSaving(true);
    try {
      await persist((d) => moveToTrash(d, { kind: "plan", id: plan.id }));
      if (selection?.id === plan.id) newPlan();
      setNotice(`「${plan.name}」已移入最近删除`);
    } catch (error) {
      report(error);
    } finally {
      setSaving(false);
    }
  };
  const setCount = blocks.reduce((sum, b) => sum + b.sets, 0);
  const repCount = blocks
    .filter((b) => blockUnit(b) === "reps")
    .reduce((sum, b) => sum + b.sets * b.target, 0);
  const holdCount = blocks
    .filter((b) => blockUnit(b) === "seconds")
    .reduce((sum, b) => sum + b.sets * b.target, 0);
  return (
    <main className="feature-page planner-page">
      <Heading
        title={uiText("训练计划")}
        sub={uiText("安排训练动作和组数，或载入已保存的计划。")}
      />
      <div className="planner-layout">
        <fieldset className="feature-panel plan-editor" aria-label={uiText("计划编辑器")} disabled={saving}>
          <div className="editor-heading">
            <button className="plan-identity-button" ref={identityButton}
              aria-haspopup="dialog" aria-label={message("编辑计划名称与图标，{0}", identity.name)}
              onClick={() => setAppearanceOpen(true)}>
              <PlanBadge icon={identity.icon} color={identity.color} />
              <strong>{identity.name}</strong>
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="plan-head">
            <span>{uiText("训练动作")}</span>
            <span>{uiText("组数")}</span>
            <span>{uiText("次数 / 秒")}</span>
            <span>{uiText("休息 / 秒")}</span>
            <span>{uiText("负重 / kg")}</span>
            <span />
          </div>
          {blocks.map((b, i) => (
            <div className="plan-row" key={i}>
              <div className="plan-exercise">
                <span className="exercise-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button className="plan-movement-button" aria-label={uiText(`更换动作${i+1}：${blockName(b)}`)} onClick={()=>setPicking(i)}>
                  <span>{uiText(blockName(b))}<small>{uiText(blockUnit(b)==="seconds" ? "每组按秒" : "每组按次")}</small></span><ChevronDown size={15}/>
                </button>
              </div>
              {(["sets", "target", "rest", "load"] as const).map((k, j) => (
                <label className="plan-number" key={k}>
                  <span>
                    {
                      uiText([
                        "组数",
                        blockUnit(b) === "seconds" ? "时长 / 秒" : "次数",
                        "休息 / 秒",
                        "负重 / kg",
                      ][j])
                    }
                  </span>
                  <input
                    type="number"
                    aria-label={language === "en" ? `Exercise ${i + 1}: ${k}` : `动作${i + 1}${k}`}
                    min={k === "rest" || k === "load" ? 0 : 1}
                    max={
                      k === "sets"
                        ? 20
                        : k === "load"
                          ? 500
                          : k === "rest"
                            ? 900
                            : blockUnit(b) === "seconds"
                              ? 600
                              : 100
                    }
                    value={b[k]}
                    onChange={(e) => change(i, k, Number(e.target.value))}
                  />
                </label>
              ))}
              <button
                className="icon-button remove-action"
                aria-label={uiText(`移除动作${i + 1}`)}
                disabled={blocks.length === 1}
                onClick={() => revise(blocks.filter((_, j) => i !== j))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            className="add-exercise"
            disabled={blocks.length >= 20}
            onClick={() => setPicking(blocks.length)}
          >
            <Plus size={17} />
            {uiText("添加动作")}<span>{uiText("最多 20 个")}</span>
          </button>
          <div className="editor-footer">
            <span className="muted" role="status">
              {notice || justSaved ? <Check size={15} /> : <ShieldCheck size={15} />}
              {uiText(notice || (justSaved ? "已保存。继续调整将创建新计划。" : selection ? "正在编辑原计划" : "新计划草稿"))}
            </span>
            <div className="plan-save-actions">
              <button disabled={saving || justSaved} onClick={() => void save()}>
                <Save size={16} />
                {uiText(justSaved ? "已保存" : "保存")}
              </button>
            </div>
          </div>
        </fieldset>
        <aside className="feature-panel plan-overview" ref={overview} tabIndex={-1} aria-label={uiText("本次训练")}>
          <SectionHeading
            title={<><PlanBadge icon={identity.icon} color={identity.color} />{uiText("本次训练")}</>}
            detail={identity.name}
          />
          <div className="plan-total">
            <strong>{String(setCount).padStart(2, "0")}</strong>
            <span>{uiText("训练组")}</span>
          </div>
          <div className="plan-summary-line">
            <span>{uiText("动作")}</span>
            <b>{blocks.length}{uiText(" 个")}</b>
          </div>
          <div className="plan-summary-line">
            <span>{uiText("目标次数")}</span>
            <b>{repCount}{uiText(" 次")}</b>
          </div>
          {holdCount > 0 && (
            <div className="plan-summary-line">
              <span>{uiText("目标时长")}</span>
              <b>{holdCount}{uiText(" 秒")}</b>
            </div>
          )}
          <div className="plan-sequence">
            {blocks.map((b, i) => (
              <div key={i}>
                <i
                  style={{ background: chartColors[i % chartColors.length] }}
                />
                <span>{uiText(blockName(b))}</span>
                <small>
                  {b.sets} × {b.target}
                  {uiText(blockUnit(b) === "seconds" ? "秒" : "次")}
                </small>
              </div>
            ))}
          </div>
          <button
            className="primary start-plan"
            disabled={state.status !== "ready" || starting}
            onClick={async () => {
              setStarting(true);
              try {
                const traditional = blocks.every((block): block is Block => "exercise" in block);
                if (traditional) await control({ type: "start_program", blocks });
                else await control({ type: "start_catalog_program", blocks });
              } catch (error) {
                report(error);
              } finally {
                setStarting(false);
              }
            }}
          >
            <Play size={16} fill="currentColor" />
            {uiText(starting ? "正在准备训练…" : "开始此计划")}
          </button>
          <p className="panel-note">
            {uiText(state.status !== "ready"
              ? "请先结束当前训练，再开始新计划。"
              : "每组达标后自动休息，也可点「完成本组」。做完一个动作的全部组数，休息后会切到下一个动作。")}
          </p>
        </aside>
      </div>
      <section className="feature-panel saved-plans">
        <SectionHeading
          title={uiText("已保存的计划")}
          detail={uiText(`${data.plans?.length ?? 0} 份计划`)}
        />
        {!data.plans?.length && (
          <EmptyState
            icon={FolderOpen}
            title={uiText("还没有保存的计划")}
            text={uiText("保存后，可在这里载入训练或编辑原计划。")}
          />
        )}
        {data.plans?.map((p) => (
          <div className="saved-plan-row" key={p.id} role="group" aria-label={p.name}>
            <PlanBadge icon={p.icon} color={p.color} />
            <div className="saved-plan-copy">
              <strong>{p.name}</strong>
              {selection?.id === p.id && (
                <span className="saved-plan-state">{uiText("当前计划")}</span>
              )}
              <p>
                {uiText(p.blocks
                  .map(
                    (b) =>
                      `${blockName(b)} ${b.sets}×${b.target}${blockUnit(b) === "seconds" ? "秒" : "次"}`,
                  )
                  .join(" · "))}
              </p>
            </div>
            <div className="saved-plan-actions">
              <button disabled={saving} onClick={() => selectPlan(p, "load")}>{uiText("载入")}</button>
              <button disabled={saving} onClick={() => selectPlan(p, "edit")}>{uiText("编辑")}</button>
              <button className="remove-action" disabled={saving} onClick={() => void removePlan(p)}>{uiText("删除")}</button>
            </div>
          </div>
        ))}
      </section>
      {appearanceOpen && (
        <PlanAppearanceDialog initial={identity}
          onCancel={() => setAppearanceOpen(false)}
          onApply={(value) => {
            if (value.name !== identity.name || value.icon !== identity.icon || value.color !== identity.color) {
              revise(blocks, value);
            }
            setAppearanceOpen(false);
          }}
        />
      )}
      {picking !== null && <MovementPicker mode="plan" {...library} favorites={practiceMovements(data)} onClose={()=>setPicking(null)}
        onSelect={item=>{
          const current = blocks[picking];
          const replacement = blockForMovement(item, current);
          if (!current || Object.entries(replacement).some(([key, value]) => Reflect.get(current, key) !== value)) {
            const next = blocks.slice();
            next[picking] = replacement;
            revise(next);
          }
          setPicking(null);
        }}/>}
      <RecentlyDeleted
        data={data}
        persist={persist}
        report={report}
        kinds={["plan"]}
        collapsible
      />
    </main>
  );
}

function Trend({
  values,
  label: description,
}: {
  values: (number | null)[];
  label: string;
}) {
  const { uiText } = useUiLocale();
  const finite = values.filter((v): v is number => v !== null),
    max = Math.max(1, ...finite);
  return (
    <div className="trend">
      <strong>{uiText(description)}</strong>
      {finite.length ? (
        <svg
          viewBox="0 0 600 90"
          role="img"
          aria-label={uiText(description + "，按时间从左至右")}
        >
          {values.map((v, i) =>
            v === null ? null : (
              <g key={i}>
                <rect
                  x={(i * 600) / Math.max(1, values.length) + 3}
                  y={75 - (v / max) * 60}
                  width={Math.max(2, 600 / Math.max(1, values.length) - 6)}
                  height={Math.max(1, (v / max) * 60)}
                  rx="3"
                  fill="var(--accent)"
                />
                <text
                  x={(i * 600) / Math.max(1, values.length) + 5}
                  y="88"
                  fontSize="10"
                  fill="#b8c1bb"
                >
                  {v.toFixed(1)}
                </text>
              </g>
            ),
          )}
        </svg>
      ) : (
        <p className="muted">{uiText("暂无测量数据")}</p>
      )}
    </div>
  );
}
function RecordDetail({ r, name }: { r: RecordRow; name: string }) {
  const { language, uiText } = useUiLocale();
  const s = stats(r);
  return (
    <details className="record-detail">
      <summary>
        <strong>{uiText(name)}</strong>
        <span data-label={uiText("训练时间")}>
          {new Date(r.startedAt).toLocaleString(language)}
        </span>
        <span data-label={uiText("完成情况")}>
          {uiText(!s.reps && !r.holdSeconds
            ? `记录时长 ${n(r.duration, 0)} 秒`
            : r.exercise === "plank"
            ? `${n(r.holdSeconds)}秒`
            : `${s.reps}次 · ${s.score === null ? "未测量" : n(s.score) + "分"}`)}
        </span>
        <span data-label={uiText("记录来源")}>
          {uiText(r.source === "Python"
            ? "旧版导入"
            : r.source === "CSV"
              ? "表格导入"
              : (r.source ?? "本机训练"))}
          {uiText(r.interrupted ? " · 中断保存" : "")}
        </span>
        <ChevronDown className="disclosure-icon" size={16} />
      </summary>
      <p>
        {uiText(s.reps || r.holdSeconds ? setSummary(r) : "本组未记录次数或保持时间。")}{uiText(" 训练时长 ")}{uiText(n(r.duration, 0))}{uiText(" 秒。")}{" "}
        {uiText(s.e1rm ? `估算1RM ${n(s.e1rm)}kg（Epley公式）` : "")}{" "}
        {uiText(s.fatigue ? `速度下降 ${n(s.fatigue * 100)}%` : "")}
      </p>
      {r.reps.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "次数",
                  "负重kg",
                  "评分",
                  "下放s",
                  "发力s",
                  "最低角度",
                  "纠错",
                ].map((h) => (
                  <th key={h}>{uiText(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.reps.map((rep, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{uiText(n(rep.load_kg ?? r.load))}</td>
                  <td title={uiText(rep.assessment?.note)}>
                    {uiText(rep.assessment?.limited
                      ? "局部评估"
                      : rep.measured === false
                        ? "未测量"
                        : n(rep.score, 0))}
                  </td>
                  <td>{uiText(rep.measured === false ? "—" : n(rep.eccentric_s))}</td>
                  <td>{uiText(rep.measured === false ? "—" : n(rep.concentric_s))}</td>
                  <td>{uiText(rep.measured === false ? "—" : n(rep.min_angle))}</td>
                  <td>
                    {uiText(rep.faults.map((f) => FAULTS[f]?.text ?? f).join("；") ||
                      "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
export function HistoryPanel({
  data,
  library,
}: Pick<Props, "data"> & { library: LibrarySource }) {
  const { uiText } = useUiLocale();
  const [recordMode, setRecordMode] = useState("all");
  const [exercise, setExercise] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [period, setPeriod] = useState("all");
  const allRows = useMemo(
    () => historySets(data.records, data.timedRecords ?? [], library.items),
    [data.records, data.timedRecords, library.items],
  );
  const choices = useMemo(
    () => historyChoices(library.items, allRows),
    [library.items, allRows],
  );
  const rows = useMemo(
    () =>
      filterHistory(allRows, {
        exercise: exercise === "all" ? undefined : exercise,
        from: from || undefined,
        to: to || undefined,
        period:
          period === "week"
            ? "this_week"
            : period === "month"
              ? "this_month"
              : undefined,
      }).filter(
        ({ record }) =>
          recordMode === "all" ||
          (recordMode === "automatic"
            ? "exercise" in record
            : "movementSlug" in record),
      ),
    [allRows, exercise, from, to, period, recordMode],
  );
  const totals = useMemo(() => activityOverview(rows), [rows]);
  const coverage = useMemo(
    () => coverageByMuscle(rows).filter((g) => g.sets),
    [rows],
  );
  const results = useMemo(() => movementResults(rows), [rows]);
  const records = useMemo(
    () => rows.flatMap(({ record }) => ("exercise" in record ? [record] : [])),
    [rows],
  );
  const quality = useMemo(
    () =>
      new Map(
        progressByExercise(records).map((p) => [
          primaryMovementSlugs[p.exercise as Exercise],
          p,
        ]),
      ),
    [records],
  );
  const assessments = useMemo(
    () =>
      records
        .map(stats)
        .filter(
          (s) =>
            s.score !== null ||
            s.tempo !== null ||
            Object.keys(s.faults).length,
        ),
    [records],
  );
  const faults = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const set of assessments)
      for (const [key, count] of Object.entries(set.faults))
        counts[key] = (counts[key] ?? 0) + count;
    return counts;
  }, [assessments]);
  const bests = results.filter((r) => r.series.some((s) => s.best > 0));
  return (
    <main className="feature-page history-page">
      <Heading
        title={uiText("训练记录")}
        sub={uiText("查看训练量、动作趋势和每组详情。")}
      />
      <TabNavigation
        label={uiText("记录类型")}
        value={recordMode}
        onChange={setRecordMode}
        items={[
          ["all", `全部记录 · ${allRows.length}`],
          ["automatic", `自动计数 / 姿态计时 · ${data.records.length}`],
          ["timed", `动作库统计 · ${data.timedRecords?.length ?? 0}`],
        ]}
      />

      <div className="history-toolbar">
        <select
          aria-label={uiText("筛选历史动作")}
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
        >
          <option value="all">{uiText("全部动作")}</option>
          {choices.recorded.length > 0 && (
            <optgroup label={uiText("有训练记录")}>
              {choices.recorded.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {uiText(name)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={uiText("动作库")}>
            {choices.remaining.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {uiText(name)}
              </option>
            ))}
          </optgroup>
        </select>
        <TabNavigation
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setFrom("");
            setTo("");
          }}
          items={[
            ["all", "全部"],
            ["month", "本月"],
            ["week", "本周"],
          ]}
          label={uiText("记录时间范围")}
        />
        <HistoryDateRange
          label={uiText("历史")}
          from={from}
          to={to}
          onChange={(start, end) => {
            setFrom(start);
            setTo(end);
            setPeriod("all");
          }}
        />
      </div>
      {library.failed && (
        <button onClick={library.reload}>{uiText("动作库未加载，重新加载")}</button>
      )}
      {from && to && from > to && <p role="alert">{uiText("开始日期不能晚于结束日期")}</p>}
      <div className="stats-overview history-overview">
        <Metric
          label={uiText("训练组")}
          value={totals.sets}
          unit="组"
          color={chartColors[0]}
        />
        <Metric
          label={uiText("训练天数")}
          value={totals.days}
          unit="天"
          color={chartColors[1]}
        />
        <Metric
          label={uiText("累计次数")}
          value={totals.reps}
          unit="次"
          color={chartColors[2]}
        />
        <Metric
          label={uiText("累计训练时长")}
          value={
            totals.seconds >= 60 ? n(totals.seconds / 60) : n(totals.seconds, 0)
          }
          unit={totals.seconds >= 60 ? "分钟" : "秒"}
          color={chartColors[4]}
        />
        <Metric
          label={uiText("负重训练量")}
          value={n(totals.volume)}
          unit="kg·次"
          color={chartColors[3]}
        />
      </div>
      <div className="history-charts">
        <section className="feature-panel activity-panel">
          <SectionHeading title={uiText("最近 12 周")} detail={uiText("训练组数")} />
          <div className="activity-chart">
            {!totals.weeks.some((w) => w.sets) && (
              <p className="chart-empty-label">
                {uiText("完成训练后，这里会留下你的节奏。")}
              </p>
            )}
            <div className="weeks">
              {totals.weeks.map((w) => (
                <div
                  key={w.start}
                  aria-label={uiText(`${w.start}起：${w.sets}组、${w.reps}次、训练${n(w.seconds)}秒`)}
                  title={uiText(`${w.start}起：${w.sets}组、${w.reps}次、${n(w.volume)}kg·次、训练${n(w.seconds)}秒`)}
                >
                  <div className="week-track">
                    <div
                      style={{
                        height: `${Math.max(w.sets ? 5 : 1.5, (w.sets / Math.max(1, ...totals.weeks.map((x) => x.sets))) * 100)}%`,
                      }}
                    />
                  </div>
                  <small>{uiText(w.start.slice(5))}</small>
                  <b>{w.sets}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="streak-summary">
            <span>
              <i
                className="legend-dot"
                style={{ background: chartColors[3] }}
              />
              {uiText("当前连续 ")}<b>{totals.current}</b>{uiText(" 天")}
            </span>
            <span>
              <Trophy size={14} />
              {uiText("最长连续 ")}<b>{totals.longest}</b>{uiText(" 天")}
            </span>
          </div>
        </section>
        <section className="feature-panel coverage-panel">
          <SectionHeading title={uiText("肌群训练分布")} detail={uiText("近 7 天")} />
          <Distribution groups={coverage} />
          <p className="panel-note">
            {uiText("按动作的主要肌群统计，一组可计入多个肌群。")}
          </p>
        </section>
      </div>
      <div className="two-columns">
        <section className="feature-panel">
          <SectionHeading title={uiText("动作趋势")} icon={Activity} />
          {!results.length ? (
            <EmptyState
              icon={Activity}
              title={uiText("暂无动作趋势")}
              text={uiText("有记录后，可以在这里对比每组次数或时长。")}
            />
          ) : (
            results.map((item) => {
              const p = quality.get(item.slug);
              return (
                <div className="progress-entry" key={item.slug}>
                  <div>
                    <strong>{uiText(item.name)}</strong>
                    <span>{item.sets}{uiText(" 组")}</span>
                  </div>
                  {item.series
                    .filter((s) => s.unit === "秒" || s.unit === "次")
                    .map((s) => (
                      <p key={s.label}>
                        {uiText(s.label)} ·{" "}
                        {s.recent.map((v) => +v.toFixed(1)).join(" → ")}{" "}
                        {uiText(s.unit)}
                      </p>
                    ))}
                  {!item.series.length && <p>{uiText("本组未记录次数或保持时间")}</p>}
                  {p?.scoreDelta != null && (
                    <p>
                      {uiText("平均动作分 ")}{p.previousScore} → {p.recentScore}（
                      {p.scoreDelta > 0 ? "+" : ""}
                      {p.scoreDelta}）
                    </p>
                  )}
                  {p?.recentTempo != null && (
                    <p>{uiText("近期平均下放 ")}{p.recentTempo}{uiText(" 秒")}</p>
                  )}
                  {!!p?.topFaults.length && (
                    <small>{uiText("常见提醒：")}{uiText(p.topFaults[0].text)}</small>
                  )}
                </div>
              );
            })
          )}
          <p className="panel-note">
            {uiText("次数与时长展示最近三组同类记录。评分比较最近三组与此前三组有评分的记录。")}
          </p>
        </section>
        <section className="feature-panel">
          <SectionHeading title={uiText("个人纪录")} icon={Trophy} />
          {!bests.length ? (
            <EmptyState
              icon={Trophy}
              title={uiText("暂无个人纪录")}
              text={uiText("记录次数、保持时间或训练时长后，可在这里查看各动作的单组最佳。")}
            />
          ) : (
            bests.map((item) => (
              <div className="personal-record-row" key={item.slug}>
                <span className="list-icon">
                  <Dumbbell size={18} />
                </span>
                <div>
                  <strong>{uiText(item.name)}</strong>
                  <p>
                    {item.series
                      .filter((s) => s.best > 0)
                      .map((s) => `${s.label} ${+s.best.toFixed(1)} ${s.unit}`)
                      .join(" · ")}
                  </p>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
      {rows.length > 0 && (
        <section className="feature-panel">
          <Trend label={uiText("最近 20 组训练时长（秒）")} values={rows.slice(-20).map((row) => row.seconds)} />
        </section>
      )}
      {assessments.length > 0 && (
        <div className="two-columns">
          <section className="feature-panel">
            <Trend
              label={uiText("最近 20 组动作评分")}
              values={assessments.slice(-20).map((s) => s.score)}
            />
            <Trend
              label={uiText("最近 20 组平均下放秒数")}
              values={assessments.slice(-20).map((s) => s.tempo)}
            />
          </section>
          <section className="feature-panel">
            <SectionHeading title={uiText("纠错记录")} icon={CircleHelp} />
            {Object.entries(faults)
              .sort((a, b) => b[1] - a[1])
              .map(([f, count]) => (
                <p className="feature-row" key={f}>
                  <span>{uiText(FAULTS[f]?.text ?? f)}</span>
                  <strong>{count}{uiText(" 次")}</strong>
                </p>
              ))}
            {!Object.keys(faults).length && (
              <EmptyState icon={Check} title={uiText("暂无已记录错误")} />
            )}
          </section>
        </div>
      )}
      <section className="feature-panel record-list-panel">
        <SectionHeading title={uiText("每组详情")} detail={uiText(`${rows.length} 条记录`)} />
        {rows.length > 0 && (
          <div className="record-list-heading" aria-hidden="true">
            <span>{uiText("训练动作")}</span>
            <span>{uiText("训练时间")}</span>
            <span>{uiText("完成情况")}</span>
            <span>{uiText("记录来源")}</span>
            <span />
          </div>
        )}
        {!rows.length && (
          <EmptyState
            icon={ListChecks}
            title={
              uiText(allRows.length ? "没有符合筛选条件的记录" : "每一组，都值得记录")
            }
            text={
              allRows.length
                ? "试试其他动作或日期范围；选择「全部」可清除日期限制。"
                : "完成训练或导入旧记录后，会显示在这里。"
            }
          />
        )}
        {[...rows]
          .reverse()
          .map(({ record, name }) =>
            "exercise" in record ? (
              <RecordDetail key={"pose-" + record.id} r={record} name={name} />
            ) : (
              <TimedRecordDetail
                key={"catalog-" + record.id}
                r={record}
                name={name}
              />
            ),
          )}
      </section>
      <p className="page-footnote">
        {uiText("累计次数优先采用手动修正值，没有修正时使用本组记录的计数。只计时的组计入时长和组数。")}
      </p>
    </main>
  );
}

export function ProfilePanel({ data, persist, report }: Props) {
  const { uiText, message } = useUiLocale();
  const [saving, setSaving] = useState(false);
  const [category, setCategory] =
    useState<(typeof categories)[number]>("goals");
  const [draft, setDraft] = useState<{
    key: string;
    value: string;
    editingKey?: string;
    custom: boolean;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const guide = profileCopy[category];
  const facts = (data.profile ?? []).filter((f) => f.category === category);
  const firstFact = facts.find((f) => f.key === guide.topics[0].key);
  const editor = draft ?? {
    key: guide.topics[0].key,
    value: firstFact?.value ?? "",
    editingKey: firstFact?.key,
    custom: false,
  };
  const { key, value, editingKey, custom } = editor;
  const savedFact = facts.find((f) => f.key === editingKey);
  const changed =
    !savedFact ||
    key.trim() !== savedFact.key ||
    value.trim() !== savedFact.value;
  const topic = guide.topics.find((t) => t.key === key);
  const contentInput = useRef<HTMLTextAreaElement>(null);
  const chooseTopic = (topicKey: string) => {
    const saved = facts.find((f) => f.key === topicKey);
    setDraft({
      key: topicKey,
      value: saved?.value ?? "",
      editingKey: saved?.key,
      custom: false,
    });
    setNotice("");
  };
  const save = async () => {
    setNotice("");
    setSaving(true);
    try {
      await persist((d) =>
        saveProfileFact(
          d,
          { category, key, value },
          editingKey === undefined ? undefined : { category, key: editingKey },
        ),
      );
      setDraft({
        key: key.trim(),
        value: value.trim(),
        editingKey: key.trim(),
        custom,
      });
      setNotice("已保存，教练会在之后的对话中参考");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  };
  const categoryIcons = [
    UserRound,
    Heart,
    Target,
    ShieldCheck,
    Dumbbell,
    CalendarDays,
    Heart,
    CircleHelp,
  ];
  return (
    <main className="feature-page profile-page">
      <Heading
        title={uiText("我的资料")}
        sub={uiText("按需填写目标和偏好，供教练在对话中参考。")}
        extra={
          <span className="page-meta">
            <UserRound size={16} />
            {uiText("已记住 ")}{data.profile?.length ?? 0}{uiText(" 条信息")}
          </span>
        }
      />
      <div className="profile-layout">
        <aside className="profile-sidebar" aria-label={uiText("资料分类")}>
          {categories.map((c, i) => {
            const Icon = categoryIcons[i];
            return (
              <button
                key={c}
                className={category === c ? "active" : ""}
                aria-pressed={category === c}
                disabled={saving}
                onClick={() => {
                  if (c === category) return;
                  setCategory(c);
                  setDraft(null);
                  setNotice("");
                }}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{uiText(profileCopy[c].label)}</span>
                <small>
                  {uiText(data.profile?.filter((f) => f.category === c).length || "")}
                </small>
                <ChevronRight size={14} />
              </button>
            );
          })}
          <p className="sidebar-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              <strong>{uiText("资料选填")}</strong>
              {uiText("只写你愿意分享的内容。")}
            </span>
          </p>
        </aside>
        <div className="profile-content">
          <section className="feature-panel profile-editor">
            <SectionHeading
              title={uiText(guide.label)}
              detail={
                uiText(editingKey === undefined ? "添加一条信息" : "已保存，可随时更新")
              }
            />
            <p className="profile-category-intro">{uiText(guide.description)}</p>
            <div
              className="profile-topics"
              role="group"
              aria-label={uiText(`${guide.label}话题`)}
            >
              {guide.topics.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  disabled={saving}
                  aria-pressed={!custom && key === t.key}
                  onClick={() => chooseTopic(t.key)}
                >
                  {uiText(t.key)}
                </button>
              ))}
              <button
                type="button"
                disabled={saving}
                aria-pressed={custom}
                onClick={() => {
                  setDraft({ key: "", value: "", custom: true });
                  setNotice("");
                }}
              >
                <Plus size={14} />
                {uiText("自定义")}
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {custom && (
                <label className="form-field profile-topic-name">
                  {uiText("给这条信息起个名字")}
                  <input
                    aria-label={uiText("信息名称")}
                    placeholder={uiText(`例如：${guide.topics[0].key}`)}
                    value={key}
                    maxLength={80}
                    required
                    disabled={saving}
                    onChange={(e) => {
                      setDraft({ ...editor, key: e.target.value });
                      setNotice("");
                    }}
                  />
                </label>
              )}
              <label className="form-field profile-answer">
                {uiText(custom ? "有什么想让教练了解的？" : topic?.question)}
                <textarea
                  ref={contentInput}
                  aria-label={uiText("告诉教练")}
                  aria-describedby="profile-answer-hint"
                  placeholder={
                    uiText(custom
                      ? `用自己的话写下来。${guide.topics[0].example}`
                      : topic?.example)
                  }
                  value={value}
                  maxLength={800}
                  required
                  rows={4}
                  disabled={saving}
                  onChange={(e) => {
                    setDraft({ ...editor, value: e.target.value });
                    setNotice("");
                  }}
                />
              </label>
              <p className="profile-answer-hint" id="profile-answer-hint">
                <span>{uiText("如何使用")}</span>
                {uiText(guide.use)}
              </p>
              <div className="editor-footer">
                <span role="status" className="success-notice">
                  {notice && (
                    <>
                      <Check size={15} />
                      {uiText(notice)}
                    </>
                  )}
                </span>
                {editingKey !== undefined && draft && (changed || custom) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDraft(
                        savedFact
                          ? {
                              key: savedFact.key,
                              value: savedFact.value,
                              editingKey: savedFact.key,
                              custom: !guide.topics.some(
                                (t) => t.key === savedFact.key,
                              ),
                            }
                          : null,
                      );
                      setNotice("");
                    }}
                  >
                    {uiText("取消修改")}
                  </button>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={saving || !key.trim() || !value.trim() || !changed}
                >
                  <Check size={16} />
                  {uiText(saving
                    ? "保存中…"
                    : editingKey === undefined
                      ? "记住这条信息"
                      : "保存修改")}
                </button>
              </div>
            </form>
          </section>
          <section className="feature-panel profile-facts">
            <SectionHeading
              title={uiText("教练已记住")}
              detail={uiText(`${guide.label} · ${facts.length} 条`)}
            />
            {!facts.length && (
              <p className="profile-empty-note">
                {message("还没有关于{0}的信息。在上方写下并保存，之后对话时教练就能参考。", uiText(guide.label))}
              </p>
            )}
            {facts.map((f) => (
              <article className="fact-row" key={f.category + ":" + f.key}>
                <div>
                  <strong>{f.key}</strong>
                  <p>{f.value}</p>
                </div>
                <div className="row-actions">
                  <button
                    disabled={saving}
                    onClick={() => {
                      setDraft({
                        key: f.key,
                        value: f.value,
                        editingKey: f.key,
                        custom: true,
                      });
                      setNotice("");
                      contentInput.current?.focus();
                    }}
                  >
                    {uiText("修改")}
                  </button>
                  <button
                    className="icon-button remove-action"
                    aria-label={message("遗忘{0}", f.key)}
                    disabled={saving}
                    onClick={() =>
                      void persist((d) =>
                        moveToTrash(d, {
                          kind: "profile",
                          category: f.category,
                          key: f.key,
                        }),
                      )
                        .then(() => {
                          if (editingKey === f.key) {
                            setDraft(null);
                          }
                          setNotice(
                            "信息已移入「最近删除」，之后的教练请求不再携带这条信息。",
                          );
                        })
                        .catch(report)
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </section>
          <p className="privacy-note">
            <ShieldCheck size={17} />
            <span>
              {uiText("信息保存在本机，对话时会发送给你配置的 AI 服务。你可以随时修改或删除。")}
            </span>
          </p>
        </div>
      </div>
      <RecentlyDeleted
        data={data}
        persist={persist}
        report={report}
        kinds={["profile", "reference"]}
      />
    </main>
  );
}

export { LibraryPanel } from "./MovementLibrary";

function RecentlyDeleted({
  data,
  persist,
  report,
  kinds,
  collapsible = false,
}: Props & { kinds: string[]; collapsible?: boolean }) {
  const { language, uiText, message } = useUiLocale();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = [...(data.trash ?? [])]
    .reverse()
    .filter((e) => kinds.includes(e.kind));
  if (!entries.length && !notice && !busy) return null;
  const updateTrash = async (id: string, restore: boolean) => {
    setBusy(true);
    setNotice("");
    try {
      await persist((d) =>
        restore
          ? restoreTrash(d, id)
          : { ...d, trash: d.trash?.filter((entry) => entry.id !== id) },
      );
      setNotice(
        restore
          ? "已恢复，可以在原来的列表中继续使用。"
          : "已永久删除所选内容。",
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const Panel = collapsible ? "details" : "section";
  return (
    <Panel className="feature-panel recently-deleted" aria-label={uiText("最近删除")}>
      {collapsible ? (
        <summary className="trash-disclosure">
          <h2>
            <Trash2 size={18} aria-hidden="true" />
            {uiText("最近删除 ")}<small>{entries.length}{uiText(" 项")}</small>
            <ChevronDown
              className="disclosure-icon"
              size={16}
              aria-hidden="true"
            />
          </h2>
        </summary>
      ) : (
        <SectionHeading
          title={uiText("最近删除")}
          detail={uiText(`${entries.length} 项`)}
          icon={Trash2}
        />
      )}
      <p className="trash-help">
        {uiText("这里的内容不会用于训练或教练回复。可恢复到原处，永久删除后无法找回。")}
      </p>
      {!entries.length && <p className="trash-empty">{uiText("暂无已删除内容")}</p>}
      {entries.map((entry) => {
        const title =
          entry.kind === "plan"
            ? entry.value.name
            : entry.kind === "profile"
              ? entry.value.key
              : `${label(entry.exercise)}参考动作`;
        const deleted = new Date(entry.deletedAt);
        return (
          <div className="deleted-item" key={entry.id}>
            <div className="deleted-row">
              <div className="deleted-info">
                <strong>{entry.kind === "reference" ? uiText(title) : title}</strong>
                <div className="deleted-meta">
                  <span>
                    {uiText(entry.kind === "plan"
                      ? "训练计划"
                      : entry.kind === "profile"
                        ? categoryNames[entry.value.category]
                        : "参考动作")}
                  </span>
                  {Number.isFinite(deleted.getTime()) && (
                    <time dateTime={entry.deletedAt}>
                      {deleted.toLocaleString(language, {
                        dateStyle: "long",
                        timeStyle: "short",
                        hour12: false,
                      })}{" "}
                      {uiText("删除")}
                    </time>
                  )}
                </div>
              </div>
              <div className="deleted-actions">
                <button
                  disabled={busy}
                  aria-label={message("恢复{0}", entry.kind === "reference" ? uiText(title) : title)}
                  onClick={() => void updateTrash(entry.id, true)}
                >
                  {uiText("恢复")}
                </button>
                <button
                  className="trash-remove"
                  disabled={busy}
                  aria-label={message("永久删除{0}", entry.kind === "reference" ? uiText(title) : title)}
                  onClick={() => void updateTrash(entry.id, false)}
                >
                  {uiText("永久删除")}
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <p className="success-notice" role="status">
        {uiText(notice)}
      </p>
    </Panel>
  );
}

export function DataPanel({ data, persist, report }: Props) {
  const { uiText } = useUiLocale();
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const importing = async (kind: "csv" | "backup") => {
    setBusy(true);
    setNotice("");
    try {
      const files = await importFiles(kind);
      if (!files) return;
      let incoming: RecordRow[] = [],
        timedRecords: TimedRecord[] = [],
        profile: NonNullable<Data["profile"]> = [],
        references: Data["references"] = {},
        plans: NonNullable<Data["plans"]> = [],
        trash: NonNullable<Data["trash"]> = [],
        homeShortcuts: string[] | undefined,
        practiceSlugs: string[] = [],
        hasPracticeList = false,
        skipped: string[] = [];
      for (const f of files) {
        if (kind === "backup") {
          const backup = recoverTimedCheckpoint(
            recoverCheckpoint(dataSchema.parse(JSON.parse(f.text!))),
          );
          homeShortcuts ??= backup.homeShortcuts;
          timedRecords.push(...(backup.timedRecords ?? []));
          trash.push(...(backup.trash ?? []));
          if (backup.freePractice) {
            hasPracticeList = true;
            practiceSlugs.push(...backup.freePractice.movementSlugs);
          }
          incoming.push(...backup.records);
          for (const fact of backup.profile ?? [])
            if (
              !profile.some(
                (p) => p.category === fact.category && p.key === fact.key,
              )
            )
              profile.push(fact);
          references = { ...backup.references, ...references };
          for (const plan of backup.plans ?? [])
            if (!plans.some((p) => p.id === plan.id)) plans.push(plan);
        } else {
          const result = importCSV(f.text!);
          incoming.push(...result.records);
          skipped.push(...result.skipped);
        }
      }
      let message = "";
      await persist((d) => {
        const merged = mergeImportedData(d, {
          records: incoming,
          homeShortcuts,
          timedRecords,
          profile,
          plans,
          references,
          trash,
          freePractice: hasPracticeList
            ? { movementSlugs: [...new Set(practiceSlugs)] }
            : undefined,
        });
        message = merged.message;
        return merged.data;
      });
      setNotice(
        `${message}${skipped.length ? `另有 ${skipped.length} 项未导入：\n${skipped.slice(0, 20).join("\n")}` : ""}`,
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const exporting = async (kind: "json" | "strong" | "hevy") => {
    setBusy(true);
    setNotice("");
    try {
      const ok = await exportFile(
        `open-fitness-training-${new Date().toISOString().slice(0, 10)}.${kind === "json" ? "json" : "csv"}`,
        kind === "json"
          ? JSON.stringify(data, null, 2)
          : exportCSV(data.records, kind),
      );
      if (ok)
        setNotice(
          desktop ? "文件已导出" : "已开始下载，请在浏览器下载列表中查看文件。",
        );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="feature-panel data-panel">
      <SectionHeading
        title={uiText("训练数据与备份")}
        icon={FolderOpen}
        detail={uiText(`${data.records.length + (data.timedRecords?.length ?? 0)} 条训练记录`)}
      />
      <p className="muted">{uiText("给每一次训练，留一份安心的备份。")}</p>
      {!desktop && (
        <p className="privacy-note">
          <CircleHelp size={16} />
          {uiText("文件在浏览器本机读取，不会上传。导出完整 JSON 备份后，可以在桌面端导入；桌面端备份也可以在这里导入。设备设置各自保留。")}
        </p>
      )}
      <div className="data-action-row">
        <span className="list-icon">
          <ArrowDownToLine size={21} />
        </span>
        <div>
          <h3>{uiText("导入训练数据")}</h3>
          <p>
            {uiText("从备份恢复数据，或导入 Strong / Hevy 的训练记录。重复记录会自动去重，保留本机设备设置与同名资料。")}
          </p>
          <div className="feature-row">
            {(["backup", "csv"] as const).map((k) => (
              <button key={k} disabled={busy} onClick={() => void importing(k)}>
                {uiText(k === "backup" ? "导入完整备份" : "导入 Strong / Hevy CSV")}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="data-action-row">
        <span className="list-icon purple-icon">
          <ArrowUpFromLine size={21} />
        </span>
        <div>
          <h3>{uiText("导出与备份")}</h3>
          <p>
            {uiText("完整备份（JSON）包含自动计数、动作库统计、手动修正、常练动作、首页快捷动作、资料、计划和最近删除，适合备份或换设备。Strong / Hevy CSV 仅导出原有自动计数与姿态计时记录；动作库统计请使用完整备份保存。")}
          </p>
          <div className="feature-row">
            {(["json", "strong", "hevy"] as const).map((k) => (
              <button key={k} disabled={busy} onClick={() => void exporting(k)}>
                {uiText("导出")}{" "}
                {uiText(k === "json"
                  ? "完整备份"
                  : k === "strong"
                    ? "Strong CSV"
                    : "Hevy CSV")}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="success-notice" role="status">
        {uiText(notice)}
      </p>
    </section>
  );
}

export function TrainingDetails({
  state,
  control,
}: {
  state: Snapshot;
  control: (c: Command) => Promise<void>;
}) {
  const { uiText } = useUiLocale();
  const spec = EXERCISES[state.exercise];
  return (
    <div className="training-details">
      <div className="feature-panel" aria-label={uiText("拍摄与计数检查")}>
        <strong>{uiText("拍摄与计数检查")}</strong>
        {countingHints(state).map((hint) => (
          <p key={hint}>{uiText(hint)}</p>
        ))}
        {state.environment && (
          <small className="muted">
            {uiText(state.environment.cameraHint)} ·{" "}
            {uiText(state.environment.brightness === null
              ? "光线检测中"
              : `画面亮度 ${Math.round(state.environment.brightness * 100)}%`)}
          </small>
        )}
      </div>
      {state.catalogPlan && (
        <div className="feature-row">
          <strong>{uiText("计划 · 动作 ")}{state.catalogPlan.block+1}/{state.catalogPlan.blocks}{uiText(" · 第 ")}{state.catalogPlan.set}/{state.catalogPlan.sets}{uiText(" 组")}</strong>
        </div>
      )}
      {state.program && (
        <div className="feature-row">
          <strong>
            {uiText("计划：第 ")}{state.program.block + 1}/{state.program.blocks.length}{uiText(" 个动作 · 第 ")}{state.program.set}/
            {state.program.blocks[state.program.block].sets}{uiText(" 组")}
            {uiText(state.status === "resting" ? `，下一组 ${label(state.program.blocks[state.program.block].exercise)}` : "")}
          </strong>
          <button onClick={() => void control({ type: "stop_program" })}>{uiText("结束计划")}</button>
        </div>
      )}
      <div className="feature-row">
        <span>
          {uiText("阶段：")}
          {
            uiText((
              {
                IDLE: "准备",
                DESCENT: "下放",
                BOTTOM: "底部",
                ASCENT: "抬起",
              } as Record<string, string>
            )[state.phase])
          }
        </span>
        <span>
          {uiText(spec.signal)}：{uiText(n(state.angles[spec.signal], 0))}°
        </span>
        {state.exercise !== "plank" && (
          <span className="muted">
            {uiText("开始 < ")}{spec.start}{uiText("° · 底部 < ")}{spec.bottom}{uiText("° · 回位 >")}{" "}
            {spec.lockout}°
          </span>
        )}
        <span>{uiText("速度下降 ")}{uiText(n(state.fatigue * 100, 0))}%</span>

      </div>
      {state.exercise === "plank" && (
        <div className="feature-row">
          <span>{uiText("本组最长连续 ")}{uiText(n(state.holdBest))}{uiText("秒")}</span>
        </div>
      )}
    </div>
  );
}
