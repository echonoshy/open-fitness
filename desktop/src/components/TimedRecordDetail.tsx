import { useUiLocale } from "../i18n";
import { ChevronDown } from "lucide-react";
import type { TimedRecord } from "../core/timed-training";
import { statisticLabel } from "../core/movement-statistics";

export function TimedRecordDetail({
  r,
  name,
}: {
  r: TimedRecord;
  name: string;
}) {
  const { language, uiText, message } = useUiLocale();
  const camera = r.statistics;
  const mode = camera ? statisticLabel(camera.mode) : "计时记录";
  const summary =
    r.manualReps !== undefined
      ? `手填 ${r.manualReps} 次`
      : camera?.mode === "reps"
        ? `估算 ${camera.reps} 次`
        : camera && (camera.mode === "hold" || camera.mode === "activity")
          ? `${mode} ${Math.floor(camera.seconds)} 秒`
          : `计时 ${Math.floor(r.duration)} 秒`;
  return (
    <details className="record-detail">
      <summary>
        <strong>{uiText(name)}</strong>
        <span data-label={uiText("训练时间")}>
          {new Date(r.startedAt).toLocaleString(language)}
        </span>
        <span data-label={uiText("完成情况")}>{uiText(summary)}</span>
        <span data-label={uiText("记录来源")}>
          {uiText("动作库 · ")}{uiText(mode)}
          {uiText(r.interrupted ? " · 中断恢复" : "")}
        </span>
        <ChevronDown className="disclosure-icon" size={16} />
      </summary>
      <div className="timed-history-row">
        <p>{message("第 {0} 组", r.setIndex)}</p>
        <dl>
          <div>
            <dt>{uiText("训练时长")}</dt>
            <dd>
              {Math.floor(r.duration / 60)}{language === "en" ? " min " : " 分 "}{Math.floor(r.duration % 60)}{uiText(" 秒")}
            </dd>
          </div>
          <div>
            <dt>
              {uiText(r.manualReps !== undefined
                ? "手动填写 / 修正"
                : r.statistics?.mode === "reps"
                  ? "估算次数"
                  : "自填次数")}
            </dt>
            <dd>
              {uiText(r.manualReps === undefined
                ? r.statistics?.mode === "reps"
                  ? `${r.statistics.reps} 次`
                  : "未填写"
                : `${r.manualReps} 次`)}
            </dd>
            {r.manualReps !== undefined && r.statistics?.mode === "reps" && (
              <small>{uiText("自动估算 ")}{r.statistics.reps}{uiText(" 次")}</small>
            )}
          </div>
          {r.statistics && ["hold", "activity"].includes(r.statistics.mode) && (
            <div>
              <dt>{uiText(statisticLabel(r.statistics.mode))}</dt>
              <dd>{Math.floor(r.statistics.seconds)}{uiText(" 秒")}</dd>
            </div>
          )}
          <div>
            <dt>{uiText("负重")}</dt>
            <dd>{r.load} kg</dd>
          </div>
          <div>
            <dt>{uiText("本组目标")}</dt>
            <dd>
              {uiText(r.statistics?.mode === "reps"
                ? `${r.statistics.goalReps} 次`
                : `${r.goalSeconds} 秒`)}
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}
