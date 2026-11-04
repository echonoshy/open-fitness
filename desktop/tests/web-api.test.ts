import { localServices } from "./fixtures/local-services";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { coachApi } from "../web/api";
import { configureServices, applyServiceConfig } from "../electron/services";
import { readWebResponse } from "../src/core/web-protocol";
// Tests use their mocked legacy transport, never the developer's private account.
configureServices();
applyServiceConfig(localServices());

test("cancelling a Web request cancels its upstream voice request", async () => {
  const original = globalThis.fetch;
  let cancelled!: () => void;
  const upstreamCancelled = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  globalThis.fetch = ((input, init) => {
    if (!String(input).startsWith("http://127.0.0.1:9900/"))
      return original(input, init);
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        cancelled();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;
  const server = createServer(
    (req, res) => void coachApi(req, res, () => res.end()),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    const address = server.address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/coach/service`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          kind: "asr",
          payload: Buffer.alloc(100).toString("base64"),
        }),
      },
    );
    const result = readWebResponse(response, controller.signal);
    controller.abort();
    await assert.rejects(result);
    await Promise.race([
      upstreamCancelled,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("upstream was not cancelled")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    globalThis.fetch = original;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Web API accepts same-origin requests, blocks other origins, and forwards validated services", async () => {
  const original = globalThis.fetch;
  let forwarded = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith("http://127.0.0.1:9900/")) {
      forwarded++;
      return new Response(JSON.stringify({ text: "测试口令" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input, init);
  }) as typeof fetch;
  const server = createServer(
    (req, res) =>
      void coachApi(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await (await fetch(base + "/api/coach/health")).json(), {
      available: true,
      usesVolcenginePresets: false,
    });
    assert.equal(
      (
        await fetch(base + "/api/coach/health", {
          headers: { Origin: "https://other.example" },
        })
      ).status,
      403,
    );
    const request = (body: unknown) =>
      fetch(base + "/api/coach/service", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await request({ kind: "arbitrary-url", payload: {} })).status,
      400,
    );
    assert.equal(forwarded, 0);
    const result = await readWebResponse(
      await request({
        kind: "asr",
        payload: Buffer.alloc(100).toString("base64"),
      }),
    );
    assert.equal(result, "测试口令");
    assert.equal(forwarded, 1);
    await assert.rejects(
      readWebResponse(await request({ kind: "asr", payload: "" })),
      /too_small|Too small|Invalid|expected/i,
    );
    assert.equal(forwarded, 1);
  } finally {
    globalThis.fetch = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
