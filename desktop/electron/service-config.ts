import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  decodeServiceSecrets,
  encodeServiceSecrets,
  replaceServiceFile,
} from "./service-secrets";
import defaults from "../config/services.defaults.json";

const baseUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "baseUrl 必须为 HTTP/HTTPS 地址，且不能包含账号、查询参数或片段")
  .transform((value) => value.replace(/\/+$/, ""));
const serviceSchema = z
  .object({
    baseUrl,
    model: z.string().trim().min(1, "model 不能为空"),
  })
  .strict();
const llmSchema = serviceSchema.extend({
  provider: z.enum(["vllm", "volcengine"]).optional(),
  apiKey: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^\r\n]+$/, "apiKey 不能包含换行")
    .optional(),
});
const speechSchema = serviceSchema.extend({
  provider: z.enum(["openai-compatible", "agent-plan"]).optional(),
});
export const configSchema = z
  .object({
    llm: llmSchema,
    asr: speechSchema,
    tts: speechSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const kind of ["asr", "tts"] as const) {
      if (
        value[kind].provider === "agent-plan" &&
        value[kind].model !== `doubao-seed-${kind}-2.0`
      )
        ctx.addIssue({
          code: "custom",
          path: [kind, "model"],
          message: "请选择 Agent Plan 支持的豆包语音 2.0 模型",
        });
    }
  });
export type ServiceConfig = z.infer<typeof configSchema>;

// Retire obsolete credentials before decrypting: a discarded key cannot block an upgrade.
function upgrade(raw: any) {
  if (!raw || typeof raw !== "object") return false;
  let changed = false;
  if ("llmFallback" in raw) {
    delete raw.llmFallback;
    changed = true;
  }
  for (const kind of ["llm", "asr", "tts"] as const) {
    const service = raw[kind];
    if (!service || typeof service !== "object") continue;
    if (kind !== "llm" && ("apiKey" in service || "apiKeyFrom" in service)) {
      delete service.apiKey;
      delete service.apiKeyFrom;
      changed = true;
    }
    const url = URL.canParse(service.baseUrl)
      ? new URL(service.baseUrl)
      : undefined;
    if (
      url?.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
      raw[kind] = { ...defaults[kind] };
      changed = true;
    }
  }
  return changed;
}

// Defaults live in JSON and are bundled so the installed app is self-contained.
// The editable file lives outside the app and survives app replacement/upgrades.
export function loadServiceConfig(
  path?: string,
  createIfMissing = false,
  packagedKey?: string,
): ServiceConfig {
  if (!path) return configSchema.parse(defaults);
  const file = resolve(path);
  try {
    if (createIfMissing) {
      mkdirSync(dirname(file), { recursive: true });
      try {
        writeFileSync(file, JSON.stringify(defaults, null, 2) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    function read() {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      let changed = upgrade(raw);
      const config = configSchema.parse(decodeServiceSecrets(raw, file));
      if (
        packagedKey &&
        !config.llm.apiKey &&
        (["llm", "asr", "tts"] as const).every(
          (kind) =>
            config[kind].baseUrl === defaults[kind].baseUrl &&
            config[kind].provider === defaults[kind].provider,
        )
      ) {
        config.llm.apiKey = packagedKey;
        configSchema.parse(config);
        changed = true;
      }
      return { config, changed };
    }
    const loaded = read();
    if (createIfMissing && loaded.changed) {
      replaceServiceFile(file, () => encodeServiceSecrets(read().config, file));
      return read().config;
    }
    return loaded.config;
  } catch (error) {
    const reason =
      error instanceof z.ZodError
        ? error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("\n")
        : error instanceof SyntaxError
          ? "JSON 格式错误"
          : error instanceof Error
            ? error.message
            : String(error);
    throw new Error(
      `服务配置读取失败：${file}\n${reason}\n请修正配置文件后重启。`,
    );
  }
}
