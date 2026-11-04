import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { readAiServices, testAiServices, saveAiServices } from "../ai-services";
import {
  AI_SERVICE_NAMES,
  aiServicesDraft,
  type AiServicesDraft,
  type AiServicesTestResult,
  type AiServicesView,
} from "../core/ai-services";
import "./ai-service-settings.css";

export function AiServiceSettings({
  beforeApply,
  onSaved,
}: {
  beforeApply: () => void;
  onSaved: () => void;
}) {
  const [view, setView] = useState<AiServicesView>();
  const [draft, setDraft] = useState<AiServicesDraft>();
  const [result, setResult] = useState<AiServicesTestResult>();
  const [busy, setBusy] = useState<"load" | "test" | "save" | "">("load");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const accept = (value: AiServicesView) => {
    setView(value);
    setDraft(aiServicesDraft(value));
    setResult(undefined);
  };
  const load = async () => {
    setBusy("load");
    setError("");
    setMessage("");
    setResult(undefined);
    try {
      const value = await readAiServices();
      if (mounted.current) accept(value);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "设置读取失败");
    } finally {
      if (mounted.current) setBusy("");
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  // A successful test belongs to this exact draft, and expires on the backend.
  const edit = (next: AiServicesDraft) => {
    setDraft(next);
    setResult(undefined);
    setMessage("");
    setError("");
  };
  const test = async () => {
    if (!draft) return;
    setBusy("test");
    setResult(undefined);
    setMessage("");
    setError("");
    try {
      const value = await testAiServices(draft);
      if (mounted.current) setResult(value);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "测试失败，请重试");
    } finally {
      if (mounted.current) setBusy("");
    }
  };
  const save = async () => {
    if (!result?.ticket) return;
    setBusy("save");
    setError("");
    try {
      beforeApply();
      const value = await saveAiServices(result.ticket);
      onSaved();
      if (mounted.current) {
        accept(value);
        setMessage("已保存并生效，下次对话将使用当前配置。");
      }
    } catch (e) {
      if (mounted.current) {
        setResult(undefined);
        setError(e instanceof Error ? e.message : "保存失败，请重试");
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  };
  const hint = (configured: boolean, suffix: string) =>
    configured
      ? `已配置${suffix ? ` · 尾号 ${suffix}` : ""}，留空保留`
      : "粘贴 Agent Plan API Key";
  return (
    <section
      className="settings-card ai-service-settings"
      aria-labelledby="ai-service-title"
    >
      <div className="ai-service-heading">
        <div>
          <div className="settings-heading">
            <KeyRound size={21} />
            <h2 id="ai-service-title">AI 服务</h2>
          </div>
          <p>
            教练对话（LLM）、语音识别（ASR）和语音合成（TTS）共用一个火山引擎
            Agent Plan Key。
          </p>
        </div>
        <span className="ai-provider">Agent Plan</span>
      </div>
      {draft && view && (
        <>
          <fieldset disabled={!!busy} className="ai-key-fields">
            <div className="ai-key-section">
              <label htmlFor="ai-shared-key">Agent Plan API Key</label>
              <input
                id="ai-shared-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={draft.apiKey}
                onChange={(e) => edit({ ...draft, apiKey: e.target.value })}
                placeholder={hint(view.configured, view.suffix)}
              />
              <p>当前对话模型 · {view.model}</p>
            </div>
          </fieldset>
          <div
            className="ai-test-results"
            aria-live="polite"
            aria-busy={busy === "test"}
          >
            {busy === "test" && (
              <p className="ai-testing">
                <LoaderCircle size={16} className="ai-spin" />
                正在分别测试三项服务，通常需要几秒钟…
              </p>
            )}
            {result &&
              result.results.map((row) => (
                <div className="ai-test-row" key={row.name}>
                  <span>{AI_SERVICE_NAMES[row.name]}</span>
                  <span className={row.ok ? "ai-ok" : "ai-failed"}>
                    {row.ok
                      ? `通过 · ${(row.ms / 1000).toFixed(1)} 秒`
                      : row.error || "测试失败"}
                  </span>
                </div>
              ))}
            {result?.ticket && (
              <p className="ai-ok">
                三项测试通过，请在 5 分钟内保存。修改 Key 后需要重新测试。
              </p>
            )}
            {result && !result.ticket && (
              <p>测试未全部通过，当前使用的配置未改变。</p>
            )}
          </div>
          <div className="ai-service-actions">
            <button type="button" disabled={!!busy} onClick={() => void test()}>
              {busy === "test" ? "测试中…" : "测试连接"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!!busy || !result?.ticket}
              onClick={() => void save()}
            >
              <Check size={16} />
              {busy === "save" ? "保存中…" : "保存并生效"}
            </button>
          </div>
          <p className="ai-service-note">
            测试会发起少量真实请求，使用套餐额度。语音服务需已开启额度抵扣。保存会停止当前语音回复。
          </p>
          <p className="ai-service-note">
            Key 保存在本机，不包含在训练数据备份中。
          </p>
        </>
      )}
      {busy === "load" && <p role="status">正在读取服务设置…</p>}
      {message && (
        <p role="status" className="ai-ok">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="ai-failed">
          {error}
        </p>
      )}
      <button
        className="ai-reload"
        type="button"
        disabled={!!busy}
        onClick={() => void load()}
      >
        <RefreshCw size={14} />
        重新载入已保存配置
      </button>
    </section>
  );
}
