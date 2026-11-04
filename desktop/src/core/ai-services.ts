export const AI_SERVICE_NAMES = {
  llm: "大模型 · LLM",
  asr: "语音识别 · ASR",
  tts: "语音合成 · TTS",
} as const;
export type AiServiceKind = keyof typeof AI_SERVICE_NAMES;
export type AiServicesDraft = {
  revision: string;
  apiKey: string;
};
export type AiServicesView = {
  revision: string;
  configured: boolean;
  suffix: string;
  model: string;
};
export type AiServiceTest = {
  name: AiServiceKind;
  ok: boolean;
  ms: number;
  error?: string;
};
export type AiServicesTestResult = {
  results: AiServiceTest[];
  ticket?: string;
};
export function aiServicesDraft(view: AiServicesView): AiServicesDraft {
  return { revision: view.revision, apiKey: "" };
}
