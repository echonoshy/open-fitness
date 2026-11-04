import { blockForMovement, blockName, blockUnit, type PlanBlock, type PlanCommand } from "../core/catalog-plan";
import { practiceMovements } from "../core/free-practice";
import { MovementPicker } from "./MovementPicker";
import { PlanAppearanceDialog, PlanBadge, type PlanAppearance } from "./PlanAppearance";
import type { LibrarySource } from "./MovementLibrary";
import { HistoryDateRange } from "./HistoryDateRange";
import { TimedHistory } from "./TimedHistory";
import {
  recoverTimedCheckpoint,
  type TimedRecord,
} from "../core/timed-training";
import {
  filterHistory,
  progressByExercise,
  muscleCoverage,
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
  MessageCircle,
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
  overview,
  personalRecords,
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
function nextPlanName(plans: SavedPlan[] = []) {
  const base = "我的训练计划";
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
  const [appearance, setAppearance] = useState<PlanAppearance | null>(null),
    [blocks, setBlocks] = useState<PlanBlock[]>(starterBlocks),
    [notice, setNotice] = useState("");
  const defaultIdentity = {
    name: nextPlanName(data.plans), icon: defaultPlanIcon, color: defaultPlanColor,
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
        title="训练计划"
        sub="安排训练动作和组数，或载入已保存的计划。"
      />
      <div className="planner-layout">
        <fieldset className="feature-panel plan-editor" aria-label="计划编辑器" disabled={saving}>
          <div className="editor-heading">
            <button className="plan-identity-button" ref={identityButton}
              aria-haspopup="dialog" aria-label={`编辑计划名称与图标，${identity.name}`}
              onClick={() => setAppearanceOpen(true)}>
              <PlanBadge icon={identity.icon} color={identity.color} />
              <strong>{identity.name}</strong>
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="plan-head">
            <span>训练动作</span>
            <span>组数</span>
            <span>次数 / 秒</span>
            <span>休息 / 秒</span>
            <span>负重 / kg</span>
            <span />
          </div>
          {blocks.map((b, i) => (
            <div className="plan-row" key={i}>
              <div className="plan-exercise">
                <span className="exercise-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button className="plan-movement-button" aria-label={`更换动作${i+1}：${blockName(b)}`} onClick={()=>setPicking(i)}>
                  <span>{blockName(b)}<small>{blockUnit(b)==="seconds" ? "每组按秒" : "每组按次"}</small></span><ChevronDown size={15}/>
                </button>
              </div>
              {(["sets", "target", "rest", "load"] as const).map((k, j) => (
                <label className="plan-number" key={k}>
                  <span>
                    {
                      [
                        "组数",
                        blockUnit(b) === "seconds" ? "时长 / 秒" : "次数",
                        "休息 / 秒",
                        "负重 / kg",
                      ][j]
                    }
                  </span>
                  <input
                    type="number"
                    aria-label={`动作${i + 1}${k}`}
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
                aria-label={`移除动作${i + 1}`}
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
            添加动作<span>最多 20 个</span>
          </button>
          <div className="editor-footer">
            <span className="muted" role="status">
              {notice || justSaved ? <Check size={15} /> : <ShieldCheck size={15} />}
              {notice || (justSaved ? "已保存。继续调整将创建新计划。" : selection ? "正在编辑原计划" : "新计划草稿")}
            </span>
            <div className="plan-save-actions">
              <button disabled={saving || justSaved} onClick={() => void save()}>
                <Save size={16} />
                {justSaved ? "已保存" : "保存"}
              </button>
            </div>
          </div>
        </fieldset>
        <aside className="feature-panel plan-overview" ref={overview} tabIndex={-1} aria-label="本次训练">
          <SectionHeading
            title={<><PlanBadge icon={identity.icon} color={identity.color} />本次训练</>}
            detail={identity.name}
          />
          <div className="plan-total">
            <strong>{String(setCount).padStart(2, "0")}</strong>
            <span>训练组</span>
          </div>
          <div className="plan-summary-line">
            <span>动作</span>
            <b>{blocks.length} 个</b>
          </div>
          <div className="plan-summary-line">
            <span>目标次数</span>
            <b>{repCount} 次</b>
          </div>
          {holdCount > 0 && (
            <div className="plan-summary-line">
              <span>目标时长</span>
              <b>{holdCount} 秒</b>
            </div>
          )}
          <div className="plan-sequence">
            {blocks.map((b, i) => (
              <div key={i}>
                <i
                  style={{ background: chartColors[i % chartColors.length] }}
                />
                <span>{blockName(b)}</span>
                <small>
                  {b.sets} × {b.target}
                  {blockUnit(b) === "seconds" ? "秒" : "次"}
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
            {starting ? "正在准备训练…" : "开始此计划"}
          </button>
          <p className="panel-note">
            {state.status !== "ready"
              ? "请先结束当前训练，再开始新计划。"
              : "每组达标后自动休息，也可点「完成本组」。做完一个动作的全部组数，休息后会切到下一个动作。"}
          </p>
        </aside>
      </div>
      <section className="feature-panel saved-plans">
        <SectionHeading
          title="已保存的计划"
          detail={`${data.plans?.length ?? 0} 份计划`}
        />
        {!data.plans?.length && (
          <EmptyState
            icon={FolderOpen}
            title="还没有保存的计划"
            text="保存后，可在这里载入训练或编辑原计划。"
          />
        )}
        {data.plans?.map((p) => (
          <div className="saved-plan-row" key={p.id} role="group" aria-label={p.name}>
            <PlanBadge icon={p.icon} color={p.color} />
            <div className="saved-plan-copy">
              <strong>{p.name}</strong>
              {selection?.id === p.id && (
                <span className="saved-plan-state">当前计划</span>
              )}
              <p>
                {p.blocks
                  .map(
                    (b) =>
                      `${blockName(b)} ${b.sets}×${b.target}${blockUnit(b) === "seconds" ? "秒" : "次"}`,
                  )
                  .join(" · ")}
              </p>
            </div>
            <div className="saved-plan-actions">
              <button disabled={saving} onClick={() => selectPlan(p, "load")}>载入</button>
              <button disabled={saving} onClick={() => selectPlan(p, "edit")}>编辑</button>
              <button className="remove-action" disabled={saving} onClick={() => void removePlan(p)}>删除</button>
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
  const finite = values.filter((v): v is number => v !== null),
    max = Math.max(1, ...finite);
  return (
    <div className="trend">
      <strong>{description}</strong>
      {finite.length ? (
        <svg
          viewBox="0 0 600 90"
          role="img"
          aria-label={description + "，按时间从左至右"}
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
                  fill="#c9ed89"
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
        <p className="muted">暂无测量数据</p>
      )}
    </div>
  );
}
function RecordDetail({r}: {r: RecordRow}) {
  const s = stats(r);
  return (
    <details className="record-detail">
      <summary>
        <strong>{label(r.exercise)}</strong>
        <span data-label="训练时间">
          {new Date(r.startedAt).toLocaleString("zh-CN")}
        </span>
        <span data-label="完成情况">
          {r.exercise === "plank"
            ? `${n(r.holdSeconds)}秒`
            : `${s.reps}次 · ${s.score === null ? "未测量" : n(s.score) + "分"}`}
        </span>
        <span data-label="记录来源">
          {r.source === "Python"
            ? "旧版导入"
            : r.source === "CSV"
              ? "表格导入"
              : (r.source ?? "本机训练")}
          {r.interrupted ? " · 中断保存" : ""}
        </span>
        <ChevronDown className="disclosure-icon" size={16} />
      </summary>
      <p>
        {setSummary(r)} {s.e1rm ? `估算1RM ${n(s.e1rm)}kg（Epley公式）` : ""}{" "}
        {s.fatigue ? `速度下降 ${n(s.fatigue * 100)}%` : ""}
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
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.reps.map((rep, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{n(rep.load_kg ?? r.load)}</td>
                  <td title={rep.assessment?.note}>
                    {rep.assessment?.limited
                      ? "局部评估"
                      : rep.measured === false
                        ? "未测量"
                        : n(rep.score, 0)}
                  </td>
                  <td>{rep.measured === false ? "—" : n(rep.eccentric_s)}</td>
                  <td>{rep.measured === false ? "—" : n(rep.concentric_s)}</td>
                  <td>{rep.measured === false ? "—" : n(rep.min_angle)}</td>
                  <td>
                    {rep.faults.map((f) => FAULTS[f]?.text ?? f).join("；") ||
                      "—"}
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
export function HistoryPanel({ data }: Pick<Props,"data">) {
  const [recordMode, setRecordMode] = useState("automatic");
  const [exercise, setExercise] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [period, setPeriod] = useState("all");
  const records = useMemo(
    () =>
      filterHistory(data.records, {
        exercise: exercise === "all" ? undefined : exercise,
        from: from || undefined,
        to: to || undefined,
        period:
          period === "week"
            ? "this_week"
            : period === "month"
              ? "this_month"
              : undefined,
      }),
    [data.records, exercise, from, to, period],
  );
  const progress = useMemo(() => progressByExercise(records), [records]),
    coverage = useMemo(() => muscleCoverage(records), [records]);
  const totals = useMemo(() => overview(records), [records]),
    prs = useMemo(() => personalRecords(records), [records]);
  return (
    <main className="feature-page history-page">
      <Heading
        title="训练记录"
        sub="查看训练量、动作趋势和每组详情。"
        extra={
          <span className="page-meta">
            <CalendarDays size={16} />
            训练记录
          </span>
        }
      />
      <TabNavigation
        label="记录类型"
        value={recordMode}
        onChange={setRecordMode}
        items={[
          ["automatic", `自动计数 / 姿态计时 · ${data.records.length}`],
          ["timed", `动作库统计 · ${data.timedRecords?.length ?? 0}`],
        ]}
      />
      {recordMode === "timed" ? (
        <TimedHistory records={data.timedRecords ?? []} />
      ) : (
        <>
          <div className="history-toolbar">
            <select
              aria-label="筛选历史动作"
              value={exercise}
              onChange={(e) => setExercise(e.target.value)}
            >
              <option value="all">全部动作</option>
              {Object.entries(EXERCISES).map(([id, spec]) => (
                <option key={id} value={id}>
                  {spec.label}
                </option>
              ))}
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
              label="记录时间范围"
            />
            <HistoryDateRange
              label="历史"
              from={from}
              to={to}
              onChange={(start, end) => {
                setFrom(start);
                setTo(end);
                setPeriod("all");
              }}
            />
          </div>
          {from && to && from > to && (
            <p role="alert">开始日期不能晚于结束日期</p>
          )}
          <div className="stats-overview">
            <Metric
              label="训练组"
              value={totals.sets}
              unit="组"
              color={chartColors[0]}
            />
            <Metric
              label="训练天数"
              value={totals.days}
              unit="天"
              color={chartColors[1]}
            />
            <Metric
              label="累计次数"
              value={totals.reps}
              unit="次"
              color={chartColors[2]}
            />
            <Metric
              label="负重训练量"
              value={n(totals.volume)}
              unit="kg·次"
              color={chartColors[3]}
            />
          </div>
          <div className="history-charts">
            <section className="feature-panel activity-panel">
              <SectionHeading title="最近 12 周" detail="训练组数" />
              <div className="activity-chart">
                {!totals.weeks.some((w) => w.sets) && (
                  <p className="chart-empty-label">
                    完成训练后，这里会留下你的节奏。
                  </p>
                )}
                <div className="weeks">
                  {totals.weeks.map((w) => (
                    <div
                      key={w.start}
                      aria-label={`${w.start}起：${w.sets}组、${w.reps}次`}
                      title={`${w.start}起：${w.sets}组、${w.reps}次、${n(w.volume)}kg·次、支撑${n(w.seconds)}秒`}
                    >
                      <div className="week-track">
                        <div
                          style={{
                            height: `${Math.max(w.sets ? 5 : 1.5, (w.sets / Math.max(1, ...totals.weeks.map((x) => x.sets))) * 100)}%`,
                          }}
                        />
                      </div>
                      <small>{w.start.slice(5)}</small>
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
                  当前连续 <b>{totals.current}</b> 天
                </span>
                <span>
                  <Trophy size={14} />
                  最长连续 <b>{totals.longest}</b> 天
                </span>
              </div>
            </section>
            <section className="feature-panel coverage-panel">
              <SectionHeading title="肌群训练分布" detail="近 7 天" />
              <Distribution groups={coverage} />
              <p className="panel-note">
                一组可涉及多个肌群；不用于判断身体是否恢复。
              </p>
            </section>
          </div>
          <div className="two-columns">
            <section className="feature-panel">
              <SectionHeading title="动作趋势" icon={Activity} />
              {!progress.length ? (
                <EmptyState
                  icon={Activity}
                  title="进步，会慢慢变得清晰"
                  text="完成训练后，在这里查看动作评分与节奏变化。"
                />
              ) : (
                progress.map((p) => (
                  <div className="progress-entry" key={p.exercise}>
                    <div>
                      <strong>{p.name}</strong>
                      <span>
                        {p.sets} 组 · {p.reps} 次
                      </span>
                    </div>
                    <p>
                      {p.scoreDelta === null
                        ? "评分样本不足，暂不判断趋势"
                        : `平均动作分 ${p.previousScore} → ${p.recentScore}（${p.scoreDelta > 0 ? "+" : ""}${p.scoreDelta}）`}
                      {p.recentTempo !== null
                        ? ` · 近期平均下放 ${p.recentTempo} 秒`
                        : ""}
                    </p>
                    {p.topFaults.length > 0 && (
                      <small>常见提醒：{p.topFaults[0].text}</small>
                    )}
                  </div>
                ))
              )}
              <p className="panel-note">
                最近 3 组与此前 3 组对比；无评分记录不参与评分趋势。
              </p>
            </section>
            <section className="feature-panel">
              <SectionHeading title="个人纪录" icon={Trophy} />
              {!Object.keys(prs).length ? (
                <EmptyState
                  icon={Trophy}
                  title="下一次，就是新的起点"
                  text="你在各个动作上的最佳表现将显示在这里。"
                />
              ) : (
                Object.entries(prs).map(([e, p]) => (
                  <div className="personal-record-row" key={e}>
                    <span className="list-icon">
                      <Dumbbell size={18} />
                    </span>
                    <div>
                      <strong>{label(e)}</strong>
                      <p>
                        {e === "plank"
                          ? `连续支撑 ${n(p.hold)} 秒`
                          : `单组 ${p.reps} 次${p.e1rm ? ` · 估算1RM ${n(p.e1rm)} kg · 单组训练量 ${n(p.volume)} kg·次` : " · 无负重成绩"}`}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
          {records.length > 0 && (
            <div className="two-columns">
              <section className="feature-panel">
                <Trend
                  label="最近 20 组动作评分"
                  values={records.slice(-20).map((r) => stats(r).score)}
                />
                <Trend
                  label="最近 20 组平均下放秒数"
                  values={records.slice(-20).map((r) => stats(r).tempo)}
                />
              </section>
              <section className="feature-panel">
                <SectionHeading title="纠错记录" icon={CircleHelp} />
                {Object.entries(totals.faults)
                  .sort((a, b) => b[1] - a[1])
                  .map(([f, count]) => (
                    <p className="feature-row" key={f}>
                      <span>{FAULTS[f]?.text ?? f}</span>
                      <strong>{count} 次</strong>
                    </p>
                  ))}
                {!Object.keys(totals.faults).length && (
                  <EmptyState icon={Check} title="暂无已记录错误" />
                )}
              </section>
            </div>
          )}
          <section className="feature-panel record-list-panel">
            <SectionHeading
              title="每组详情"
              detail={`${records.length} 条记录`}
            />
            {records.length > 0 && (
              <div className="record-list-heading" aria-hidden="true">
                <span>训练动作</span>
                <span>训练时间</span>
                <span>完成情况</span>
                <span>记录来源</span>
                <span />
              </div>
            )}
            {!records.length && (
              <EmptyState
                icon={ListChecks}
                title={
                  data.records.length
                    ? "没有符合筛选条件的记录"
                    : "每一组，都值得记录"
                }
                text={
                  data.records.length
                    ? "试试其他动作或日期范围；选择「全部」可清除日期限制。"
                    : "完成训练或导入旧记录后，会显示在这里。"
                }
              />
            )}
            {[...records].reverse().map((r) => (
              <RecordDetail key={r.id} r={r} />
            ))}
          </section>
          <p className="page-footnote">
            评分来自姿态规则；估算力量与速度下降用于训练对比，不代替实测或身体评估。
          </p>
        </>
      )}
    </main>
  );
}

export function ProfilePanel({ data, persist, report }: Props) {
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
        title="我的资料"
        sub="管理目标、习惯和偏好，教练会在对话中参考。"
        extra={
          <span className="page-meta">
            <UserRound size={16} />
            已记住 {data.profile?.length ?? 0} 条信息
          </span>
        }
      />
      <div className="profile-purpose">
        <MessageCircle size={22} strokeWidth={1.6} />
        <div>
          <strong>用于教练对话</strong>
          <p>
            教练回答时会参考这里的信息。训练动作、组数与评分仍按原有训练设置执行。
          </p>
        </div>
        <span>按需填写，随时修改</span>
      </div>
      <div className="profile-layout">
        <aside className="profile-sidebar" aria-label="资料分类">
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
                <span>{profileCopy[c].label}</span>
                <small>
                  {data.profile?.filter((f) => f.category === c).length || ""}
                </small>
                <ChevronRight size={14} />
              </button>
            );
          })}
          <p className="sidebar-note">
            <ShieldCheck size={16} />
            只填写你愿意分享的内容，
            <br />
            不需要把每一项都填满。
          </p>
        </aside>
        <div className="profile-content">
          <section className="feature-panel profile-editor">
            <SectionHeading
              title={guide.label}
              detail={
                editingKey === undefined ? "添加一条信息" : "已保存，可随时更新"
              }
            />
            <p className="profile-category-intro">{guide.description}</p>
            <div
              className="profile-topics"
              role="group"
              aria-label={`${guide.label}话题`}
            >
              {guide.topics.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  disabled={saving}
                  aria-pressed={!custom && key === t.key}
                  onClick={() => chooseTopic(t.key)}
                >
                  {t.key}
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
                自定义
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
                  给这条信息起个名字
                  <input
                    aria-label="信息名称"
                    placeholder={`例如：${guide.topics[0].key}`}
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
                {custom ? "有什么想让教练了解的？" : topic?.question}
                <textarea
                  ref={contentInput}
                  aria-label="告诉教练"
                  aria-describedby="profile-answer-hint"
                  placeholder={
                    custom
                      ? `用自己的话写下来。${guide.topics[0].example}`
                      : topic?.example
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
                <span>如何使用</span>
                {guide.use}
              </p>
              <div className="editor-footer">
                <span role="status" className="success-notice">
                  {notice && (
                    <>
                      <Check size={15} />
                      {notice}
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
                    取消修改
                  </button>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={saving || !key.trim() || !value.trim() || !changed}
                >
                  <Check size={16} />
                  {saving
                    ? "保存中…"
                    : editingKey === undefined
                      ? "记住这条信息"
                      : "保存修改"}
                </button>
              </div>
            </form>
          </section>
          <section className="feature-panel profile-facts">
            <SectionHeading
              title="教练已记住"
              detail={`${guide.label} · ${facts.length} 条`}
            />
            {!facts.length && (
              <p className="profile-empty-note">
                还没有关于{guide.label}
                的信息。在上方写下并保存，之后对话时教练就能参考。
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
                    修改
                  </button>
                  <button
                    className="icon-button remove-action"
                    aria-label={`遗忘${f.key}`}
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
              信息保存在本机，对话时会发送给你配置的 AI
              服务。你可以随时修改或删除。
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
  const [confirming, setConfirming] = useState<string>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = [...(data.trash ?? [])]
    .reverse()
    .filter((e) => kinds.includes(e.kind));
  if (!entries.length && !notice) return null;
  const restore = async (id: string) => {
    setBusy(true);
    setNotice("");
    try {
      await persist((d) => restoreTrash(d, id));
      setNotice("已恢复，可以在原来的列表中继续使用。");
      setConfirming(undefined);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const Panel = collapsible ? "details" : "section";
  return (
    <Panel className="feature-panel recently-deleted" aria-label="最近删除"
      onToggle={(event) => {
        if (!event.currentTarget.hasAttribute("open")) setConfirming(undefined);
      }}>
      {collapsible ? (
        <summary className="trash-disclosure">
          <h2>
            <Trash2 size={18} aria-hidden="true" />
            最近删除 <small>{entries.length} 项</small>
            <ChevronDown className="disclosure-icon" size={16} aria-hidden="true" />
          </h2>
        </summary>
      ) : (
        <SectionHeading title="最近删除" detail={`${entries.length} 项`} icon={Trash2} />
      )}
      <p className="trash-help">这里的内容不会用于训练或教练回复。可恢复到原处，永久删除后无法找回。</p>
      {!entries.length && <p className="trash-empty">暂无已删除内容</p>}
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
                <strong>{title}</strong>
                <div className="deleted-meta">
                  <span>
                    {entry.kind === "plan"
                      ? "训练计划"
                      : entry.kind === "profile"
                        ? categoryNames[entry.value.category]
                        : "参考动作"}
                  </span>
                  {Number.isFinite(deleted.getTime()) && (
                    <time dateTime={entry.deletedAt}>
                      {deleted.toLocaleString("zh-CN", {
                        dateStyle: "long",
                        timeStyle: "short",
                        hour12: false,
                      })} 删除
                    </time>
                  )}
                </div>
              </div>
              <div className="deleted-actions">
                <button
                  disabled={busy}
                  aria-label={`恢复${title}`}
                  onClick={() => void restore(entry.id)}
                >
                  恢复
                </button>
                <button
                  className="trash-remove"
                  disabled={busy}
                  aria-label={`永久删除${title}`}
                  onClick={() => setConfirming(entry.id)}
                >
                  永久删除
                </button>
              </div>
            </div>
            {confirming === entry.id && (
              <div
                className="delete-confirmation"
                role="group"
                aria-label={`确认永久删除${title}`}
              >
                <p>永久删除「{title}」后无法恢复。</p>
                <button
                  disabled={busy}
                  onClick={() => setConfirming(undefined)}
                >
                  保留
                </button>
                <button
                  className="trash-confirm"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setNotice("");
                    void persist((d) => ({
                      ...d,
                      trash: d.trash?.filter((e) => e.id !== entry.id),
                    }))
                      .then(() => {
                        setConfirming(undefined);
                        setNotice("已永久删除所选内容。");
                      })
                      .catch(report)
                      .finally(() => setBusy(false));
                  }}
                >
                  确认永久删除
                </button>
              </div>
            )}
          </div>
        );
      })}
      <p className="success-notice" role="status">
        {notice}
      </p>
    </Panel>
  );
}

export function DataPanel({ data, persist, report }: Props) {
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
        title="训练数据与备份"
        icon={FolderOpen}
        detail={`${data.records.length + (data.timedRecords?.length ?? 0)} 条训练记录`}
      />
      <p className="muted">给每一次训练，留一份安心的备份。</p>
      {!desktop && (
        <p className="privacy-note">
          <CircleHelp size={16} />
          文件在浏览器本机读取，不会上传。导出完整 JSON
          备份后，可以在桌面端导入；桌面端备份也可以在这里导入。设备设置各自保留。
        </p>
      )}
      <div className="data-action-row">
        <span className="list-icon">
          <ArrowDownToLine size={21} />
        </span>
        <div>
          <h3>导入训练数据</h3>
          <p>
            从备份恢复数据，或导入 Strong / Hevy
            的训练记录。重复记录会自动去重，保留本机设备设置与同名资料。
          </p>
          <div className="feature-row">
            {(["backup", "csv"] as const).map((k) => (
              <button key={k} disabled={busy} onClick={() => void importing(k)}>
                {k === "backup" ? "导入完整备份" : "导入 Strong / Hevy CSV"}
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
          <h3>导出与备份</h3>
          <p>
            完整备份（JSON）包含自动计数、动作库统计、手动修正、常练动作、首页快捷动作、资料、计划和最近删除，适合备份或换设备。Strong
            / Hevy CSV
            仅导出原有自动计数与姿态计时记录；动作库统计请使用完整备份保存。
          </p>
          <div className="feature-row">
            {(["json", "strong", "hevy"] as const).map((k) => (
              <button key={k} disabled={busy} onClick={() => void exporting(k)}>
                导出{" "}
                {k === "json"
                  ? "完整备份"
                  : k === "strong"
                    ? "Strong CSV"
                    : "Hevy CSV"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="success-notice" role="status">
        {notice}
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
  const spec = EXERCISES[state.exercise];
  return (
    <div className="training-details">
      <div className="feature-panel" aria-label="拍摄与计数检查">
        <strong>拍摄与计数检查</strong>
        {countingHints(state).map((hint) => (
          <p key={hint}>{hint}</p>
        ))}
        {state.environment && (
          <small className="muted">
            {state.environment.cameraHint} ·{" "}
            {state.environment.brightness === null
              ? "光线检测中"
              : `画面亮度 ${Math.round(state.environment.brightness * 100)}%`}
          </small>
        )}
      </div>
      <div className="feature-row">
        {state.catalogPlan ? <strong>计划 · 动作 {state.catalogPlan.block+1}/{state.catalogPlan.blocks} · 第 {state.catalogPlan.set}/{state.catalogPlan.sets} 组</strong> : state.program ? (
          <strong>
            计划：第 {state.program.block + 1}/{state.program.blocks.length}{" "}
            个动作 · 第 {state.program.set}/
            {state.program.blocks[state.program.block].sets} 组
            {state.status === "resting"
              ? `，下一组 ${label(state.program.blocks[state.program.block].exercise)}`
              : ""}
          </strong>
        ) : (
          <label>
            <input
              type="checkbox"
              checked={state.auto}
              onChange={(e) =>
                void control({ type: "auto_detect", enabled: e.target.checked })
              }
            />{" "}
            自动识别动作{" "}
            {state.auto
              ? state.detected
                ? `· 已锁定${label(state.detected)}`
                : "· 等待连续动作，识别后开始计次"
              : ""}
          </label>
        )}
        {state.program && (
          <button onClick={() => void control({ type: "stop_program" })}>
            结束计划
          </button>
        )}
      </div>
      {state.auto && (
        <small className="muted">
          每组开始识别一次；卧推请手动选择。切换动作可关闭自动模式。
        </small>
      )}
      <div className="feature-row">
        <span>
          阶段：
          {
            (
              {
                IDLE: "准备",
                DESCENT: "下放",
                BOTTOM: "底部",
                ASCENT: "抬起",
              } as Record<string, string>
            )[state.phase]
          }
        </span>
        <span>
          {spec.signal}：{n(state.angles[spec.signal], 0)}°
        </span>
        {state.exercise !== "plank" && (
          <span className="muted">
            开始 &lt; {spec.start}° · 底部 &lt; {spec.bottom}° · 回位 &gt;{" "}
            {spec.lockout}°
          </span>
        )}
        <span>速度下降 {n(state.fatigue * 100, 0)}%</span>

      </div>
      {state.exercise === "plank" && (
        <label className="feature-row">
          有效支撑目标 / 秒{" "}
          <input
            type="number"
            min={1}
            max={600}
            value={state.holdGoal}
            onChange={(e) =>
              void control({ type: "set_hold_goal", seconds: +e.target.value })
            }
          />
          <span>本组最长连续 {n(state.holdBest)}秒</span>
        </label>
      )}
    </div>
  );
}
