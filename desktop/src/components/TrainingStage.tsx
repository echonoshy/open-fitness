import { useUiLocale } from "../i18n";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  BookOpen,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  ListChecks,
  Mic,
  MicOff,
  Minus,
  Pause,
  Play,
  Plus,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { EXERCISES, type Exercise } from "../core/engine";
import type { Command, Snapshot, Receipt } from "../core/session";
import type { CameraCommand } from "../core/camera-framing";
import { AngleFeedback } from "./AngleFeedback";
import { CoachMarkdown } from "./CoachMarkdown";
import { TrainingDetails } from "./Features";
import { CameraViewControl } from "./CameraViewControl";
import { ExerciseReference } from "./ExerciseReference";
import { movementCapability, primaryMovementSlugs, type Movement } from "../core/movement-library";
import type { LibrarySource } from "./MovementLibrary";
import { MovementPicker } from "./MovementPicker";
import { statisticLabel } from "../core/movement-statistics";
import { CameraPlacementGuide } from "./CameraPlacementGuide";
import { catalogCameraGuide } from "./catalog-camera-guides";
import type { ReferenceSize } from "../core/reference-view";
import "./training-stage.css";
import "./training-feedback.css";
import "./exercise-reference.css";

const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
const labels = {
  ready: "准备开始",
  training: "训练中",
  paused: "已暂停",
  resting: "组间休息",
};

const builtInExercises = new Map(Object.entries(primaryMovementSlugs).map(([id,slug])=>[slug,id as Exercise]));

interface Props {
  movement?: Movement;
  openPlans: () => void;
  library: LibrarySource;
  shortcuts: string[];
  favorites: string[];
  saveShortcuts: (slugs:string[])=>Promise<void>;
  selectMovement: (item:Movement)=>Promise<void>;
  onManualReps: (value: number | undefined) => Promise<void>;
  onCameraStatistics: (enabled: boolean) => void;
  visible: boolean;
  state: Snapshot;
  loaded: boolean;
  video: RefObject<HTMLVideoElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  effectCanvas: RefObject<HTMLCanvasElement | null>;
  backgroundBlur: boolean;
  exerciseReference: boolean;
  referenceSize: ReferenceSize;
  setReferenceSize: (size: ReferenceSize) => Promise<void>;
  setExerciseReference: (enabled: boolean) => Promise<void>;
  explainExercise: () => void;
  blurNotice: string;
  setBackgroundBlur: (enabled: boolean) => Promise<void>;
  cameraFrame: RefObject<HTMLDivElement | null>;
  cameraControl: (command: CameraCommand) => Promise<Receipt>;
  cameraStatus: string;
  fps: number;
  micOn: boolean;
  voiceState: string;
  level: number;
  speaking: boolean;
  voiceAvailable: boolean;
  latest?: { role: string; content: string };
  heard?: string;
  summary: string;
  hudHidden: boolean;
  onHudHidden: (hidden: boolean) => void;
  startCamera: () => Promise<void>;
  closeCamera: () => void;
  toggleMic: () => Promise<void>;
  cancel: () => void;
  control: (command: Command | CameraCommand | import("../core/catalog-plan").PlanCommand) => Promise<void>;
  report: (error: unknown) => void;
  showVoiceGuide: () => void;
}

function PlanSetFields({ goal, load, rest, isHold, last, onApply }: {
  goal: number;
  load: number;
  rest: number;
  isHold: boolean;
  last: boolean;
  onApply: (target: number, load: number, rest: number) => void;
}) {
  const { uiText } = useUiLocale();
  const [targetText, setTargetText] = useState(String(goal));
  const [loadText, setLoadText] = useState(String(load));
  const [restText, setRestText] = useState(String(rest));
  const changed = Number(targetText) !== goal || Number(loadText) !== load || Number(restText) !== rest;
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onApply(Number(targetText), Number(loadText), Number(restText));
    }}>
      <label className="compact-field">{uiText("本组目标 / ")}{uiText(isHold ? "秒" : "次")}
        <input type="number" required min={1} max={isHold ? 600 : 100}
          value={targetText} onChange={(e) => setTargetText(e.target.value)} />
      </label>
      <label className="compact-field">{uiText("本组负重 / kg")}
        <input type="number" required min={0} max={500} step="any"
          value={loadText} onChange={(e) => setLoadText(e.target.value)} />
      </label>
      {!last && <label className="compact-field">{uiText("本组结束后休息 / 秒")}
        <input type="number" required min={0} max={900}
          value={restText} onChange={(e) => setRestText(e.target.value)} />
      </label>}
      <button type="submit" disabled={!changed}>{uiText("应用到本组")}</button>
    </form>
  );
}

export function TrainingStage(p: Props) {
  const { uiText, message } = useUiLocale();
  const { state, control } = p;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const view = state.cameraView ?? {
    automatic: true,
    zoom: 1,
    x: 0.5,
    y: 0.5,
    maxZoom: 1,
    hint: "",
    targetLost: false,
  };
  const [managingShortcuts,setManagingShortcuts] = useState(false);
  const catalogBySlug = useMemo(()=>new Map(p.library.items.map(m=>[m.slug,m])),[p.library.items]);
  const [exerciseOpen, setExerciseOpen] = useState(false);
  const [replyExpanded, setReplyExpanded] = useState(false);
  const exerciseDialog = useRef<HTMLDialogElement>(null);
  const exerciseButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const referenceButton = useRef<HTMLButtonElement>(null);
  const inPlan = !!(state.catalogPlan || state.program);
  const program = state.program;
  const planBlock = program?.blocks[program.block];
  const lastPlanSet = state.catalogPlan
    ? !state.catalogPlan.next
    : program && program.block === program.blocks.length - 1 && program.set === planBlock?.sets;
  const planRest = state.catalogPlan?.restSeconds ?? program?.restSeconds ?? 0;
  const planSetId = state.catalogPlan?.setId ?? program?.setId;
  // Traditional plans already point at the scheduled set during a rest.
  const scheduled = program?.between ? planBlock : undefined;
  const afterRest = state.catalogPlan?.between ? state.catalogPlan.next
    : scheduled && program ? `${EXERCISES[scheduled.exercise].label} · 第 ${program.set} 组` : "";
  const following = scheduled && program && program.set > 1 ? program.blocks[program.block + 1] : undefined;
  const skipTo = state.catalogPlan?.skipTo ?? (following && EXERCISES[following.exercise].label);
  const active = state.status !== "ready";
  const cameraLive = p.cameraStatus === "on";
  const timed = state.timed;
  const placement = timed?.cameraStatistics ? catalogCameraGuide(timed.movement.slug) : undefined;
  const name = timed?.movement.name ?? EXERCISES[state.exercise].label;
  const isHold = timed
    ? timed.statistics.mode !== "reps"
    : state.exercise === "plank";
  const count = isHold ? Math.floor(state.hold) : state.reps;
  const goal = isHold ? state.holdGoal : state.goal;
  const progress = Math.min(1, count / goal);

  useEffect(() => {
    if (exerciseOpen && p.visible) {
      exerciseDialog.current?.showModal();
      exerciseDialog.current
        ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.focus();
    } else exerciseDialog.current?.close();
  }, [exerciseOpen, p.visible]);
  useEffect(() => {
    if (settingsOpen && p.visible) dialog.current?.showModal();
    else dialog.current?.close();
  }, [settingsOpen, p.visible]);
  useEffect(() => {
    if (!p.visible) {
      setSettingsOpen(false);
      setExerciseOpen(false);
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && p.visible) p.onHudHidden(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [p.visible, p.onHudHidden]);

  const changeGoal = (value: number) =>
    void control(
      isHold
        ? { type: "set_hold_goal", seconds: value }
        : { type: "set_rep_goal", reps: value },
    );
  const subtitle = p.latest?.content || "";
  const micStatus = !p.voiceAvailable
    ? "语音教练 · 服务未连接"
    : p.micOn
      ? p.voiceState || "语音教练 · 随时开口"
      : p.voiceState || "麦克风已静音";

  return (
    <main
      className={`training-stage ${cameraLive ? "camera-live" : "camera-idle"} ${p.hudHidden ? "hud-hidden" : ""} ${p.exerciseReference ? "with-reference" : ""}`}
      hidden={!p.visible}
      aria-label={uiText("训练画面")}
    >
      <div className="stage-video">
        <div
          className="camera-viewport"
          style={
            {
              "--camera-aspect":
                (p.video.current?.videoWidth || 1280) /
                (p.video.current?.videoHeight || 720),
            } as CSSProperties
          }
        >
          <div className="camera-image" ref={p.cameraFrame}>
            <video
              ref={p.video}
              muted
              playsInline
              aria-label={uiText("实时摄像头画面")}
            />
            <canvas
              className="camera-background-effect"
              ref={p.effectCanvas}
              width={1280}
              height={720}
              hidden
              aria-hidden="true"
            />
            <canvas
              ref={p.canvas}
              width={1280}
              height={720}
              hidden={p.cameraStatus !== "on"}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
      <div className="stage-shade" aria-hidden="true" />

      <section
        className={`exercise-hud stage-hud${!timed && state.exercise === "pushup" ? " pushup-hud" : ""}`}
        aria-label={uiText("本组训练")}
        inert={p.hudHidden}
      >
        <span className="exercise-label">{uiText("当前动作")}</span>
        <button
          ref={exerciseButton}
          className="exercise-trigger"
          aria-label={uiText(`切换动作，当前${name}`)}
          aria-haspopup="dialog"
          onClick={() => setExerciseOpen(true)}
        >
          {uiText(name)}
          <ChevronDown size={20} />
        </button>
        <span className="training-capability">
          {uiText(timed
            ? statisticLabel(timed.statistics.mode)
            : state.exercise === "plank"
              ? "姿态计时"
              : "自动计数")}
        </span>
        <div
          className="rep-ring"
          role="meter"
          aria-label={uiText("本组完成进度")}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(count, goal)}
        >
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle className="ring-track" cx="100" cy="100" r="91" />
            <circle
              className="ring-value"
              cx="100"
              cy="100"
              r="91"
              pathLength="100"
              strokeDasharray={`${progress * 100} 100`}
              style={{ opacity: progress ? 1 : 0 }}
            />
          </svg>
          <div>
            <strong>{String(count).padStart(2, "0")}</strong>
            <span>
              / {goal} {uiText(isHold ? "秒" : "次")}
            </span>
          </div>
        </div>
        {timed ? (
          <div className="timed-training-note">
            <p>
              {message("第 {0} 组", timed.setIndex)} ·{" "}
              {uiText(timed.cameraStatistics
                ? "摄像头估算，不作动作评分"
                : "记录训练时长")}
            </p>
            <p role="status">
              {uiText(timed.cameraStatistics
                ? timed.statistics.notice
                : "可自行填写次数，无需开启摄像头")}
            </p>
            {active && !inPlan && count >= goal && (
              <p role="status">{uiText("目标已达，可结束保存或继续训练")}</p>
            )}
            {!active && p.summary && <p role="status">{uiText(p.summary)}</p>}
            <label>
              {uiText(timed.statistics.mode === "reps" ? "修正次数" : "自填次数")}
              <input
                aria-label={uiText("本组自填次数")}
                type="number"
                min={0}
                max={1000}
                step={1}
                placeholder={uiText("未填写")}
                disabled={!active || !!state.catalogPlan?.between}
                value={timed.manualReps ?? ""}
                onChange={(e) =>
                  void p
                    .onManualReps(
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    )
                    .catch(p.report)
                }
              />
            </label>
            {timed.manualReps !== undefined &&
              timed.statistics.mode === "reps" && (
                <small>
                  {uiText("已采用修正值 · 自动估算 ")}{timed.statistics.reps}{uiText(" 次")}
                </small>
              )}
            {placement && (
              <div className="catalog-camera-guide">
                <CameraPlacementGuide name={timed.movement.name} guide={placement} />
              </div>
            )}
          </div>
        ) : (
          <AngleFeedback state={state} cameraOn={p.cameraStatus === "on"} />
        )}
        {state.catalogPlan && <p className="program-caption">{uiText("计划 · 动作 ")}{state.catalogPlan.block+1}/{state.catalogPlan.blocks}{" · "}{message("第 {0}/{1} 组", state.catalogPlan.set, state.catalogPlan.sets)}
          {state.catalogPlan.next && <small>{uiText("下一组 · ")}{uiText(state.catalogPlan.next)}</small>}</p>}
        {state.program && (
          <p className="program-caption">
            {uiText(scheduled ? "接下来 · " : "计划 · ")}{uiText("动作 ")}{state.program.block + 1}/{state.program.blocks.length}
            {" · "}{message("第 {0}/{1} 组", state.program.set, state.program.blocks[state.program.block].sets)}
          </p>
        )}
      </section>

      <div className="session-hud stage-hud" inert={p.hudHidden}>
        <div className="session-chip">
          <Clock3 size={17} />
          <span>
            {uiText(state.status === "training" && state.preparing
              ? "准备检查中"
              : labels[state.status])}
          </span>
          <strong>{uiText(time(state.elapsed))}</strong>
        </div>
        {p.cameraStatus === "on" && (
          <div className="tracking-chip">
            <span className={`dot ${state.tracking ? "live" : ""}`} />
            {uiText(view.automatic ? "自动取景 · 全身优先" : "画面已固定")}
          </div>
        )}
        <div className="stage-tools" aria-label={uiText("画面工具")}>
          <button
            ref={referenceButton}
            className="reference-toggle"
            disabled={!p.loaded}
            aria-label={uiText("动作参考")}
            aria-pressed={p.exerciseReference}
            title={uiText(p.exerciseReference ? "关闭动作参考" : "打开动作参考")}
            onClick={() =>
              void p.setExerciseReference(!p.exerciseReference).catch(p.report)
            }
          >
            <BookOpen size={18} aria-hidden="true" />
            <span>{uiText("参考")}</span>
          </button>
          <button
            ref={settingsButton}
            aria-label={uiText("训练设置")}
            title={uiText("训练设置")}
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={18} aria-hidden="true" />
            <span>{uiText("设置")}</span>
          </button>
          <CameraViewControl
            view={view}
            control={p.cameraControl}
            enabled={p.cameraStatus === "on"}
            visible={p.visible && !p.hudHidden}
            backgroundBlur={p.backgroundBlur}
            blurNotice={p.blurNotice}
            setBackgroundBlur={p.setBackgroundBlur}
          />
          <button
            aria-label={uiText("隐藏画面控件")}
            title={uiText("隐藏画面控件")}
            onClick={() => p.onHudHidden(true)}
          >
            <EyeOff size={18} aria-hidden="true" />
            <span>{uiText("隐藏")}</span>
          </button>
        </div>
      </div>

      {p.cameraStatus !== "on" && (
        <div className="camera-welcome stage-hud" inert={p.hudHidden}>
          <div className="viewfinder-corners" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="camera-symbol">
            <CameraOff size={43} strokeWidth={1.5} />
          </div>
          <h1>
            {uiText(p.cameraStatus === "loading"
              ? "正在连接摄像头…"
              : timed && active
                ? "按自己的节奏练"
                : active
                  ? "开启画面，继续训练"
                  : "准备开始训练")}
          </h1>
          <p>
            {uiText(p.cameraStatus === "loading"
              ? "连接后，按画面提示调整站位"
              : timed
                ? timed.cameraStatistics
                  ? "开始时自动开启摄像头；也可在设置中改为仅计时"
                  : "可直接开始计时；开启摄像头可查看关节点和背景虚化"
                : active
                  ? "点击「继续训练」，重新检查站位"
                  : "选好动作，点击「开始训练」，按提示站到画面中")}
          </p>
          <small>
            {uiText("视频仅在本机处理")}
            {uiText(!timed && p.voiceAvailable ? " · 语音随训练开启" : "")}
          </small>
        </div>
      )}

      {state.status === "resting" && (cameraLive || !!timed) && (
        <div className="session-overlay">
          <p>{uiText(afterRest ? `休息后 · ${afterRest}` : "休息一下，保持呼吸")}</p>
          <strong>{uiText(time(state.remaining))}</strong>
          <button
            onClick={() =>
              void control({ type: "session", action: "cancel_rest" })
            }
          >
            {uiText("提前结束休息 ")}<ArrowUpRight size={16} />
          </button>
          {skipTo && (
            <button className="skip-sets" onClick={() => void control({ type: "skip_remaining_sets" })}>
              {uiText("跳过剩余组，开始")}{uiText(skipTo)}
            </button>
          )}
        </div>
      )}
      {state.status === "paused" && (cameraLive || !!timed) && (
        <div className="session-overlay">
          <Pause size={32} />
          <h2>{uiText("训练已暂停")}</h2>
          <p>{uiText("准备好后，点击「继续训练」")}</p>
        </div>
      )}

      <div className="stage-bottom stage-hud" inert={p.hudHidden}>
        {p.visible && !p.hudHidden && p.loaded && p.exerciseReference && (
          <ExerciseReference
            movement={p.movement}
            exercise={state.exercise}
            size={p.referenceSize}
            setSize={p.setReferenceSize}
            explainAvailable={p.voiceAvailable}
            explain={p.explainExercise}
            close={async () => {
              await p.setExerciseReference(false);
              referenceButton.current?.focus();
            }}
            report={p.report}
          />
        )}
        {subtitle && (
          <div className={`coach-subtitle ${replyExpanded ? "expanded" : ""}`}>
            <div className="subtitle-heading">
              <span>{uiText(p.latest?.role === "user" ? "你" : "教练")}</span>
              <button
                aria-expanded={replyExpanded}
                onClick={() => setReplyExpanded(!replyExpanded)}
              >
                {uiText(replyExpanded ? "收起回复" : "展开回复")}
                <ChevronDown size={15} />
              </button>
            </div>
            {p.heard && p.latest?.role !== "user" && (
              <p className="heard-transcript" title={p.heard}>
                {uiText("听到：")}{p.heard}
              </p>
            )}
            <CoachMarkdown text={subtitle} />
          </div>
        )}
        <div className="call-dock" aria-label={uiText("训练控制")}>
          <button
            className={`dock-device ${p.cameraStatus === "on" ? "is-on" : ""}`}
            disabled={!p.loaded}
            aria-label={
              uiText(p.cameraStatus === "loading"
                ? "取消开启摄像头"
                : p.cameraStatus === "on"
                  ? "关闭摄像头"
                  : "开启摄像头")
            }
            title={
              uiText(p.cameraStatus === "loading"
                ? "取消开启摄像头"
                : p.cameraStatus === "on"
                  ? "关闭摄像头"
                  : "开启摄像头")
            }
            aria-pressed={p.cameraStatus === "on"}
            onClick={() =>
              p.cameraStatus !== "off" ? p.closeCamera() : void p.startCamera()
            }
          >
            {p.cameraStatus === "on" ? (
              <Camera size={22} />
            ) : (
              <CameraOff size={22} />
            )}
          </button>
          <button
            className="primary training-action"
            disabled={!p.loaded || p.cameraStatus === "loading"}
            onClick={() =>
              void control({
                type: "session",
                action: !active
                  ? "start"
                  : state.status === "paused" || (!timed && !cameraLive)
                    ? "resume"
                    : "pause",
              })
            }
          >
            {active && state.status !== "paused" && (cameraLive || !!timed) ? (
              <Pause size={20} />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
            {uiText(p.cameraStatus === "loading"
              ? "连接中…"
              : !active
                ? "开始训练"
                : state.status === "paused" || (!timed && !cameraLive)
                  ? "继续训练"
                  : "暂停训练")}
          </button>
          <button
            className={`dock-device ${p.micOn ? "is-on" : ""}`}
            disabled={!p.loaded || !p.voiceAvailable}
            aria-label={uiText(p.micOn ? "静音麦克风" : "开启麦克风")}
            title={uiText(p.micOn ? "静音麦克风" : "开启麦克风")}
            aria-pressed={p.micOn}
            onClick={() => void p.toggleMic()}
          >
            {p.micOn ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
          <div className="dock-meta">
            <button
              className="voice-guide-trigger"
              aria-haspopup="dialog"
              onClick={p.showVoiceGuide}
            >
              {uiText("你可以这样说 ")}<ChevronDown size={13} />
            </button>
            <div
              className={`voice-status ${p.micOn ? "is-listening" : ""}`}
              role="status"
            >
              {p.micOn ? (
                <span className="voice-wave" aria-hidden="true">
                  {[0.5, 1, 0.7, 1, 0.5].map((n, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${5 + Math.min(14, p.level * 150) * n}px`,
                      }}
                    />
                  ))}
                </span>
              ) : (
                <span className="dot" />
              )}
              <span title={uiText(micStatus)}>{uiText(micStatus)}</span>
              {p.speaking && (
                <button aria-label={uiText("停止教练回复")} onClick={p.cancel}>
                  <Square size={12} />{uiText(" 停止回复")}
                </button>
              )}
            </div>
            {active && !inPlan && (
              <button
                className="finish-action"
                disabled={p.cameraStatus === "loading"}
                onClick={() => void control({ type: "new_set" })}
              >
                <Plus size={18} />
                <span>{uiText("再来一组")}</span>
              </button>
            )}
            {inPlan && state.status==="training" && <button className="finish-action" onClick={()=>void control({type:"complete_plan_set"})}>
              <Check size={18}/>{uiText("完成本组")}</button>}
            {active && (
              <button
                className="finish-action save-action"
                onClick={() => void control({ type: "session", action: "end" })}
              >
                <Check size={19} />
                <span>{uiText(inPlan ? "结束计划并保存" : "结束并保存")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {p.hudHidden && (
        <button
          className="restore-hud"
          onClick={() => p.onHudHidden(false)}
          aria-label={uiText("显示画面控件")}
        >
          <Eye size={18} />
          <span>{uiText("显示控件")}</span>
          {p.micOn && <span className="dot live" />}
        </button>
      )}

      <dialog
        ref={exerciseDialog}
        className="training-dialog exercise-dialog"
        aria-labelledby="exercise-title"
        onCancel={() => setExerciseOpen(false)}
        onClose={() => {
          setExerciseOpen(false);
          setManagingShortcuts(false);
          exerciseButton.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === exerciseDialog.current) setExerciseOpen(false);
        }}
      >
        <div className="dialog-heading">
          <div>
            <small>{uiText("选择本组动作")}</small>
            <h2 id="exercise-title">{uiText("今天，练什么？")}</h2>
          </div>
          <button
            aria-label={uiText("关闭动作选择")}
            onClick={() => setExerciseOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <p className="exercise-help">
          {uiText(inPlan
            ? "计划进行中，请先结束计划再切换动作。"
            : active
              ? "切换动作会保存当前组，新一组从零开始。"
              : "选择动作后，按画面提示调整镜头。")}
        </p>
        <div
          className="exercise-options"
          onKeyDown={(e) => {
            const step = {
              ArrowRight: 1,
              ArrowLeft: -1,
              ArrowDown: 2,
              ArrowUp: -2,
            }[e.key];
            if (!step) return;
            const buttons = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ];
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (current >= 0) {
              e.preventDefault();
              buttons[
                (current + step + buttons.length) % buttons.length
              ]?.focus();
            }
          }}
        >
          {p.shortcuts.map(slug=>{
            const item=catalogBySlug.get(slug);
            const id=item?.trainingExercise ?? builtInExercises.get(slug);
            if (!item && !id) return null;
            const selected=timed ? timed.movement.slug===slug : id===state.exercise;
            const spec=id ? EXERCISES[id] : undefined;
            const joints=spec?.signal==="elbow" ? "肩 · 肘 · 手腕" : spec?.signal==="knee" ? "髋 · 膝 · 脚踝" : spec?.signal==="hip" ? "肩 · 髋 · 膝" : "肩 · 髋 · 脚踝";
            return <button key={slug} aria-pressed={selected} className={selected ? "selected" : ""} disabled={inPlan || !p.loaded}
              onClick={()=>{
                if (id) void control({type:"set_exercise",exercise:id});
                else if (item) void p.selectMovement(item);
                setExerciseOpen(false);
              }}>
              <span>{uiText(spec?.label ?? item?.name)}{selected && <Check size={18}/>}</span>
              <small>{uiText(spec ? (id==="plank" ? "姿态计时" : "自动计数")+" · "+joints : item && movementCapability(item))}</small>
            </button>;
          })}
        </div>
        {p.library.failed && <button onClick={p.library.reload}>{uiText("动作库未能读取，重新加载")}</button>}
        {!p.shortcuts.length && <p className="exercise-help">{uiText("快捷列表还是空的，添加你想练的动作即可开始。")}</p>}
        <div className="exercise-list-actions">
          <button
            disabled={!p.loaded || inPlan}
            onClick={() => setManagingShortcuts(true)}
          >
            <Settings2 size={17} aria-hidden="true" />{uiText(" 管理快捷动作")}
          </button>
          <button
            disabled={inPlan}
            onClick={() => {
              setExerciseOpen(false);
              p.openPlans();
            }}
          >
            <ListChecks size={17} aria-hidden="true" />{uiText(" 编排训练计划")}
          </button>
        </div>
        <p className="exercise-help">
          {uiText("全部动作可使用摄像头、关节点和计时记录。自动计数能力以动作标识为准。")}
        </p>
      </dialog>

      {exerciseOpen && managingShortcuts && p.visible && <MovementPicker mode="home" {...p.library} favorites={p.favorites}
        shortcuts={p.shortcuts} onSave={p.saveShortcuts} onClose={()=>setManagingShortcuts(false)}/>}
      <dialog
        ref={dialog}
        className="training-dialog"
        aria-labelledby="training-settings-title"
        onCancel={() => setSettingsOpen(false)}
        onClose={() => {
          setSettingsOpen(false);
          settingsButton.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setSettingsOpen(false);
        }}
      >
        <div className="training-dialog-content">
          <div className="dialog-heading">
            <div>
              <small>{uiText(inPlan ? "计划训练" : "调整你的节奏")}</small>
              <h2 id="training-settings-title">{uiText("训练设置")}</h2>
            </div>
            <button
              aria-label={uiText("关闭训练设置")}
              onClick={() => setSettingsOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <p className="camera-diagnostic">
            {uiText(p.cameraStatus === "on"
              ? `摄像头已开启 · ${p.fps} FPS`
              : "摄像头已关闭")}{" "}
            ·{" "}
            {uiText(state.catalogPlan ? "关闭摄像头会暂停计划" : timed
              ? "关闭摄像头暂停自动统计，训练时长继续"
              : "关闭摄像头会暂停计数")}
          </p>
          {timed && (
            <label className="compact-field">
              {uiText("摄像头自动统计")}
              <input
                type="checkbox"
                checked={timed.cameraStatistics}
                disabled={active || !timed.cameraStatisticsAvailable}
                onChange={(e) => p.onCameraStatistics(e.target.checked)}
              />
              <small>
                {uiText(!timed.cameraStatisticsAvailable ? "此动作仅计时，可手动填写次数" : inPlan ? "计划中按动作自动统计" : active ? "结束本组后可切换" : "关闭后仅计时，可手动填写次数")}
              </small>
            </label>
          )}
          {inPlan ? (
            <section className="plan-settings-summary">
              <strong>{uiText(afterRest ? `休息后 · ${afterRest}` : name)}</strong>
              <small>{uiText(afterRest ? "下一组开始后可调整。" : "调整仅用于本组，下一组仍按原计划执行。")}</small>
              {!afterRest && settingsOpen && planSetId && (
                <PlanSetFields
                  key={JSON.stringify([planSetId, goal, state.load, planRest])}
                  goal={goal} load={state.load} rest={planRest} isHold={isHold} last={!!lastPlanSet}
                  onApply={(target, load, rest) => void control({
                    type: "adjust_plan_set", setId: planSetId, target, load, rest,
                  })}
                />
              )}
            </section>
          ) : <div className="goal-setting">
            <label htmlFor="goal">
              {uiText("本组目标 ")}<small>{uiText(isHold ? "秒" : "次")}</small>
            </label>
            <div className="stepper">
              <button
                aria-label={uiText("减少目标")}
                disabled={goal <= 1}
                onClick={() => changeGoal(goal - 1)}
              >
                <Minus size={16} />
              </button>
              <input
                id="goal"
                aria-label={uiText("本组目标")}
                type="number"
                min={1}
                max={isHold ? 600 : 100}
                value={goal}
                onChange={(e) => changeGoal(+e.target.value)}
              />
              <button
                aria-label={uiText("增加目标")}
                disabled={goal >= (isHold ? 600 : 100)}
                onClick={() => changeGoal(goal + 1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>}
          {!afterRest && <div className="rest-control">
            <span>{uiText(lastPlanSet ? "最后一组" : inPlan ? "立即完成本组并休息" : "立即开始休息")}</span>
            <div>
              {lastPlanSet ? (
                <button disabled={state.status !== "training"} onClick={() => {
                  void control({ type: "complete_plan_set" });
                  setSettingsOpen(false);
                }}>{uiText("完成计划")}</button>
              ) : [30, 60, 90].map((seconds) => (
                <button
                  key={seconds}
                  disabled={!active || (inPlan && state.status !== "training")}
                  onClick={() => {
                    void control({ type: "rest_timer", seconds });
                    setSettingsOpen(false);
                  }}
                >
                  {seconds}{uiText(" 秒")}
                </button>
              ))}
            </div>
          </div>}
          {!inPlan && <label className="compact-field">
            {uiText("负重 / kg")}
            <input
              type="number"
              min={0}
              max={500}
              value={state.load}
              onChange={(e) =>
                void control({ type: "set_load", kg: +e.target.value })
              }
            />
          </label>}
          {!timed && (
            <>
              <label className="compact-field">
                {uiText("参考下放节奏 / 秒")}
                <input
                  type="number"
                  step={0.5}
                  min={0.5}
                  max={10}
                  value={state.tempo}
                  disabled={state.catalogPlan?.between}
                  onChange={(e) =>
                    void control({
                      type: "set_tempo",
                      eccentric_s: +e.target.value,
                    })
                  }
                />
              </label>
              <label className="compact-field">
                {uiText("动作纠错播报")}
                <input
                  type="checkbox"
                  checked={state.cues}
                  disabled={state.catalogPlan?.between}
                  onChange={(e) =>
                    void control({ type: "cues", enabled: e.target.checked })
                  }
                />
              </label>
              <details>
                <summary>
                  {uiText("拍摄与计数检查 ")}<ChevronDown size={16} />
                </summary>
                <TrainingDetails state={state} control={control} />
              </details>
            </>
          )}
          {p.summary && (
            <div className="training-summary">
              <Check size={16} />
              <p>{uiText(p.summary)}</p>
            </div>
          )}
        </div>
      </dialog>
    </main>
  );
}
