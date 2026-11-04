import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Minus, Plus, X } from "lucide-react";
import type { CameraCommand, CameraView } from "../core/camera-framing";
import type { Receipt } from "../core/session";
import "./camera-view-control.css";

export function CameraViewControl(p: {
  view: CameraView;
  control: (command: CameraCommand) => Promise<Receipt>;
  enabled: boolean;
  visible: boolean;
  backgroundBlur: boolean;
  blurNotice: string;
  setBackgroundBlur: (enabled: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const change = async (
    action: Extract<CameraCommand, { type: "camera_view" }>["action"],
  ) => {
    const receipt = await p.control({
      type: "camera_view",
      action,
      ...(["zoom_in", "zoom_out"].includes(action)
        ? { adjustment: "step" as const }
        : {}),
    });
    setNotice(receipt.message);
  };
  useEffect(() => {
    if (!p.enabled || !p.visible) setOpen(false);
  }, [p.enabled, p.visible]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="camera-view-control" ref={root}>
      <button
        ref={trigger}
        className="camera-view-trigger"
        aria-label="取景设置"
        aria-expanded={open}
        aria-controls={open ? "camera-view-panel" : undefined}
        title="取景设置"
        disabled={!p.enabled}
        onClick={() => {
          setOpen(!open);
          setNotice("");
        }}
      >
        <Camera size={18} aria-hidden="true" />
        <span>取景</span>
      </button>
      {open && (
        <section
          id="camera-view-panel"
          className="camera-view-panel"
          aria-label="取景设置"
        >
          <div className="camera-view-heading">
            <span>取景 · {p.view.automatic ? "自动取景" : "已固定"}</span>
            <button
              aria-label="关闭取景设置"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="camera-view-presets">
            <button
              role="switch"
              aria-checked={p.backgroundBlur}
              aria-label="背景虚化"
              onClick={() => void p.setBackgroundBlur(!p.backgroundBlur)}
            >
              背景虚化
              <span>{p.backgroundBlur ? "已开启" : "已关闭"}</span>
            </button>
          </div>
          <p>也可以说“打开背景虚化”或“关闭背景虚化”。</p>
          {p.blurNotice && <p role="status">{p.blurNotice}</p>}
          <div className="camera-view-presets">
            <button
              ref={first}
              aria-pressed={p.view.automatic}
              onClick={() => void change(p.view.automatic ? "lock" : "auto")}
            >
              {p.view.automatic ? "固定当前画面" : "恢复自动取景"}
            </button>
            <button onClick={() => void change("full")}>恢复全身</button>
          </div>
          <div className="camera-view-slider">
            <button
              aria-label="拉远画面"
              disabled={p.view.zoom <= 1.01}
              onClick={() => void change("zoom_out")}
            >
              <Minus size={18} />
            </button>
            <output aria-label="当前放大倍数">{p.view.zoom.toFixed(1)}×</output>
            <button
              aria-label="拉近画面"
              disabled={p.view.zoom >= p.view.maxZoom - 0.01}
              onClick={() => void change("zoom_in")}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="camera-view-presets">
            <button onClick={() => void change("left")}>
              <ArrowLeft size={16} />
              往左看
            </button>
            <button onClick={() => void change("right")}>
              <ArrowRight size={16} />
              往右看
            </button>
          </div>
          <p id="camera-view-help">
            说“放大一点”会明显拉近，自动取景时继续跟随。也可以说“放大到2倍”或“回到刚才”。按钮用于微调，调整后固定；最多
            {p.view.maxZoom}倍。
          </p>
          <div className="camera-view-presets">
            <button
              disabled={!p.view.canUndo}
              onClick={() => void change("undo")}
            >
              撤销上次调整
            </button>
            {p.view.automatic && (
              <button onClick={() => void change("auto")}>恢复默认取景</button>
            )}
          </div>
          {p.view.automatic && p.view.hint && (
            <p role="status">{p.view.hint}</p>
          )}
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
    </div>
  );
}
