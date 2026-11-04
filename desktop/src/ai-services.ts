import type {
  AiServicesDraft,
  AiServicesTestResult,
  AiServicesView,
} from "./core/ai-services";
async function call(action: "get" | "test" | "save", payload?: unknown) {
  if (window.coach) return window.coach.aiServices(action, payload);
  const response = await fetch("./api/coach/ai-services", {
    method: action === "get" ? "GET" : "POST",
    ...(action !== "get"
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, payload }),
        }
      : {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "AI 服务设置暂时不可用");
  return result;
}
export const readAiServices = () => call("get") as Promise<AiServicesView>;
export const testAiServices = (draft: AiServicesDraft) =>
  call("test", draft) as Promise<AiServicesTestResult>;
export const saveAiServices = (ticket: string) =>
  call("save", ticket) as Promise<AiServicesView>;
