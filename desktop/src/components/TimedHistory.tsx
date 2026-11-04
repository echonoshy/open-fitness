import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { dayKey } from "../core/history";
import type { TimedRecord } from "../core/timed-training";
import { HistoryDateRange } from "./HistoryDateRange";
import { EmptyState } from "./FeatureUI";
import { statisticLabel } from "../core/movement-statistics";

export function TimedHistory({ records }: { records: TimedRecord[] }) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = useMemo(
    () =>
      records
        .filter((r) => {
          const day = dayKey(r.startedAt);
          return (
            r.movementName.includes(query.trim()) &&
            (!from || day >= from) &&
            (!to || day <= to)
          );
        })
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    [records, query, from, to],
  );
  return (
    <section aria-label="动作库训练记录">
      <div className="history-toolbar">
        <input
          aria-label="搜索计时动作"
          placeholder="搜索动作名称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <HistoryDateRange
          label="计时记录"
          from={from}
          to={to}
          onChange={(start, end) => {
            setFrom(start);
            setTo(end);
          }}
        />
      </div>
      <p className="muted">
        共 {rows.length} 组 ·{" "}
        {Math.floor(rows.reduce((sum, r) => sum + r.duration, 0) / 60)}{" "}
        分钟。训练时长不含暂停和休息；摄像头估算与手动修正分别保留，不参与动作评分和个人纪录。
      </p>
      {!rows.length ? (
        <EmptyState
          icon={Clock3}
          title="还没有动作库训练记录"
          text="在计划里选择动作并开始训练，每组结束后可以在这里查看次数和时长。"
        />
      ) : (
        <div className="timed-history-list">
          {rows.map((r) => (
            <article key={r.id} className="feature-panel timed-history-row">
              <div>
                <h3>
                  {r.movementName}{" "}
                  <small>
                    {r.statistics
                      ? statisticLabel(r.statistics.mode)
                      : "计时记录"}
                  </small>
                </h3>
                <p className="muted">
                  {new Date(r.startedAt).toLocaleString("zh-CN")} · 第{" "}
                  {r.setIndex} 组{r.interrupted ? " · 中断恢复" : ""}
                </p>
              </div>
              <dl>
                <div>
                  <dt>训练时长</dt>
                  <dd>
                    {Math.floor(r.duration / 60)} 分{" "}
                    {Math.floor(r.duration % 60)} 秒
                  </dd>
                </div>
                <div>
                  <dt>
                    {r.manualReps !== undefined
                      ? "手动填写 / 修正"
                      : r.statistics?.mode === "reps"
                        ? "估算次数"
                        : "自填次数"}
                  </dt>
                  <dd>
                    {r.manualReps === undefined
                      ? r.statistics?.mode === "reps"
                        ? `${r.statistics.reps} 次`
                        : "未填写"
                      : `${r.manualReps} 次`}
                  </dd>
                  {r.manualReps !== undefined &&
                    r.statistics?.mode === "reps" && (
                      <small>自动估算 {r.statistics.reps} 次</small>
                    )}
                </div>
                {r.statistics &&
                  ["hold", "activity"].includes(r.statistics.mode) && (
                    <div>
                      <dt>{statisticLabel(r.statistics.mode)}</dt>
                      <dd>{Math.floor(r.statistics.seconds)} 秒</dd>
                    </div>
                  )}
                <div>
                  <dt>负重</dt>
                  <dd>{r.load} kg</dd>
                </div>
                <div>
                  <dt>本组目标</dt>
                  <dd>
                    {r.statistics?.mode === "reps"
                      ? `${r.statistics.goalReps} 次`
                      : `${r.goalSeconds} 秒`}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
