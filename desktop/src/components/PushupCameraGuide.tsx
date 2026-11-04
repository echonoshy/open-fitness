import {
  PUSHUP_VIEW_LABELS,
  type PushupCheck,
  type PushupView,
} from "../core/pushup";

export function PushupCameraGuide({
  check,
  cameraOn,
}: {
  check?: PushupCheck;
  cameraOn: boolean;
}) {
  const current = cameraOn ? (check?.view ?? "unknown") : "unknown";
  return (
    <div className="pushup-camera-guide" aria-label="俯卧撑拍摄角度">
      <div className="camera-view-options" aria-label="支持的机位，俯视示意">
        {(["front", "oblique", "side"] as PushupView[]).map((view) => (
          <div
            key={view}
            className={current === view ? "camera-view active" : "camera-view"}
          >
            <svg
              viewBox="0 0 56 44"
              role="img"
              aria-label={`${PUSHUP_VIEW_LABELS[view]}机位俯视示意`}
            >
              <g className="camera-view-body">
                <circle cx="32" cy="26" r="3" />
                <path d="M32 23V11M26 21H38M26 21V28M38 21V28M32 11L28 4M32 11L36 4" />
              </g>
              <g
                transform={
                  view === "front"
                    ? "translate(32 39) rotate(-90)"
                    : view === "side"
                      ? "translate(6 17)"
                      : "translate(12 36) rotate(-45)"
                }
              >
                <rect x="-4" y="-3" width="7" height="6" rx="1" />
                <path d="M3-1L6-3V3L3 1M9 0H15M12-3L15 0L12 3" />
              </g>
            </svg>
            <span>{PUSHUP_VIEW_LABELS[view]}</span>
          </div>
        ))}
      </div>
      <small className="camera-view-legend">
        俯视机位 · 侧面更适合观察腰背
      </small>
      <div className="camera-view-status" role="status">
        <strong>
          {!cameraOn
            ? "开启摄像头后识别角度"
            : current === "unknown"
              ? "正在确认拍摄角度"
              : `当前：${PUSHUP_VIEW_LABELS[current]} · ${check?.ready ? "可计数" : "准备中"}`}
        </strong>
        <small>
          {cameraOn && check
            ? check.assessment
            : "镜头放低，肩、肘、手腕和髋部入镜"}
        </small>
      </div>
    </div>
  );
}
