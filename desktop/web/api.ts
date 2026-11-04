import type { IncomingMessage, ServerResponse } from "node:http";
import { AiServicesSettings, aiSettingsError } from "../electron/ai-services";
import { profilePath } from "../electron/profile-path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  diagnoseServices,
  service,
  configureServices,
  voiceServiceStatus,
} from "../electron/services";

// Local Web previews use the same private configuration as the installed app.
// An explicit deployment override always takes priority; no key enters the client.
const appData = process.platform === "darwin"
  ? join(homedir(), "Library/Application Support")
  : process.env.APPDATA || process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const override = process.env.COACH_SERVICES_CONFIG;
const configPath = override || join(profilePath(appData), "services.json");
configureServices(configPath, !override && !existsSync(configPath));
const aiSettings = new AiServicesSettings(configPath);

export function trustedRequest(req: IncomingMessage) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const configured = process.env.COACH_WEB_ORIGIN;
  const host = req.headers.host;
  if (!host) return false;
  let origin: string;
  try {
    const url = new URL(`http://${host}`);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      (!configured || new URL(configured).host !== host)
    )
      return false;
    origin =
      configured && new URL(configured).host === host
        ? new URL(configured).origin
        : url.origin;
  } catch {
    return false;
  }
  return !req.headers.origin || req.headers.origin === origin;
}

export async function readRequest(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_000_000) throw Error("请求超过大小限制");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

let active = 0;
export async function coachApi(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const path = req.url?.split("?")[0];
  if (!path?.startsWith("/api/coach/")) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!trustedRequest(req)) {
    json(403, { error: "仅接受同源请求" });
    return;
  }
  if (path === "/api/coach/ai-services") {
    // Credential management is available only on a local loopback connection.
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    );
    const localHost = ["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(`http://${req.headers.host}`).hostname,
    );
    if (!local || !localHost) {
      json(403, { error: "请在本机打开 AI 服务设置" });
      return;
    }
    try {
      if (req.method === "GET") {
        json(200, aiSettings.view());
        return;
      }
      if (req.method !== "POST") {
        json(405, { error: "不支持的请求方式" });
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        json(415, { error: "需要 JSON 请求" });
        return;
      }
      const body = await readRequest(req);
      if (body.action === "test")
        json(200, await aiSettings.test(body.payload));
      else if (body.action === "save") json(200, aiSettings.save(body.payload));
      else json(400, { error: "未知操作" });
    } catch (error) {
      json(400, { error: aiSettingsError(error) });
    }
    return;
  }
  if (path === "/api/coach/health" && req.method === "GET") {
    try {
      json(200, voiceServiceStatus());
    } catch {
      json(503, { available: false });
    }
    return;
  }
  if (path === "/api/coach/diagnose" && req.method === "GET") {
    const services = await diagnoseServices();
    json(200, {
      services,
      scope: "服务连通性检查；不代表真实麦克风或扬声器已通过测试",
    });
    return;
  }
  if (path !== "/api/coach/service" || req.method !== "POST") {
    json(404, { error: "未知接口" });
    return;
  }
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    json(415, { error: "需要 JSON 请求" });
    return;
  }
  if (active >= 6) {
    json(429, { error: "服务忙，请稍后重试" });
    return;
  }
  active++;
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  const emit = (event: unknown) => {
    if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
  };
  try {
    const body = await readRequest(req);
    if (!["asr", "llm", "tts"].includes(body.kind)) throw Error("未知语音服务");
    const payload =
      body.kind === "asr"
        ? new Uint8Array(
            Buffer.from(
              typeof body.payload === "string" ? body.payload : "",
              "base64",
            ),
          )
        : body.payload;
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const result = await service(
      body.kind,
      payload,
      controller.signal,
      body.stream
        ? (chunk: any) => {
            emit({
              type: "chunk",
              chunk:
                chunk.type === "audio"
                  ? {
                      ...chunk,
                      audio: Buffer.from(chunk.audio).toString("base64"),
                    }
                  : chunk,
            });
          }
        : undefined,
    );
    emit(
      result instanceof Uint8Array
        ? {
            type: "result",
            binary: true,
            result: Buffer.from(result).toString("base64"),
          }
        : { type: "result", result },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "语音服务请求失败";
    if (!res.headersSent) json(400, { error: message });
    else if (!controller.signal.aborted) emit({ type: "error", message });
  } finally {
    active--;
    res.off("close", abort);
    if (!res.writableEnded) res.end();
  }
}
