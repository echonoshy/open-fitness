import { localServices } from "./fixtures/local-services";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AiServicesSettings, aiSettingsError } from "../electron/ai-services";
import {
  loadServiceConfig,
  type ServiceConfig,
} from "../electron/service-config";
import { aiServicesDraft, type AiServiceTest } from "../src/core/ai-services";
import {
  configureServices,
  currentServiceConfig,
  service,
} from "../electron/services";
import { writePcmWav } from "../src/core/pcm-wav";
const ok: AiServiceTest[] = (["llm", "asr", "tts"] as const).map((name) => ({
  name,
  ok: true,
  ms: 20,
}));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coach-ai-settings-"));
  const file = join(dir, "services.json");
  const config: ServiceConfig = {
    llm: {
      provider: "volcengine",
      baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
      model: "deepseek-v4.1-flash",
      apiKey: "old-main-secret-key",
    },
    asr: {
      provider: "agent-plan",
      baseUrl: "https://openspeech.bytedance.com/api/v3/plan",
      model: "doubao-seed-asr-2.0",
    },
    tts: {
      provider: "agent-plan",
      baseUrl: "https://openspeech.bytedance.com/api/v3/plan",
      model: "doubao-seed-tts-2.0",
    },
  };
  writeFileSync(file, JSON.stringify(config));
  return {
    file,
    config,
    clean: () => {
      configureServices();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("shared-key candidate is tested in isolation, encrypted on save, reloadable", async () => {
  const f = fixture();
  let candidate!: ServiceConfig;
  let applied: ServiceConfig | undefined;
  try {
    configureServices(f.file);
    const manager = new AiServicesSettings(
      f.file,
      async (value) => {
        candidate = value;
        return ok;
      },
      (value) => {
        applied = value;
      },
    );
    const view = manager.view();
    assert.equal(view.suffix, "-key");
    assert.ok(!JSON.stringify(view).includes(f.config.llm.apiKey!));
    assert.throws(() => manager.save("forged"), /先测试/);
    const draft = aiServicesDraft(view);
    draft.apiKey = "new-main-secret-key";
    const before = readFileSync(f.file, "utf8");
    const result = await manager.test(draft);
    assert.equal(readFileSync(f.file, "utf8"), before);
    assert.equal(currentServiceConfig().llm.apiKey, f.config.llm.apiKey);
    assert.equal(applied, undefined);
    assert.equal(candidate.llm.apiKey, draft.apiKey);
    manager.save(result.ticket);
    assert.equal(applied!.llm.apiKey, draft.apiKey);
    assert.equal(loadServiceConfig(f.file).llm.apiKey, draft.apiKey);
    assert.equal(currentServiceConfig().llm.apiKey, draft.apiKey);
    const raw = readFileSync(f.file, "utf8");
    assert.ok(!raw.includes(draft.apiKey));
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
      "asr",
      "llm",
      "tts",
    ]);
    assert.match(raw, /aes-256-gcm-v1/);
    assert.equal(statSync(f.file).mode & 0o777, 0o600);
    assert.equal(statSync(f.file + ".key").mode & 0o777, 0o600);
    assert.throws(() => manager.save(result.ticket), /先测试/);
    assert.equal(new AiServicesSettings(f.file).view().configured, true);
  } finally {
    f.clean();
  }
});
test("failed tests invalidate old tickets and cannot mutate disk or active configuration", async () => {
  const f = fixture();
  let pass = true;
  try {
    configureServices(f.file);
    const manager = new AiServicesSettings(f.file, async () =>
      ok.map((row) => ({
        ...row,
        ok: pass || row.name !== "asr",
        error: "Key 无效",
      })),
    );
    const before = readFileSync(f.file, "utf8");
    const draft = aiServicesDraft(manager.view());
    const old = await manager.test(draft);
    pass = false;
    draft.apiKey = "wrong-secret-key";
    assert.equal((await manager.test(draft)).ticket, undefined);
    assert.throws(() => manager.save(old.ticket), /先测试/);
    assert.equal(readFileSync(f.file, "utf8"), before);
    assert.equal(currentServiceConfig().llm.apiKey, f.config.llm.apiKey);
  } finally {
    f.clean();
  }
});
test("expired, stale, malformed, and concurrent tests cannot authorize a save", async () => {
  const f = fixture();
  let now = 0;
  try {
    const manager = new AiServicesSettings(
      f.file,
      async () => ok,
      () => {},
      () => now,
    );
    const draft = aiServicesDraft(manager.view());
    const result = await manager.test(draft);
    now = 300000;
    assert.throws(() => manager.save(result.ticket), /先测试/);
    await assert.rejects(
      manager.test({ ...draft, apiKey: "secret\ninvalid" }),
      /设置格式/,
    );
    await assert.rejects(
      manager.test({ ...draft, asr: { mode: "separate", key: "" } }),
      /设置格式/,
    );
    const fresh = await manager.test(draft);
    writeFileSync(
      f.file,
      JSON.stringify({
        ...f.config,
        llm: { ...f.config.llm, apiKey: "external-new-key" },
      }),
    );
    assert.throws(() => manager.save(fresh.ticket), /其他窗口更新/);
    await assert.rejects(manager.test(draft), /其他窗口更新/);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new AiServicesSettings(f.file, async () => {
      await gate;
      return ok;
    });
    const current = aiServicesDraft(blocked.view());
    const task = blocked.test(current);
    await assert.rejects(blocked.test(current), /正在测试/);
    writeFileSync(f.file, JSON.stringify(f.config));
    release();
    await assert.rejects(task, /测试期间配置已更新/);
  } finally {
    f.clean();
  }
});
test("write failure keeps old configuration and encrypted credentials reject tampering", async () => {
  const f = fixture();
  let applied = false;
  try {
    const manager = new AiServicesSettings(
      f.file,
      async () => ok,
      () => {
        applied = true;
      },
    );
    const result = await manager.test(aiServicesDraft(manager.view()));
    const before = readFileSync(f.file, "utf8");
    mkdirSync(f.file + ".key");
    assert.throws(() => manager.save(result.ticket));
    assert.equal(readFileSync(f.file, "utf8"), before);
    assert.equal(applied, false);
    assert.ok(
      !readdirSync(join(f.file, "..")).some(
        (name) => name.endsWith(".tmp") || name.endsWith(".lock"),
      ),
    );
    rmSync(f.file + ".key", { recursive: true });
    manager.save(result.ticket);
    const stored = JSON.parse(readFileSync(f.file, "utf8"));
    stored.llm.apiKey.value = Buffer.alloc(32).toString("base64");
    writeFileSync(f.file, JSON.stringify(stored));
    assert.throws(() => loadServiceConfig(f.file), /无法读取/);
    assert.ok(
      !aiSettingsError(Error("secret-key-response")).includes(
        "secret-key-response",
      ),
    );
  } finally {
    f.clean();
  }
});
test("all segments of an active TTS request retain its original configuration", async () => {
  const f = fixture();
  const original = globalThis.fetch;
  const keys: string[] = [];
  try {
    const cfg = localServices();
    cfg.tts.baseUrl = "https://old.example/v1";
    writeFileSync(f.file, JSON.stringify(cfg));
    configureServices(f.file);
    globalThis.fetch = (async (input) => {
      keys.push(String(input));
      const next = structuredClone(cfg);
      next.tts.baseUrl = "https://new.example/v1";
      writeFileSync(f.file, JSON.stringify(next));
      return new Response(Buffer.from(writePcmWav(new Uint8Array(200), 24000)));
    }) as typeof fetch;
    await service(
      "tts",
      "先完成这一组深蹲，保持膝盖朝向脚尖。接着休息一分钟，再开始下一组训练。最后做拉伸。".repeat(
        3,
      ),
      new AbortController().signal,
    );
    assert.ok(keys.length > 1);
    assert.ok(keys.every((url) => url.startsWith("https://old.example/")));
    keys.length = 0;
    await service("tts", "你好。", new AbortController().signal);
    assert.ok(keys[0].startsWith("https://new.example/"));
  } finally {
    globalThis.fetch = original;
    f.clean();
  }
});
