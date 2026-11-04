import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import WebSocket from "ws";
import { readPcmWav, writePcmWav } from "../src/core/pcm-wav";

export type SpeechConnection = { baseUrl: string; apiKey: string };
export type SpeechChunk = {
  type: "audio";
  audio: Uint8Array;
  sampleRate: number;
};
const SAMPLE_RATE = 24000;

/** Keep provider errors useful without returning upstream text or credentials. */
export class AgentPlanSpeechError extends Error {
  readonly retryable: boolean;
  constructor(kind: string, code: number, detail = "", logId = "") {
    const reason = detail.includes("AgentPlanDeductNotEnabled")
      ? "请在火山方舟控制台开启语音模型的 Agent Plan 套餐抵扣"
      : /AuthenticationError|Invalid.*Key/i.test(detail) ||
          [401, 403, 45000010].includes(code)
        ? "请检查 Agent Plan 专属 API Key 和语音服务权限"
        : /[Qq]uota|[Ll]imit|[Bb]alance/.test(detail) || code === 429
          ? "套餐额度不足或请求过于频繁，请检查语音额度"
          : "语音请求失败，请稍后重试";
    super(
      `${kind}：${reason}（${code}）${/^[a-zA-Z0-9_-]{1,128}$/.test(logId) ? `，请求编号 ${logId}` : ""}`,
    );
    this.name = "AgentPlanSpeechError";
    this.retryable = (code >= 500 && code < 600) || code >= 50000000;
  }
}

function headers(config: SpeechConnection, resource: string) {
  const id = randomUUID();
  return {
    "X-Api-Key": config.apiKey,
    "X-Api-Resource-Id": resource,
    "X-Api-Request-Id": id,
    "X-Api-Connect-Id": id,
  };
}

/** The Plan HTTP endpoint returns newline-delimited JSON, not raw WAV or SSE. */
async function* jsonLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        if (line) yield JSON.parse(line);
      }
      if (pending.length > 8_000_000) throw Error("语音响应过大");
      if (done) {
        if (pending.trim()) yield JSON.parse(pending);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function agentPlanTts(
  config: SpeechConnection,
  text: string,
  speaker: string,
  signal: AbortSignal,
  chunk?: (data: SpeechChunk) => void,
) {
  signal.throwIfAborted();
  const response = await fetch(`${config.baseUrl}/tts/unidirectional`, {
    method: "POST",
    headers: {
      ...headers(config, "seed-tts-2.0"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user: { uid: "open-fitness" },
      req_params: {
        text,
        speaker,
        audio_params: {
          format: "pcm",
          sample_rate: SAMPLE_RATE,
          speech_rate: 0,
        },
      },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    redirect: "error",
  });
  const logId = response.headers.get("x-tt-logid") ?? "";
  if (!response.ok)
    throw new AgentPlanSpeechError(
      "TTS",
      response.status,
      await response.text(),
      logId,
    );
  if (!response.body) throw Error("TTS 未返回音频流");
  const clips: Uint8Array[] = [];
  let bytes = 0,
    remainder = Buffer.alloc(0),
    complete = false;
  for await (const item of jsonLines(response.body)) {
    signal.throwIfAborted();
    if (item.code !== 0 && item.code !== 20000000)
      throw new AgentPlanSpeechError(
        "TTS",
        Number(item.code) || -1,
        String(item.message ?? ""),
        logId,
      );
    if (item.data) {
      if (
        typeof item.data !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)
      )
        throw Error("TTS 音频格式无效");
      const decoded = Buffer.concat([
        remainder,
        Buffer.from(item.data, "base64"),
      ]);
      const even = decoded.length - (decoded.length % 2);
      remainder = decoded.subarray(even);
      const audio = new Uint8Array(decoded.subarray(0, even));
      bytes += audio.length;
      if (bytes > 32_000_000) throw Error("TTS 音频过大");
      if (audio.length) {
        if (chunk) chunk({ type: "audio", audio, sampleRate: SAMPLE_RATE });
        else clips.push(audio);
      }
    }
    if (item.code === 20000000) {
      complete = true;
      break;
    }
  }
  signal.throwIfAborted();
  if (!complete || remainder.length || !bytes)
    throw Error("TTS 连接提前结束或音频不完整");
  return chunk
    ? { completed: true }
    : writePcmWav(Buffer.concat(clips), SAMPLE_RATE);
}

function asrFrame(
  type: number,
  sequence: number,
  data: Uint8Array,
  last = false,
) {
  const compressed = gzipSync(data);
  const frame = Buffer.alloc(12 + compressed.length);
  frame.set([0x11, (type << 4) | (last ? 3 : 1), type === 1 ? 0x11 : 0x01, 0]);
  frame.writeInt32BE(last ? -sequence : sequence, 4);
  frame.writeUInt32BE(compressed.length, 8);
  frame.set(compressed, 12);
  return frame;
}

export function parseAsrFrame(bytes: Buffer) {
  if (bytes.length < 8 || bytes[0] >> 4 !== 1) throw Error("ASR 响应格式无效");
  const type = bytes[1] >> 4,
    flags = bytes[1] & 15;
  let offset = (bytes[0] & 15) * 4;
  if (offset < 4) throw Error("ASR 响应头无效");
  const read = () => {
    if (offset + 4 > bytes.length) throw Error("ASR 响应不完整");
    const value = bytes.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  if (flags & 1) read();
  if (flags & 4) read();
  if (type !== 9 && type !== 15) throw Error("ASR 返回未知消息");
  const code = type === 15 ? read() : 0;
  const size = read();
  if (offset + size !== bytes.length) throw Error("ASR 响应长度无效");
  let payload = bytes.subarray(offset);
  if ((bytes[2] & 15) === 1)
    payload = gunzipSync(payload, { maxOutputLength: 4_000_000 });
  else if ((bytes[2] & 15) !== 0) throw Error("ASR 压缩格式无效");
  const data =
    payload.length && bytes[2] >> 4 === 1
      ? JSON.parse(payload.toString("utf8"))
      : null;
  return { code, last: Boolean(flags & 2), data };
}

/** The recorder already supplies mono PCM WAV; normalize other test inputs to 16 kHz. */
function asrPcm(wav: Uint8Array) {
  const { pcm, sampleRate } = readPcmWav(wav);
  if (sampleRate === 16000) return pcm;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.length);
  const frames = pcm.length / 2;
  const output = Buffer.alloc(
    Math.max(1, Math.round((frames * 16000) / sampleRate)) * 2,
  );
  for (let i = 0; i < output.length / 2; i++) {
    const at = Math.min(frames - 1, (i * sampleRate) / 16000),
      left = Math.floor(at);
    const a = view.getInt16(left * 2, true),
      b = view.getInt16(Math.min(left + 1, frames - 1) * 2, true);
    output.writeInt16LE(Math.round(a + (b - a) * (at - left)), i * 2);
  }
  return output;
}

export async function agentPlanAsr(
  config: SpeechConnection,
  wav: Uint8Array,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const pcm = asrPcm(wav);
  const url = new URL(`${config.baseUrl}/sauc/bigmodel_nostream`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: headers(config, "volc.seedasr.sauc.duration"),
      handshakeTimeout: 10000,
      maxPayload: 4_000_000,
    });
    let settled = false,
      sentAudio = false,
      logId = "";
    const finish = (error?: unknown, text = "") => {
      if (settled) return;
      settled = true;
      bounded.removeEventListener("abort", abort);
      // Do not wait for the peer's close handshake after completion or interruption.
      ws.terminate();
      if (error) reject(error);
      else resolve(text);
    };
    const abort = () => finish(bounded.reason);
    bounded.addEventListener("abort", abort, { once: true });
    if (bounded.aborted) {
      abort();
      return;
    }
    ws.on("upgrade", (response) => {
      logId = String(response.headers["x-tt-logid"] ?? "");
    });
    ws.on("unexpected-response", (_request, response) => {
      let detail = "";
      response.setEncoding("utf8");
      response.on("data", (part) => {
        if (detail.length < 8000) detail += part;
      });
      response.on("end", () =>
        finish(
          new AgentPlanSpeechError(
            "ASR",
            response.statusCode ?? -1,
            detail,
            String(response.headers["x-tt-logid"] ?? ""),
          ),
        ),
      );
      response.on("error", () => finish(Error("ASR 连接失败")));
    });
    ws.on("error", () => finish(Error("ASR 连接失败，请检查网络或服务配置")));
    ws.on("close", () => finish(Error("ASR 连接提前结束，识别未完成")));
    ws.on("open", () => {
      if (settled) return;
      ws.send(
        asrFrame(
          1,
          1,
          Buffer.from(
            JSON.stringify({
              user: { uid: "open-fitness" },
              audio: {
                format: "pcm",
                codec: "raw",
                rate: 16000,
                bits: 16,
                channel: 1,
              },
              request: {
                model_name: "bigmodel",
                enable_itn: true,
                enable_punc: true,
                enable_ddc: true,
                show_utterances: true,
              },
            }),
          ),
        ),
      );
    });
    ws.on("message", (raw, binary) => {
      if (settled) return;
      try {
        bounded.throwIfAborted();
        if (!binary) throw Error("ASR 未返回二进制协议消息");
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer);
        const result = parseAsrFrame(bytes);
        if (
          result.code ||
          (result.data?.code && ![0, 1000, 20000000].includes(result.data.code))
        )
          throw new AgentPlanSpeechError(
            "ASR",
            result.code || result.data.code,
            JSON.stringify(result.data),
            logId,
          );
        if (result.last) {
          const text = result.data?.result?.text;
          if (typeof text !== "string") throw Error("ASR 识别未返回文字");
          finish(undefined, text.trim());
        } else if (!sentAudio) {
          sentAudio = true;
          let sequence = 2;
          // Buffered utterances can be uploaded immediately; no simulated real-time delay.
          for (
            let offset = 0;
            offset < pcm.length && !settled;
            offset += 6400
          ) {
            bounded.throwIfAborted();
            const end = Math.min(offset + 6400, pcm.length);
            ws.send(
              asrFrame(
                2,
                sequence++,
                pcm.subarray(offset, end),
                end === pcm.length,
              ),
            );
          }
        }
      } catch (error) {
        finish(error);
      }
    });
  });
}
