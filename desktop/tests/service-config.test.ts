import { AiServicesSettings } from "../electron/ai-services";
import { localServices } from "./fixtures/local-services";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { loadServiceConfig } from "../electron/service-config";
import {
  configureServices,
  diagnoseServices,
  endpoints,
  service,
} from "../electron/services";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coach-config-"));
  return {
    file: join(dir, "services.json"),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("first launch creates existing defaults and preserves user edits on subsequent launches", () => {
  const { file, clean } = fixture();
  try {
    const config = loadServiceConfig(file, true);
    assert.deepEqual(config, loadServiceConfig());
    assert.ok(
      Object.values(config).every((row) => row.baseUrl.startsWith("https://")),
    );
    assert.equal(config.llm.apiKey, undefined);
    config.llm = {
      baseUrl: "https://example.com/custom/v1/",
      model: "other-model",
    };
    const edited = JSON.stringify(config);
    writeFileSync(file, edited);
    assert.deepEqual(loadServiceConfig(file, true).llm, {
      baseUrl: "https://example.com/custom/v1",
      model: "other-model",
    });
    assert.equal(readFileSync(file, "utf8"), edited);
  } finally {
    clean();
  }
});

test("missing explicit files, malformed JSON and invalid fields fail visibly instead of falling back", () => {
  const { file, clean } = fixture();
  try {
    assert.throws(() => loadServiceConfig(file), /服务配置读取失败/);
    writeFileSync(file, "{");
    assert.throws(() => loadServiceConfig(file, true), /服务配置读取失败/);
    assert.equal(readFileSync(file, "utf8"), "{");
    for (const baseUrl of [
      "file:///tmp/test",
      "https://user:pass@example.com",
      "https://example.com?q=1",
      "https://example.com#part",
    ]) {
      const config = loadServiceConfig();
      config.llm.baseUrl = baseUrl;
      writeFileSync(file, JSON.stringify(config));
      assert.throws(() => loadServiceConfig(file), /llm.baseUrl/);
    }
    const config = loadServiceConfig();
    config.tts.model = "  ";
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => loadServiceConfig(file), /tts.model/);
    writeFileSync(file, JSON.stringify({ llm: config.llm }));
    assert.throws(() => loadServiceConfig(file), /asr/);
  } finally {
    clean();
  }
});

test("all service requests use configured endpoints and models, including multipart ASR", async () => {
  const { file, clean } = fixture();
  const requests: { path: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ path: req.url!, body: Buffer.concat(chunks).toString() });
    if (req.url!.endsWith("/audio/speech")) res.end(Buffer.from([1, 2, 3]));
    else {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url!.endsWith("/responses")
            ? { status: "completed", output: [] }
            : { text: "hello" },
        ),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const config = loadServiceConfig();
    for (const kind of ["llm", "asr", "tts"] as const)
      config[kind] = {
        baseUrl: `http://127.0.0.1:${port}/${kind}/v1/`,
        model: `custom-${kind}`,
      };
    writeFileSync(file, JSON.stringify(config));
    configureServices(file);
    const signal = new AbortController().signal;
    await service("llm", { input: [], tools: [], tool_choice: "auto" }, signal);
    assert.equal(await service("asr", new Uint8Array(100), signal), "hello");
    assert.deepEqual(
      await service("tts", "hello", signal),
      new Uint8Array([1, 2, 3]),
    );
    assert.deepEqual(
      requests.map((r) => r.path),
      [
        "/llm/v1/responses",
        "/asr/v1/audio/transcriptions",
        "/tts/v1/audio/speech",
      ],
    );
    assert.equal(JSON.parse(requests[0].body).model, "custom-llm");
    assert.match(requests[1].body, /name="model"\r\n\r\ncustom-asr/);
    assert.equal(JSON.parse(requests[2].body).model, "custom-tts");
    assert.equal(endpoints.asr, `http://127.0.0.1:${port}/asr/v1`);
    writeFileSync(file, "{}");
    assert.throws(() => configureServices(file), /服务配置读取失败/);
    assert.equal(endpoints.asr, `http://127.0.0.1:${port}/asr/v1`);
  } finally {
    configureServices();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clean();
  }
});

test("Keyless defaults load and malformed credentials never appear in config errors", () => {
  const { file, clean } = fixture();
  try {
    const config = loadServiceConfig();
    config.llm.provider = "volcengine";
    writeFileSync(file, JSON.stringify(config));
    assert.equal(loadServiceConfig(file).llm.apiKey, undefined);
    config.llm.apiKey = "test-key\r\ninjected-header";
    writeFileSync(file, JSON.stringify(config));
    assert.throws(() => loadServiceConfig(file), /apiKey 不能包含换行/);
    writeFileSync(file, '{"llm":{"apiKey":"test-private-key" invalid}}');
    assert.throws(
      () => loadServiceConfig(file),
      (error: Error) => {
        assert.match(error.message, /JSON 格式错误/);
        assert.ok(!error.message.includes("test-private-key"));
        return true;
      },
    );
  } finally {
    clean();
  }
});

test("Volcengine auth and thinking parameters apply to LLM requests and diagnostics only", async () => {
  const { file, clean } = fixture();
  const original = globalThis.fetch;
  const requests: { url: string; headers: Headers; body: any }[] = [];
  try {
    const config = loadServiceConfig();
    Object.assign(config, localServices());
    config.llm = {
      baseUrl: "https://ark.example/api/coding/v3",
      model: "deepseek-v4.1-flash",
      provider: "volcengine",
      apiKey: "test-private-key",
    };
    writeFileSync(file, JSON.stringify(config));
    configureServices(file);
    globalThis.fetch = async (url, init) => {
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body,
      });
      const response = {
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "set_rep_goal",
            call_id: "call_1",
            arguments: '{"goal":13}',
          },
        ],
      };
      if (body?.stream)
        return new Response(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "好的" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      return new Response(
        JSON.stringify(
          String(url).endsWith("/responses") ? response : { text: "hello" },
        ),
      );
    };
    const signal = new AbortController().signal;
    const payload = { input: [], tools: [], tool_choice: "auto" };
    await service("llm", payload, signal);
    const deltas: unknown[] = [];
    const result = await service("llm", payload, signal, (chunk) =>
      deltas.push(chunk),
    );
    assert.equal(result.output[0].call_id, "call_1");
    assert.deepEqual(deltas, [{ type: "text", delta: "好的" }]);
    await service("asr", new Uint8Array(100), signal);
    await service("tts", "hello", signal);
    assert.ok((await diagnoseServices()).every((r) => r.ok));
    for (const request of requests) {
      const isLlm = request.url.startsWith(config.llm.baseUrl);
      assert.equal(
        request.headers.get("Authorization"),
        isLlm ? "Bearer test-private-key" : null,
      );
      assert.ok(!JSON.stringify(request.body).includes("test-private-key"));
      if (request.url.endsWith("/responses")) {
        assert.equal(request.body.model, config.llm.model);
        assert.deepEqual(request.body.thinking, { type: "disabled" });
        assert.ok(!("chat_template_kwargs" in request.body));
        assert.equal(request.body.store, false);
      }
    }
    assert.equal(requests.filter((r) => r.url.endsWith("/models")).length, 2);
    assert.equal(
      requests.filter((r) => r.url.endsWith("/responses")).length,
      3,
    );
    configureServices();
    const count = requests.length;
    await assert.rejects(service("llm", payload, signal), /设置/);
    assert.equal(requests.length, count);
  } finally {
    globalThis.fetch = original;
    configureServices();
    clean();
  }
});

test("upstream error logging redacts an echoed API key", async () => {
  const { file, clean } = fixture();
  const original = globalThis.fetch;
  const originalError = console.error;
  const logged: unknown[][] = [];
  try {
    const config = loadServiceConfig();
    config.llm.apiKey = "test-private-key";
    writeFileSync(file, JSON.stringify(config));
    configureServices(file);
    globalThis.fetch = async () =>
      new Response("Invalid key: test-private-key", { status: 401 });
    console.error = (...args) => {
      logged.push(args);
    };
    await assert.rejects(
      service(
        "llm",
        { input: [], tools: [], tool_choice: "auto" },
        new AbortController().signal,
      ),
      /401/,
    );
    assert.ok(!JSON.stringify(logged).includes("test-private-key"));
    assert.match(JSON.stringify(logged), /401/);
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
    configureServices();
    clean();
  }
});

test("a private package imports its key encrypted once and respects a tested personal replacement", async () => {
  const { file, clean } = fixture();
  try {
    const config = loadServiceConfig(file, true, "test-build-credential");
    assert.equal(config.llm.apiKey, "test-build-credential");
    assert.ok(!readFileSync(file, "utf8").includes("test-build-credential"));
    const settings = new AiServicesSettings(file, async () =>
      (["llm", "asr", "tts"] as const).map((name) => ({
        name,
        ok: true,
        ms: 1,
      })),
    );
    const result = await settings.test({
      revision: settings.view().revision,
      apiKey: "personal-test-credential",
    });
    settings.save(result.ticket);
    assert.equal(
      loadServiceConfig(file, true, "test-build-credential").llm.apiKey,
      "personal-test-credential",
    );
    assert.ok(!readFileSync(file, "utf8").includes("personal-test-credential"));
    const custom = {
      ...config,
      llm: {
        ...config.llm,
        baseUrl: "https://custom.example/v1",
        apiKey: undefined,
      },
    };
    writeFileSync(file, JSON.stringify(custom));
    assert.equal(
      loadServiceConfig(file, true, "test-build-credential").llm.apiKey,
      undefined,
    );
  } finally {
    configureServices();
    clean();
  }
});

test("upgrade removes public HTTP services and obsolete credentials before decrypting; keeps the official main key", () => {
  const { file, clean } = fixture();
  try {
    const defaults = loadServiceConfig();
    const obsolete = {
      baseUrl: "http://retired.invalid/v1",
      model: "legacy",
      apiKey: { encrypted: "unreadable" },
    };
    writeFileSync(
      file,
      JSON.stringify({
        llm: { ...defaults.llm, apiKey: "retained-test-key" },
        llmFallback: obsolete,
        asr: { ...obsolete, apiKeyFrom: "llmFallback" },
        tts: { ...defaults.tts, apiKey: { encrypted: "unreadable" } },
      }),
    );
    const normalized = loadServiceConfig(file, true);
    assert.deepEqual(normalized, {
      ...defaults,
      llm: { ...defaults.llm, apiKey: "retained-test-key" },
    });
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /retired\.invalid|apiKeyFrom|llmFallback|retained-test-key/,
    );
    writeFileSync(
      file,
      JSON.stringify({ llm: obsolete, asr: obsolete, tts: obsolete }),
    );
    assert.deepEqual(loadServiceConfig(file, true), defaults);
  } finally {
    clean();
  }
});

test("unconfigured public builds report three missing credentials without contacting a provider", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("unexpected request");
  };
  try {
    configureServices();
    const rows = await diagnoseServices();
    assert.deepEqual(rows.map((r) => r.name).sort(), ["asr", "llm", "tts"]);
    assert.ok(rows.every((r) => !r.ok && r.error?.includes("设置")));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
