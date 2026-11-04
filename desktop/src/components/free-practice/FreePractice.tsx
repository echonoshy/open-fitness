import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Dumbbell,
  Library,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  filterMovements,
  loadMovementLibrary,
  movementEquipment,
  movementLevels,
  movementMuscles,
  type Movement,
} from "../../core/movement-library";
import { resolvePracticeCommand } from "./voice-commands";
import { useCamera } from "./use-camera";
import { useVoiceControl } from "./use-voice-control";

function CameraPreview({
  stream,
  mirror,
}: {
  stream: MediaStream;
  mirror: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = ref.current!;
    let cancelled = false;
    setFailed(false);
    element.srcObject = stream;
    void element.play().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <video
        ref={ref}
        autoPlay
        muted
        playsInline
        onPlaying={() => setFailed(false)}
        className={mirror ? "mirrored" : ""}
        aria-label="摄像头对照画面"
      />
      {failed && (
        <button
          className="secondary camera-retry"
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setFailed(false))
              .catch(() => {});
          }}
        >
          点击显示摄像头画面
        </button>
      )}
    </>
  );
}

import "./free-practice.css";
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
};
const labels = (values: string[], map: Record<string, string>) =>
  values.map((v) => map[v] ?? v).join(" · ");

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = "";
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const b = ref.current.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Poster({
  item,
  loading = "lazy",
}: {
  item: Movement;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="poster-fallback">
      <Dumbbell size={36} />
      <span>{item.name}</span>
    </div>
  ) : (
    <img
      src={item.poster}
      alt={`${item.name}动作示范`}
      loading={loading}
      onError={() => setFailed(true)}
    />
  );
}

function Preview({ item }: { item: Movement }) {
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = preview.current;
    const pauseHidden = () => {
      if (document.hidden) element?.pause();
    };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      element?.pause();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, [nonce]);
  return (
    <div className="detail-media">
      {failed ? (
        <>
          <Poster item={item} />
          <button
            className="secondary"
            onClick={() => {
              setNonce((n) => n + 1);
              setFailed(false);
            }}
          >
            重新加载示范
          </button>
        </>
      ) : (
        <video
          ref={preview}
          key={nonce}
          src={item.video}
          poster={item.poster}
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="metadata"
          aria-label={`${item.name}预览视频`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

type Summary = { ms: number; slugs: string[]; last: Movement };

type FreePracticeProps = {
  saved: string[];
  saveMovements: (update: (current: string[]) => string[]) => Promise<void>;
  initialMovement: Movement | null;
  openLibrary: () => void;
  onSessionChange: (active: boolean) => void;
  preferredCamera?: string;
  preferredMicrophone?: string;
  onDeviceChange: (
    kind: "camera" | "microphone",
    id: string,
    label: string,
  ) => void;
};
function FreePractice({
  saved,
  saveMovements,
  initialMovement,
  openLibrary,
  onSessionChange,
  preferredCamera,
  preferredMicrophone,
  onDeviceChange,
}: FreePracticeProps) {
  const [items, setItems] = useState<Movement[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [manage, setManage] = useState(false);
  const [detail, setDetail] = useState<Movement | null>(null);
  const [toast, setToast] = useState("");
  const [current, setCurrent] = useState<Movement | null>(null);
  const [requestedPlay, setRequestedPlay] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [mediaMessage, setMediaMessage] = useState("");
  const [nonce, setNonce] = useState(0);
  const [speed, setSpeed] = useState("1");
  const [totalMs, setTotalMs] = useState(0);
  const [actionMs, setActionMs] = useState(0);
  const [visited, setVisited] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [pickerScope, setPickerScope] = useState<"mine" | "all">("mine");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerLimit, setPickerLimit] = useState(20);
  const [voiceMatches, setVoiceMatches] = useState<Movement[] | null>(null);
  const [showAllTips, setShowAllTips] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastSession, setLastSession] = useState<Summary | null>(null);
  const pickerResume = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const myItems = useMemo(
    () =>
      saved
        .map((slug) => items.find((item) => item.slug === slug))
        .filter((item): item is Movement => !!item),
    [saved, items],
  );
  const pickerResults = useMemo(
    () =>
      voiceMatches ??
      filterMovements(pickerScope === "mine" ? myItems : items, {
        query: pickerQuery,
      }),
    [items, myItems, pickerScope, pickerQuery, voiceMatches],
  );
  const camera = useCamera(!!current, preferredCamera, (id, label) =>
    onDeviceChange("camera", id, label),
  );
  const voice = useVoiceControl(
    !!current,
    handleVoiceCommand,
    preferredMicrophone,
    (id, label) => onDeviceChange("microphone", id, label),
  );
  const cameraEnabled = camera.status === "on" || camera.status === "loading";
  const voiceEnabled = !["off", "error"].includes(voice.status);
  const voiceLabel = {
    off: "语音未开启",
    loading: "正在开启麦克风…",
    listening: "正在听",
    hearing: "听到你了…",
    recognizing: "正在识别…",
    error: "语音未开启",
  }[voice.status];
  const working =
    !!current && requestedPlay && advancing && !picker && !mediaFailed;

  const load = () => {
    setLoadState("loading");
    loadMovementLibrary()
      .then((data) => {
        setItems(data);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  };
  useEffect(load, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [current?.slug]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setPickerLimit(20);
  }, [pickerQuery, pickerScope]);
  useEffect(() => {
    if (!working) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setTotalMs((v) => v + delta);
      setActionMs((v) => v + delta);
    };
    const id = window.setInterval(tick, 200);
    return () => {
      clearInterval(id);
      tick();
    };
  }, [working]);
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) {
        setRequestedPlay(false);
        pickerResume.current = false;
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element || !current) return;
    element.playbackRate = Number(speed);
    let cancelled = false;
    if (requestedPlay && !picker && !mediaFailed) {
      void element.play().catch(() => {
        if (!cancelled) {
          setRequestedPlay(false);
          setMediaMessage("点击继续跟练，播放动作示范。");
        }
      });
    } else element.pause();
    return () => {
      cancelled = true;
    };
  }, [current, requestedPlay, picker, speed, nonce, mediaFailed]);

  const [saving, setSaving] = useState(false);
  const editMovements = async (
    update: (current: string[]) => string[],
    message: string,
  ) => {
    setSaving(true);
    try {
      await saveMovements(update);
      setToast(message);
    } catch {
      setToast("动作列表未能保存，请重试。");
    } finally {
      setSaving(false);
    }
  };
  const add = (item: Movement) => {
    if (saved.includes(item.slug) || saving) return;
    void editMovements(
      (values) =>
        values.includes(item.slug) ? values : [...values, item.slug],
      `已将「${item.name}」添加到我的动作`,
    );
  };
  const start = (item: Movement) => {
    voice.invalidate();
    setDetail(null);
    setSummary(null);
    setCurrent(item);
    setTotalMs(0);
    setActionMs(0);
    setVisited([]);
    setRequestedPlay(true);
    setAdvancing(false);
    setMediaFailed(false);
    setMediaMessage("");
    setShowAllTips(false);
    setSpeed("1");
    window.scrollTo(0, 0);
  };
  const openPicker = () => {
    voice.invalidate();
    if (!picker) pickerResume.current = requestedPlay;
    setRequestedPlay(false);
    setPicker(true);
    setPickerScope("mine");
    setPickerQuery("");
    setVoiceMatches(null);
  };
  const closePicker = () => {
    voice.invalidate();
    setPicker(false);
    setRequestedPlay(pickerResume.current);
  };
  const switchTo = (item: Movement) => {
    voice.invalidate();
    const changed = item.slug !== current?.slug;
    setPicker(false);
    setCurrent(item);
    setRequestedPlay(true);
    setMediaMessage("");
    setShowAllTips(false);
    if (changed) {
      setActionMs(0);
      setAdvancing(false);
      setMediaFailed(false);
    }
    setToast(changed ? `现在跟练：${item.name}` : "继续当前动作");
  };
  const end = () => {
    if (!current) return;
    camera.stop();
    voice.stop();
    setPicker(false);
    const result = { ms: totalMs, slugs: visited, last: current };
    setRequestedPlay(false);
    setAdvancing(false);
    setCurrent(null);
    setSummary(result);
    setLastSession(result);
  };
  function handleVoiceCommand(text: string): string {
    if (!current) return "请先开始跟练。";
    const command = resolvePracticeCommand(
      text,
      items,
      picker ? pickerResults.slice(0, pickerLimit) : undefined,
    );
    switch (command.kind) {
      case "pause":
        pickerResume.current = false;
        setRequestedPlay(false);
        return "已暂停跟练，准备好后说「继续」。";
      case "resume":
        if (mediaFailed) return "示范暂时无法播放，请先点击重新加载。";
        setPicker(false);
        setRequestedPlay(true);
        setMediaMessage("");
        return "继续跟练。";
      case "picker":
        openPicker();
        return "已打开动作列表，说出动作名称，或说「第一个」。";
      case "cancel":
        closePicker();
        return "已返回当前动作。";
      case "next": {
        if (myItems.length < 2) {
          openPicker();
          return "再选一个动作，继续练。";
        }
        const next =
          myItems[
            (myItems.findIndex((item) => item.slug === current.slug) + 1) %
              myItems.length
          ];
        switchTo(next);
        return `已切换到${next.name}。`;
      }
      case "movement":
        switchTo(command.item);
        return `已切换到${command.item.name}。`;
      case "search":
        openPicker();
        setPickerScope("all");
        setPickerQuery(command.query);
        setVoiceMatches(command.matches);
        return command.matches.length
          ? `找到 ${command.matches.length} 个动作，请说完整名称或序号。`
          : `没找到「${command.query}」，换个名称试试。`;
      default:
        return "可以说「暂停」「继续」「切换动作」，或「换成 + 动作名称」。";
    }
  }
  function renderVoiceStatus() {
    return (
      <div
        className={`practice-voice-status ${voiceEnabled ? "is-listening" : ""}`}
        role="status"
        aria-live="polite"
      >
        <div className="practice-voice-status-heading">
          <span
            className="voice-indicator"
            style={{
              opacity: voiceEnabled
                ? Math.min(1, 0.35 + voice.level * 7)
                : 0.35,
            }}
          />
          <strong>{voiceLabel}</strong>
        </div>
        <span>
          {voice.transcript && (
            <span className="heard-text">听到「{voice.transcript}」 · </span>
          )}
          {voice.message || "开启后，直接说「暂停」「继续」「切换动作」。"}
        </span>
      </div>
    );
  }
  useEffect(() => {
    if (initialMovement) start(initialMovement);
  }, [initialMovement]);
  useEffect(() => {
    onSessionChange(!!current);
  }, [!!current, onSessionChange]);
  useEffect(() => () => onSessionChange(false), [onSessionChange]);

  function renderCard({
    item,
    home = false,
  }: {
    item: Movement;
    home?: boolean;
  }) {
    const added = saved.includes(item.slug);
    return (
      <article className="movement-card" key={item.slug}>
        <button
          className="card-cover"
          onClick={() => setDetail(item)}
          aria-label={`查看${item.name}示范`}
        >
          <Poster item={item} />
          <span className="cover-play">
            <Play size={18} fill="currentColor" />
          </span>
        </button>
        <div className="card-body">
          <div className="card-title">
            <h3>{item.name}</h3>
            <span>{movementLevels[item.level] ?? item.level}</span>
          </div>
          <p>{labels(item.primaryMuscles.slice(0, 2), movementMuscles)}</p>
          <div className="card-bottom">
            <span className="equipment-label">
              <Dumbbell size={14} />
              {labels(item.equipment, movementEquipment)}
            </span>
            {home ? (
              manage ? (
                <button
                  className="remove-button"
                  aria-label={`移除${item.name}`}
                  disabled={saving}
                  onClick={() =>
                    void editMovements(
                      (v) => v.filter((s) => s !== item.slug),
                      `已移除「${item.name}」，可从动作库重新添加`,
                    )
                  }
                >
                  <Trash2 size={16} />
                  移除
                </button>
              ) : (
                <button
                  className="card-start"
                  onClick={() => start(item)}
                  aria-label={`开始跟练${item.name}`}
                >
                  <Play size={14} fill="currentColor" />
                  开始
                </button>
              )
            ) : (
              <button
                className={`add-button ${added ? "is-added" : ""}`}
                disabled={added || saving}
                aria-label={added ? `${item.name}已添加` : `添加${item.name}`}
                onClick={() => add(item)}
              >
                {added ? <Check size={16} /> : <Plus size={16} />}
                {added ? "已添加" : "添加"}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className={`free-practice ${current ? "is-practicing" : ""}`}>
      {loadState !== "ready" ? (
        <main className="loading-state">
          {loadState === "loading" ? (
            <>
              <LoaderCircle className="spin" />
              <h1>正在准备动作…</h1>
            </>
          ) : (
            <>
              <Library size={36} />
              <h1>动作暂时无法读取</h1>
              <p>请检查本地动作素材后重新加载。</p>
              <button className="primary" onClick={load}>
                重新加载
              </button>
            </>
          )}
        </main>
      ) : current ? (
        <main className="practice-page">
          <div className="practice-heading">
            <div>
              <p className="eyebrow">当前动作</p>
              <h1>{current.name}</h1>
              <p className="muted">
                {labels(current.primaryMuscles, movementMuscles)}
                <span className="separator">/</span>
                {labels(current.equipment, movementEquipment)}
              </p>
            </div>
            <div className="practice-clock">
              <span>本次跟练计时</span>
              <strong data-testid="session-time">{clock(totalMs)}</strong>
            </div>
          </div>
          <section className="device-tools" aria-label="跟练辅助">
            <div className="device-tool-buttons">
              <button
                className={`secondary ${cameraEnabled ? "device-enabled" : ""}`}
                aria-pressed={cameraEnabled}
                onClick={() =>
                  cameraEnabled ? camera.stop() : void camera.start()
                }
              >
                {cameraEnabled ? <CameraOff size={18} /> : <Camera size={18} />}
                {cameraEnabled ? "关闭摄像头" : "开启摄像头对照"}
              </button>
              <button
                className={`secondary ${voiceEnabled ? "device-enabled" : ""}`}
                aria-pressed={voiceEnabled}
                onClick={() =>
                  voiceEnabled ? voice.stop() : void voice.start()
                }
              >
                {voiceEnabled ? <MicOff size={18} /> : <Mic size={18} />}
                {voiceEnabled ? "关闭语音控制" : "开启语音控制"}
              </button>
              {voice.devices.length > 1 && (
                <select
                  aria-label="选择麦克风"
                  value={voice.device}
                  onChange={(e) => void voice.start(e.target.value)}
                >
                  {voice.devices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `麦克风 ${index + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {renderVoiceStatus()}
            <p className="device-privacy">
              摄像头画面仅在本机显示；开启语音后，说话片段交给语音服务识别。
            </p>
            {camera.error && (
              <p className="device-error" role="alert">
                {camera.error}
              </p>
            )}
          </section>
          <div
            className={`practice-layout ${cameraEnabled ? "with-camera" : ""}`}
          >
            <div className="practice-visuals">
              <div className="video-stage">
                {mediaFailed ? (
                  <>
                    <Poster item={current} />
                    <div className="video-overlay">
                      <p>示范暂时无法播放</p>
                      <button
                        className="primary"
                        onClick={() => {
                          setMediaFailed(false);
                          setMediaMessage("");
                          setNonce((n) => n + 1);
                          setRequestedPlay(true);
                        }}
                      >
                        重新加载示范
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <video
                      ref={video}
                      key={`${current.slug}-${nonce}`}
                      src={current.video}
                      poster={current.poster}
                      muted
                      loop
                      playsInline
                      preload="auto"
                      aria-label={`${current.name}跟练示范`}
                      onPlaying={() => {
                        setAdvancing(true);
                        setMediaMessage("");
                        setVisited((v) =>
                          v.includes(current.slug) ? v : [...v, current.slug],
                        );
                      }}
                      onPause={() => setAdvancing(false)}
                      onWaiting={() => setAdvancing(false)}
                      onError={() => {
                        setMediaFailed(true);
                        setRequestedPlay(false);
                        setAdvancing(false);
                      }}
                    />
                    {!requestedPlay && !picker && (
                      <div className="video-overlay">
                        <button
                          className="video-resume"
                          onClick={() => {
                            voice.invalidate();
                            setRequestedPlay(true);
                          }}
                          aria-label="继续播放示范"
                        >
                          <Play size={30} fill="currentColor" />
                        </button>
                        <span>已暂停，准备好后继续</span>
                      </div>
                    )}
                    {requestedPlay && !advancing && !picker && (
                      <div className="video-loading">
                        <LoaderCircle className="spin" size={20} />
                        正在加载示范…
                      </div>
                    )}
                  </>
                )}
                <div className="video-speed">
                  <label htmlFor="speed">演示速度</label>
                  <select
                    id="speed"
                    value={speed}
                    onChange={(e) => setSpeed(e.target.value)}
                  >
                    <option value="0.5">0.5×</option>
                    <option value="0.75">0.75×</option>
                    <option value="1">1×</option>
                  </select>
                </div>
              </div>
              {cameraEnabled && (
                <section className="camera-panel" aria-label="摄像头对照">
                  <div className="camera-stage">
                    {camera.stream ? (
                      <CameraPreview
                        stream={camera.stream}
                        mirror={camera.mirror}
                      />
                    ) : (
                      <div className="camera-loading">
                        <LoaderCircle size={26} className="spin" />
                        <p>正在开启摄像头…</p>
                        <span>首次使用请允许摄像头权限</span>
                      </div>
                    )}
                    <span className="camera-label">
                      <Camera size={15} />
                      你的画面
                    </span>
                    {camera.stream && (
                      <span className="camera-hint">
                        调整站位，让全身进入画面
                      </span>
                    )}
                  </div>
                  <div className="camera-toolbar">
                    <select
                      aria-label="选择摄像头"
                      value={camera.device}
                      disabled={camera.status !== "on"}
                      onChange={(e) => void camera.start(e.target.value)}
                    >
                      {!camera.devices.length && (
                        <option value={camera.device}>默认摄像头</option>
                      )}
                      {camera.devices.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `摄像头 ${index + 1}`}
                        </option>
                      ))}
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        checked={camera.mirror}
                        onChange={(e) => camera.setMirror(e.target.checked)}
                      />
                      镜像
                    </label>
                  </div>
                </section>
              )}
            </div>
            <aside className="practice-tips">
              <span className="eyebrow">跟着看，慢慢来</span>
              <h2>动作要领</h2>
              <ol>
                {current.instructions
                  .slice(0, showAllTips ? undefined : 3)
                  .map((tip, i) => (
                    <li key={i}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <p>{tip}</p>
                    </li>
                  ))}
              </ol>
              {current.instructions.length > 3 && (
                <button
                  className="text-button"
                  onClick={() => setShowAllTips((v) => !v)}
                >
                  {showAllTips
                    ? "收起要领"
                    : `查看全部 ${current.instructions.length} 条`}
                  <ChevronDown
                    size={16}
                    className={showAllTips ? "rotated" : ""}
                  />
                </button>
              )}
              <div className="practice-note">
                <span>你的节奏，你做主。</span>
                <p>想歇一会就暂停，想换一个动作也随时可以。</p>
              </div>
            </aside>
          </div>
          <div className="practice-controls">
            <div className="current-time">
              <Clock3 size={17} />
              <span>
                当前动作 <b data-testid="action-time">{clock(actionMs)}</b>
              </span>
            </div>
            <div className="control-buttons">
              <button className="secondary" onClick={openPicker}>
                <Repeat2 size={18} />
                切换动作
              </button>
              <button
                className="primary play-control"
                disabled={mediaFailed}
                onClick={() => {
                  voice.invalidate();
                  setMediaMessage("");
                  setRequestedPlay((v) => !v);
                }}
              >
                {requestedPlay ? (
                  <Pause size={19} fill="currentColor" />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
                {requestedPlay ? "暂停跟练" : "继续跟练"}
              </button>
              <button className="text-button finish" onClick={end}>
                结束练习
              </button>
            </div>
            <span className="control-footnote">按开始与暂停计时</span>
          </div>
          {mediaMessage && (
            <p className="media-message" role="status">
              {mediaMessage}
            </p>
          )}
        </main>
      ) : (
        <div className="home-page page-container practice-library-home">
          <section className="welcome">
            <div>
              <p className="eyebrow">我的跟练</p>
              <h1>跟着示范，轻松练</h1>
              <p>收藏常练动作，按自己的节奏跟练；这里不自动计数。</p>
            </div>
            <div className="welcome-note">
              <Repeat2 size={22} />
              <span>
                看示范 · 自由练
                <br />
                <small>无需开启摄像头</small>
              </span>
            </div>
          </section>
          <div className="section-heading">
            <div>
              <h2>
                我的动作{" "}
                <span>{myItems.length.toString().padStart(2, "0")}</span>
              </h2>
              <p>把喜欢的动作留在这里，想练就开始。</p>
            </div>
            <div className="section-actions">
              {myItems.length > 0 && (
                <button
                  className={`text-button ${manage ? "accent" : ""}`}
                  onClick={() => setManage((v) => !v)}
                >
                  {manage ? (
                    <Check size={16} />
                  ) : (
                    <SlidersHorizontal size={16} />
                  )}
                  {manage ? "完成管理" : "管理"}
                </button>
              )}
              <button className="primary" onClick={openLibrary}>
                <Plus size={18} />
                添加动作
              </button>
            </div>
          </div>
          {myItems.length ? (
            <div className="movement-grid home-grid">
              {myItems.map((item) => renderCard({ item, home: true }))}
            </div>
          ) : (
            <div className="empty-state">
              <Library size={36} />
              <h3>把想练的动作放进来</h3>
              <p>从动作库选几个喜欢的，随时开始。</p>
              <button className="primary" onClick={openLibrary}>
                <Plus size={18} />
                添加第一个动作
              </button>
            </div>
          )}
          {lastSession && (
            <section className="last-session">
              <div>
                <span className="eyebrow">刚刚的练习</span>
                <h3>
                  {lastSession.slugs.length} 个动作 · {clock(lastSession.ms)}{" "}
                  跟练计时
                </h3>
              </div>
              <button
                className="text-button"
                onClick={() => start(lastSession.last)}
              >
                再练一次
                <ArrowRight size={18} />
              </button>
            </section>
          )}
          <footer className="home-footer">
            <span>练多久、做几次，都由你决定。</span>
            <button className="text-button" onClick={openLibrary}>
              发现更多动作
              <ArrowRight size={17} />
            </button>
          </footer>
        </div>
      )}

      {detail && (
        <Modal
          wide
          title={detail.name}
          subtitle={`${labels(detail.equipment, movementEquipment)} / ${movementLevels[detail.level] ?? detail.level}`}
          onClose={() => setDetail(null)}
        >
          <div className="detail-layout">
            <Preview item={detail} />
            <div className="detail-copy">
              <span className="eyebrow">
                {labels(detail.primaryMuscles, movementMuscles)}
              </span>
              <p>{detail.description}</p>
              <h3>动作要领</h3>
              <ol>
                {detail.instructions.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ol>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="secondary"
              disabled={saved.includes(detail.slug) || saving}
              onClick={() => add(detail)}
            >
              {saved.includes(detail.slug) ? (
                <Check size={18} />
              ) : (
                <Plus size={18} />
              )}
              {saved.includes(detail.slug)
                ? "已添加到我的动作"
                : "添加到我的动作"}
            </button>
            <button className="primary" onClick={() => start(detail)}>
              <Play size={17} fill="currentColor" />
              开始跟练
            </button>
          </div>
        </Modal>
      )}

      {picker && current && (
        <Modal
          title="换个动作，继续练"
          subtitle="选择期间已暂停，选好后继续本次跟练。"
          onClose={closePicker}
        >
          <div className="picker-body">
            {voiceEnabled && (
              <div className="picker-voice">
                {renderVoiceStatus()}
                <button className="text-button" onClick={voice.stop}>
                  <MicOff size={15} />
                  关闭语音
                </button>
              </div>
            )}
            <div className="picker-tabs">
              <button
                aria-pressed={pickerScope === "mine"}
                onClick={() => {
                  voice.invalidate();
                  setVoiceMatches(null);
                  setPickerScope("mine");
                }}
              >
                我的动作 <span>{myItems.length}</span>
              </button>
              <button
                aria-pressed={pickerScope === "all"}
                onClick={() => {
                  voice.invalidate();
                  setVoiceMatches(null);
                  setPickerScope("all");
                }}
              >
                全部动作 <span>{items.length}</span>
              </button>
            </div>
            <div className="search-field compact">
              <Search size={18} />
              <input
                aria-label="搜索要切换的动作"
                placeholder="搜索想练的动作"
                value={pickerQuery}
                onChange={(e) => {
                  voice.invalidate();
                  setVoiceMatches(null);
                  setPickerQuery(e.target.value);
                }}
              />
            </div>
            <div className="picker-list">
              {pickerResults.slice(0, pickerLimit).map((item, index) => (
                <button
                  key={item.slug}
                  className={`picker-item ${item.slug === current.slug ? "current" : ""}`}
                  onClick={() => switchTo(item)}
                  aria-label={
                    item.slug === current.slug
                      ? `继续跟练${item.name}`
                      : `切换到${item.name}`
                  }
                >
                  <div className="picker-poster">
                    <Poster item={item} />
                    {voiceEnabled && (
                      <span className="picker-number">{index + 1}</span>
                    )}
                  </div>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {labels(item.equipment, movementEquipment)} ·{" "}
                      {labels(item.primaryMuscles.slice(0, 2), movementMuscles)}
                    </small>
                  </div>
                  {item.slug === current.slug ? (
                    <span className="current-tag">当前动作</span>
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
              ))}
              {!pickerResults.length && (
                <div className="empty-state small">
                  <p>没有找到动作，试试其他名称。</p>
                  {pickerScope === "mine" && (
                    <button
                      className="text-button"
                      onClick={() => setPickerScope("all")}
                    >
                      去全部动作里找
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}
              {pickerLimit < pickerResults.length && (
                <button
                  className="text-button picker-more"
                  onClick={() => setPickerLimit((v) => v + 20)}
                >
                  显示更多动作
                  <ChevronDown size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <span className="muted">本次计时 {clock(totalMs)}</span>
            <button className="secondary" onClick={closePicker}>
              返回当前动作
            </button>
          </div>
        </Modal>
      )}

      {summary && (
        <Modal title="这次跟练，先到这里。" onClose={() => setSummary(null)}>
          <div className="summary-body">
            <CheckCircle2 size={38} />
            <p>按自己的节奏，慢慢来就好。</p>
            <div className="summary-stats">
              <div>
                <strong>{clock(summary.ms)}</strong>
                <span>跟练计时</span>
              </div>
              <div>
                <strong>{summary.slugs.length}</strong>
                <span>本次跟练动作</span>
              </div>
            </div>
            <div className="summary-movements">
              {summary.slugs.map((slug) => {
                const item = items.find((m) => m.slug === slug);
                return item ? <span key={slug}>{item.name}</span> : null;
              })}
            </div>
            <small>按示范播放与暂停记录时间，不代表有效运动时长。</small>
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => start(summary.last)}>
              再练一次
            </button>
            <button className="primary" onClick={() => setSummary(null)}>
              回到我的动作
              <ArrowRight size={17} />
            </button>
          </div>
        </Modal>
      )}
      <div
        className={`toast ${toast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <CheckCircle2 size={18} />
            <span>{toast}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(FreePractice);
