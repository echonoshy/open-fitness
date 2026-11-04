import { useUiLocale } from "../i18n";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { EXERCISES } from "../core/engine";
import type { Snapshot } from "../core/session";
import { motionFeedback } from "../core/training-feedback";
import { ExerciseGuide } from "./ExerciseGuide";
import { PushupCameraGuide } from "./PushupCameraGuide";

export function AngleFeedback({
  state,
  cameraOn,
}: {
  state: Snapshot;
  cameraOn: boolean;
}) {
  const { uiText } = useUiLocale();
  const feedback = motionFeedback(state, cameraOn);
  const needsPosition =
    cameraOn &&
    (state.status === "ready" || state.status === "training") &&
    (!state.tracking ||
      state.preparing ||
      (state.squatCheck && !state.squatCheck.ready) ||
      (state.pushupCheck && !state.pushupCheck.ready));
  const [samples, setSamples] = useState<(number | null)[]>([]);
  useEffect(() => {
    setSamples([]);
  }, [state.exercise, cameraOn]);
  useEffect(() => {
    if (cameraOn)
      setSamples((previous) => [
        ...previous.slice(-59),
        Number.isFinite(feedback.angle) ? feedback.angle! : null,
      ]);
  }, [state.angles, state.tracking, cameraOn, feedback.angle]);
  const spec = EXERCISES[state.exercise];
  const y = (angle: number) =>
    70 - (Math.min(180, Math.max(0, angle)) / 180) * 60;
  let path = "",
    connected = false;
  samples.forEach((sample, i) => {
    if (sample === null) {
      connected = false;
      return;
    }
    path += `${connected ? "L" : "M"}${((i * 220) / 59).toFixed(1)},${y(sample).toFixed(1)} `;
    connected = true;
  });
  return (
    <div className="angle-feedback">
      <div className="exercise-guide-section">
        <ExerciseGuide exercise={state.exercise} />
      </div>
      {cameraOn && (
        <>
          <div
            className={`counting-status ${needsPosition ? "needs-position" : ""}`}
            role="status"
          >
            <strong>{uiText(feedback.title)}</strong>
            <p>{uiText(state.cameraView?.hint || feedback.detail)}</p>
          </div>
          <details className="motion-details" key={state.exercise}>
            <summary>
              <span>{uiText("动作详情")}</span>
              <span className="motion-angle">
                {uiText(feedback.joint)}
                <strong>
                  {uiText(Number.isFinite(feedback.angle)
                    ? `${Math.round(feedback.angle!)}°`
                    : "—")}
                </strong>
              </span>
              <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="motion-detail-content">
              {state.exercise === "pushup" && (
                <PushupCameraGuide
                  check={state.pushupCheck}
                  cameraOn={cameraOn}
                />
              )}
              {state.exercise === "squat" && cameraOn && state.squatCheck && (
                <ul className="position-checks" aria-label={uiText("深蹲站位检查")}>
                  {state.squatCheck.checks.map((check) => (
                    <li key={check.label} className={check.ok ? "passed" : ""}>
                      {uiText(check.ok ? "✓" : "○")} {uiText(check.label)}
                    </li>
                  ))}
                </ul>
              )}
              {state.trackingSide && (
                <p className="tracking-side">
                  {uiText("当前分析")}{uiText(state.trackingSide === "left" ? "左" : "右")}{uiText("侧关节")}
                </p>
              )}
              <svg
                className="angle-chart"
                viewBox="0 0 280 82"
                role="img"
                aria-label={
                  uiText(state.exercise === "pushup"
                    ? "最近约六秒的参考肘角，计数同时结合肩部运动"
                    : "最近约六秒的关节角度曲线，虚线为幅度与回位参考")
                }
              >
                {state.exercise !== "pushup" && (
                  <>
                    <line
                      x1="0"
                      x2="220"
                      y1={y(state.exercise === "plank" ? 160 : spec.lockout)}
                      y2={y(state.exercise === "plank" ? 160 : spec.lockout)}
                      className="angle-reference"
                    />
                    <text
                      x="228"
                      y={y(state.exercise === "plank" ? 160 : spec.lockout) + 4}
                    >
                      {uiText(state.exercise === "plank" ? "160°" : `${spec.lockout}°`)}
                    </text>
                    {state.exercise !== "plank" && (
                      <>
                        <line
                          x1="0"
                          x2="220"
                          y1={y(spec.bottom)}
                          y2={y(spec.bottom)}
                          className="angle-reference depth"
                        />
                        <text x="228" y={y(spec.bottom) + 4}>
                          {spec.bottom}°
                        </text>
                      </>
                    )}
                  </>
                )}
                <path d={path} className="angle-trace" />
              </svg>
              <div className="motion-stages" aria-label={uiText("动作阶段")}>
                {feedback.stages.map((label, i) => (
                  <span
                    key={label}
                    className={
                      state.status === "training" &&
                      state.tracking &&
                      feedback.stage === i
                        ? "current"
                        : ""
                    }
                  >
                    {uiText(label)}
                  </span>
                ))}
              </div>
            </div>
          </details>
        </>
      )}
      {state.last && state.status !== "ready" && (
        <small className="last-rep">
          {uiText(state.last.assessment?.limited ? (
            "上次 +1 · 已完成往返 · 姿态仅局部评估"
          ) : (
            <>
              {uiText("上次 +1 · ")}{state.last.score}{uiText(" 分")}
              {uiText(state.last.full_depth ? " · 幅度充分" : " · 幅度可改善")}
            </>
          ))}
        </small>
      )}
    </div>
  );
}
