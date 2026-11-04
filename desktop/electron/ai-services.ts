import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadServiceConfig, type ServiceConfig } from "./service-config";
import { encodeServiceSecrets, replaceServiceFile } from "./service-secrets";
import { applyServiceConfig, diagnoseServices } from "./services";
import type {
  AiServicesView,
  AiServicesTestResult,
  AiServiceTest,
} from "../src/core/ai-services";

const key = z
  .string()
  .trim()
  .max(512)
  .regex(/^[^\r\n]*$/);
const draftSchema = z
  .object({ revision: z.string().length(64), apiKey: key })
  .strict();
const kinds = ["llm", "asr", "tts"] as const;
const revision = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const mask = (value?: string) =>
  value && value.length > 8 ? value.slice(-4) : "";

export class AiServicesSettings {
  private proof?: {
    ticket: string;
    revision: string;
    config: ServiceConfig;
    expires: number;
  };
  private testing = false;
  constructor(
    private file: string,
    private check: (config: ServiceConfig) => Promise<AiServiceTest[]> = async (
      config,
    ) =>
      (await diagnoseServices(config)).map((row) => ({
        ...row,
        name: row.name as AiServiceTest["name"],
      })),
    private apply: (config: ServiceConfig) => void = applyServiceConfig,
    private now: () => number = Date.now,
  ) {}
  view(): AiServicesView {
    const config = loadServiceConfig(this.file);
    const defaults = loadServiceConfig();
    const savedKey =
      config.llm.baseUrl === defaults.llm.baseUrl
        ? config.llm.apiKey
        : undefined;
    return {
      revision: revision(this.file),
      configured: !!savedKey,
      suffix: mask(savedKey),
      model:
        config.llm.baseUrl === defaults.llm.baseUrl
          ? config.llm.model
          : defaults.llm.model,
    };
  }
  async test(input: unknown): Promise<AiServicesTestResult> {
    if (this.testing) throw Error("正在测试，请等待本次测试结束");
    this.proof = undefined;
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success)
      throw Error("设置格式不正确，请检查 Key 是否包含换行或过长");
    const draft = parsed.data;
    if (revision(this.file) !== draft.revision)
      throw Error("配置已在其他窗口更新，请重新载入后测试");
    const existing = loadServiceConfig(this.file);
    const config = loadServiceConfig();
    if (existing.llm.baseUrl === config.llm.baseUrl) {
      config.llm.model = existing.llm.model;
      config.llm.apiKey = existing.llm.apiKey;
    }
    config.llm.apiKey = draft.apiKey || config.llm.apiKey;
    if (!config.llm.apiKey) throw Error("请填写共用的 Agent Plan API Key");
    this.testing = true;
    try {
      const results = await this.check(structuredClone(config));
      if (revision(this.file) !== draft.revision)
        throw Error("测试期间配置已更新，请重新载入后测试");
      if (
        !kinds.every((kind) =>
          results.some((row) => row.name === kind && row.ok),
        )
      )
        return { results };
      const ticket = randomUUID();
      this.proof = {
        ticket,
        revision: draft.revision,
        config,
        expires: this.now() + 5 * 60_000,
      };
      return { results, ticket };
    } finally {
      this.testing = false;
    }
  }
  save(ticket: unknown): AiServicesView {
    const proof = this.proof;
    if (
      !proof ||
      typeof ticket !== "string" ||
      ticket !== proof.ticket ||
      this.now() >= proof.expires
    )
      throw Error("请先测试当前配置，测试通过后 5 分钟内保存");
    replaceServiceFile(this.file, () => {
      if (revision(this.file) !== proof.revision) {
        this.proof = undefined;
        throw Error("配置已在其他窗口更新，请重新载入后测试");
      }
      return encodeServiceSecrets(proof.config, this.file);
    });
    this.apply(proof.config);
    this.proof = undefined;
    return this.view();
  }
}

// UI callers get actionable, bounded messages, never provider bodies or keys.
export function aiSettingsError(error: unknown): string {
  if (
    error instanceof Error &&
    /^(请先测试|配置已在|测试期间|正在测试|设置格式|请填写|配置正在)/.test(
      error.message,
    )
  )
    return error.message;
  return "AI 服务设置读取或保存失败，请检查本机配置文件权限后重试";
}
