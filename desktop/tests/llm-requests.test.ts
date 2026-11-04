import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServiceConfig } from "../electron/service-config";
import { configureServices, service } from "../electron/services";

const payload = {
  input: [
    {
      type: "function_call_output",
      call_id: "already-done",
      output: "目标已设为15",
    },
  ],
  tools: [
    { type: "function", name: "set_goal", parameters: { type: "object" } },
  ],
  tool_choice: "auto",
};
const completed = { status: "completed", output: [] };

async function fixture(run: (logs: unknown[][]) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "coach-llm-"));
  const file = join(dir, "services.json");
  const original = globalThis.fetch;
  const originalError = console.error;
  const originalWarn = console.warn;
  const logs: unknown[][] = [];
  try {
    const config = loadServiceConfig();
    config.llm = {
      baseUrl: "https://primary.example/v1",
      model: "primary",
      apiKey: "primary-secret",
    };
    writeFileSync(file, JSON.stringify(config));
    configureServices(file);
    console.error = console.warn = (...args) => {
      logs.push(args);
    };
    await run(logs);
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
    console.warn = originalWarn;
    configureServices();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("primary success, authentication failure, server failure and network failure do not switch", async () => {
  await fixture(async () => {
    for (const status of [200, 401, 403, 429, 500, 0]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        if (!status) throw new TypeError("network failure");
        return new Response(JSON.stringify(completed), { status });
      };
      const request = service("llm", payload, new AbortController().signal);
      if (status === 200) assert.deepEqual(await request, completed);
      else await assert.rejects(request);
      assert.equal(calls, 1);
    }
  });
});

test("stream failure after text does not replay an already started reply", async () => {
  await fixture(async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"开始"}\n\ndata: {"type":"error","code":429}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const deltas: unknown[] = [];
    await assert.rejects(
      service("llm", payload, new AbortController().signal, (c) =>
        deltas.push(c),
      ),
      /流式响应失败/,
    );
    assert.equal(calls, 1);
    assert.equal(deltas.length, 1);
  });
});
