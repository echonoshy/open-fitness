import { useUiLocale } from "../i18n";
import { Activity, Check, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import { diagnoseServices } from "../platform";

export function ServiceCheck({
  report,
  onServicesChecked,
}: {
  report: (error: unknown) => void;
  onServicesChecked?: () => void;
}) {
  const { uiText } = useUiLocale();
  const [diagnostic, setDiagnostic] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label={uiText("语音与设备检查")}>
      <div className="data-action-row">
        <span className="list-icon green-icon">
          <Activity size={21} />
        </span>
        <div>
          <h3>{uiText("语音与设备检查")}</h3>
          <p>
            {uiText("教练没有回应或摄像头、麦克风无法使用时，可检查教练服务连接和设备授权状态。")}
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setDiagnostic(null);
              void diagnoseServices()
                .then((result) => {
                  setDiagnostic(result);
                  onServicesChecked?.();
                })
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            {uiText(busy ? "处理中…" : "开始检查")}
          </button>
        </div>
      </div>
      {diagnostic !== null && <ServiceDiagnostics result={diagnostic} />}
    </section>
  );
}

const permissionLabels: Record<string, string> = {
  granted: "已授权",
  denied: "未允许",
  restricted: "受系统限制",
  prompt: "尚未授权",
  "not-determined": "尚未授权",
  unknown: "暂时无法查询",
};
export function ServiceDiagnostics({ result }: { result: unknown }) {
  const { uiText } = useUiLocale();
  const data =
    result && typeof result === "object" ? (result as Record<string, any>) : {};
  const backend = data.backend ?? data;
  const services = Array.isArray(backend.services) ? backend.services : [];
  return (
    <section
      className="service-diagnostics"
      aria-label={uiText("诊断结果")}
      role="status"
    >
      <h3>{uiText("诊断结果")}</h3>
      {backend.error && (
        <p className="muted">
          <CircleHelp size={16} />
          {uiText(String(backend.error))}
        </p>
      )}
      <div className="diagnostic-services">
        {services.map((service: any) => (
          <div key={service.name} className="diagnostic-service">
            <strong>
              {uiText({ llm: "语言模型", asr: "语音识别", tts: "语音合成" }[
                service.name as string
              ] ?? service.name)}
            </strong>
            <span className={service.ok ? "success-notice" : "muted"}>
              {service.ok ? <Check size={16} /> : <X size={16} />}
              {uiText(service.ok ? "已连接" : "连接失败")}
            </span>
            <small>
              {uiText(service.ok && typeof service.ms === "number"
                ? `${service.ms} ms`
                : service.error ||
                  (service.status
                    ? `服务返回 ${service.status}`
                    : "请稍后重试"))}
            </small>
          </div>
        ))}
      </div>
      <p className="muted">
        {uiText("摄像头：")}{uiText(permissionLabels[data.camera] ?? data.camera ?? "暂时无法查询")}{" "}
        {uiText("· 麦克风：")}
        {uiText(permissionLabels[data.microphone] ?? data.microphone ?? "暂时无法查询")}
      </p>
      <p className="panel-note">
        {uiText("此检查验证服务连接和权限。实际收音、出声与动作计数需使用设备测试。")}
      </p>
      <details className="original-instructions">
        <summary>{uiText("查看技术详情")}</summary>
        <pre className="knowledge-text diagnostic-result">
          {uiText(JSON.stringify(result, null, 2))}
        </pre>
      </details>
    </section>
  );
}
