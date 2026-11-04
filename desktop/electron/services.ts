import { splitSpeech } from "../src/core/speech-segments";
import { joinPcmWavs, writePcmWav } from "../src/core/pcm-wav";
import { events } from "./sse";
import { z } from "zod";
import { COACH_VOICES, DEFAULT_VOICE, coachVoice } from "../src/core/voices";
import { loadServiceConfig, type ServiceConfig } from "./service-config";
import {
  agentPlanAsr,
  agentPlanTts,
  AgentPlanSpeechError,
} from "./agent-plan-speech";
import { agentPlanSpeaker } from "../src/core/voices";
let config = loadServiceConfig();
let configPath: string | undefined;
export const endpoints = {
  llm: config.llm.baseUrl,
  asr: config.asr.baseUrl,
  tts: config.tts.baseUrl,
};
export function configureServices(
  path?: string,
  createIfMissing = false,
  packagedKey?: string,
) {
  const loaded = loadServiceConfig(path, createIfMissing, packagedKey);
  configPath = path;
  applyServiceConfig(loaded);
}
export function currentServiceConfig(): ServiceConfig {
  if (configPath) applyServiceConfig(loadServiceConfig(configPath));
  return structuredClone(config);
}
export function voiceServiceStatus() {
  const config = currentServiceConfig();
  return {
    available: config.tts.provider !== "agent-plan" || !!config.llm.apiKey,
    usesVolcenginePresets: config.tts.provider === "agent-plan",
  };
}
export function applyServiceConfig(loaded: ServiceConfig) {
  config = structuredClone(loaded);
  for (const kind of ["llm", "asr", "tts"] as const)
    endpoints[kind] = config[kind].baseUrl;
}
function serviceHeaders(
  kind: string,
  llm = config.llm,
): Record<string, string> {
  return kind === "llm" && llm.apiKey
    ? { Authorization: `Bearer ${llm.apiKey}` }
    : {};
}
function speechConnection(kind: "asr" | "tts", config: ServiceConfig) {
  const speech = config[kind];
  const apiKey = config.llm.apiKey;
  if (!apiKey) throw new MissingServiceKey();
  return { baseUrl: speech.baseUrl, apiKey };
}
class MissingServiceKey extends Error {
  constructor() {
    super("请先在「设置 → AI 服务」填写 Agent Plan API Key");
  }
}
class ServiceHttpError extends Error {
  constructor(
    kind: string,
    readonly status: number,
  ) {
    super(`${kind.toUpperCase()} 服务错误 (${status})`);
  }
}
export async function diagnoseServices(config = currentServiceConfig()) {
  const urls = Object.fromEntries(
    (["llm", "asr", "tts"] as const).map((name) => [
      name,
      config[name].baseUrl,
    ]),
  );
  return Promise.all(
    Object.entries(urls).map(async ([name, url]) => {
      const start = Date.now();
      try {
        if (name === "llm" && config.llm.provider === "volcengine") {
          // Plan endpoints do not expose /models. Check the real response path.
          await serviceAttempt(
            "llm",
            {
              input: [{ role: "user", content: "只回复：好" }],
              tools: [],
              tool_choice: "none",
              max_output_tokens: 64,
            },
            AbortSignal.timeout(15000),
            undefined,
            config,
          );
          return { name, ok: true, status: 200, ms: Date.now() - start };
        }
        if (
          (name === "asr" || name === "tts") &&
          config[name].provider === "agent-plan"
        ) {
          const signal = AbortSignal.timeout(10000);
          if (name === "tts")
            await agentPlanTts(
              speechConnection(name, config),
              "好。",
              agentPlanSpeaker(DEFAULT_VOICE),
              signal,
            );
          else
            await agentPlanAsr(
              speechConnection(name, config),
              writePcmWav(new Uint8Array(6400), 16000),
              signal,
            );
          return { name, ok: true, status: 200, ms: Date.now() - start };
        }
        const response = await fetch(url + "/models", {
          headers: serviceHeaders(name, config.llm),
          signal: AbortSignal.timeout(6000),
        });
        await response.body?.cancel();
        return {
          name,
          ok: response.ok,
          status: response.status,
          ms: Date.now() - start,
        };
      } catch (error) {
        return {
          name,
          ok: false,
          error: serviceTestError(error),
          ms: Date.now() - start,
        };
      }
    }),
  );
}
export function serviceTestError(error: unknown): string {
  if (error instanceof MissingServiceKey) return error.message;
  if (error instanceof AgentPlanSpeechError) return error.message;
  if (error instanceof ServiceHttpError) {
    if (error.status === 401) return "Key 无效或已失效，请检查后重试";
    if (error.status === 403)
      return "没有访问权限，请检查 Agent Plan 开通和额度抵扣设置";
    if (error.status === 429) return "额度不足或请求过于频繁，请稍后重试";
    return `服务请求失败（${error.status}），请稍后重试`;
  }
  return "服务连接超时或返回异常，请检查网络后重试";
}
export async function service(
  kind: string,
  payload: unknown,
  signal: AbortSignal,
  chunk?: (data: unknown) => void,
) {
  const config = currentServiceConfig();
  if (kind !== "tts")
    return serviceAttempt(kind, payload, signal, chunk, config);
  const parsed = ttsPayload.parse(
    typeof payload === "string" ? { text: payload } : payload,
  );
  const segments = splitSpeech(parsed.text);
  const clips: Uint8Array[] = [];
  for (const text of segments) {
    signal.throwIfAborted();
    const result = await synthesizeSpeech(
      { ...parsed, text },
      signal,
      config,
      chunk,
    );
    if (!chunk) clips.push(result as Uint8Array);
  }
  signal.throwIfAborted();
  return chunk
    ? { completed: true }
    : clips.length === 1
      ? clips[0]
      : joinPcmWavs(clips);
}
const ttsPayload = z.object({
  text: z.string().trim().min(1).max(3000),
  voice: z.enum(COACH_VOICES.map((v) => v.id)).default(DEFAULT_VOICE),
});
async function synthesizeSpeech(
  payload: unknown,
  signal: AbortSignal,
  config: ServiceConfig,
  chunk?: (data: unknown) => void,
) {
  const kind = "tts";
  // Retry only before any audio has escaped, so a transient cold-start failure
  // cannot replay a sentence the user already heard. Never retry cancellation.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    let audible = false;
    const firstAudio = new AbortController();
    const timer = chunk
      ? setTimeout(() => firstAudio.abort(new Error("语音首段等待超时")), 8000)
      : undefined;
    const combined = AbortSignal.any([signal, firstAudio.signal]);
    try {
      return await serviceAttempt(
        kind,
        payload,
        combined,
        chunk
          ? (value: any) => {
              if (value.type === "audio" && value.audio?.length) {
                audible = true;
                clearTimeout(timer);
              }
              chunk(value);
            }
          : undefined,
        config,
      );
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof MissingServiceKey ||
        audible ||
        attempt === 1 ||
        (error instanceof AgentPlanSpeechError && !error.retryable) ||
        /\(4\d\d\)/.test(String(error)) ||
        error instanceof z.ZodError
      )
        throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw Error("语音服务暂不可用");
}
async function serviceAttempt(
  kind: string,
  payload: unknown,
  signal: AbortSignal,
  chunk: ((data: unknown) => void) | undefined,
  config: ServiceConfig,
) {
  signal.throwIfAborted();
  const llm = config.llm;
  if (
    ((kind === "llm" && llm.provider === "volcengine") ||
      ((kind === "asr" || kind === "tts") &&
        config[kind].provider === "agent-plan")) &&
    !llm.apiKey
  )
    throw new MissingServiceKey();
  let url = "",
    body: BodyInit,
    headers: Record<string, string> = serviceHeaders(kind, llm);
  if (kind === "llm") {
    const p = z
      .object({
        input: z.array(z.unknown()).max(100),
        tools: z.array(z.unknown()).max(30),
        tool_choice: z.enum(["required", "auto", "none"]),
        max_output_tokens: z.number().int().min(64).max(800).optional(),
        temperature: z.number().min(0).max(1).optional(),
      })
      .parse(payload);
    url = llm.baseUrl + "/responses";
    body = JSON.stringify({
      ...p,
      model: llm.model,
      stream: !!chunk,
      store: false,
      max_output_tokens: p.max_output_tokens ?? 800,
      temperature: p.temperature ?? 0.2,
      parallel_tool_calls: false,
      ...(llm.provider === "volcengine"
        ? { thinking: { type: "disabled" } }
        : { chat_template_kwargs: { enable_thinking: false } }),
    });
    headers["Content-Type"] = "application/json";
  } else if (kind === "asr") {
    const data = z
      .instanceof(Uint8Array)
      .refine((v) => v.length > 44 && v.length < 2_000_000)
      .parse(payload);
    if (config.asr.provider === "agent-plan")
      return agentPlanAsr(speechConnection("asr", config), data, signal);
    const form = new FormData();
    form.set("model", config.asr.model);
    form.set("response_format", "json");
    form.set(
      "file",
      new Blob([new Uint8Array(data)], { type: "audio/wav" }),
      "utterance.wav",
    );
    url = config.asr.baseUrl + "/audio/transcriptions";
    body = form;
  } else if (kind === "tts") {
    const p = ttsPayload.parse(
      typeof payload === "string" ? { text: payload } : payload,
    );
    if (config.tts.provider === "agent-plan")
      return agentPlanTts(
        speechConnection("tts", config),
        p.text,
        agentPlanSpeaker(p.voice),
        signal,
        chunk,
      );
    url = config.tts.baseUrl + "/audio/speech";
    body = JSON.stringify({
      model: config.tts.model,
      input: p.text,
      voice: p.voice,
      // VoxCPM rejects speed adjustment for streamed PCM (HTTP 400).
      // Keep low-latency streaming at the voice's native rate; buffered WAV
      // requests can still use the curated speed adjustment.
      speed: chunk ? 1 : coachVoice(p.voice).speed,
      ref_text: coachVoice(p.voice).referenceText,
      seed: 42,
      response_format: chunk ? "pcm" : "wav",
      stream: !!chunk,
      ...(chunk ? { stream_format: "sse" } : {}),
    });
    headers["Content-Type"] = "application/json";
  } else throw Error("未知服务");
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    signal.throwIfAborted();
    console.error(kind, response.status);
    throw new ServiceHttpError(kind, response.status);
  }
  if (chunk && (kind === "tts" || kind === "llm")) {
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      throw Error("服务未返回流式响应");
    for await (const event of events(response.body)) {
      signal.throwIfAborted();
      if (
        ["error", "response.failed", "response.incomplete"].includes(event.type)
      )
        throw Error("服务流式响应失败");
      if (event.type === "speech.audio.delta")
        chunk({
          type: "audio",
          audio: new Uint8Array(Buffer.from(event.audio, "base64")),
          sampleRate: event.sample_rate ?? 48000,
        });
      if (event.type === "response.output_text.delta")
        chunk({ type: "text", delta: event.delta });
      if (event.type === "speech.audio.done") return { completed: true };
      if (event.type === "response.completed") {
        if (
          event.response?.status !== "completed" ||
          !Array.isArray(event.response.output)
        )
          throw Error("模型响应不完整");
        return event.response;
      }
    }
    throw Error("连接提前结束，响应未完成");
  }
  if (kind === "tts") return new Uint8Array(await response.arrayBuffer());
  const data = await response.json();
  if (kind === "asr") {
    if (typeof data.text !== "string") throw Error("语音识别未返回文字");
    return data.text
      .replace(/^\s*language\s+[^<]+<asr_text>\s*/, "")
      .replace(/<\|(?:im_end|endoftext)\|>\s*$/, "")
      .trim();
  }
  if (data.status !== "completed" || !Array.isArray(data.output))
    throw Error("模型响应未完整结束，请重试");
  return data;
}
