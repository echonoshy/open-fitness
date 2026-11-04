import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadServiceConfig } from "../electron/service-config";

test("local settings API masks credentials, requires JSON and same-origin, and enforces test-before-save", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coach-ai-web-"));
  const file = join(dir, "services.json");
  const config = loadServiceConfig();
  config.llm.apiKey = "private-fixture-credential";
  writeFileSync(file, JSON.stringify(config));
  const oldEnv = process.env.COACH_SERVICES_CONFIG;
  process.env.COACH_SERVICES_CONFIG = file;
  const { coachApi } = await import("../web/api");
  const server = createServer(
    (req, res) => void coachApi(req, res, () => res.end()),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const url = base + "/api/coach/ai-services";
  try {
    const before = readFileSync(file, "utf8");
    const response = await fetch(url);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const view = await response.text();
    assert.ok(!view.includes(config.llm.apiKey));
    assert.equal(JSON.parse(view).configured, true);
    assert.equal(
      (await fetch(url, { headers: { origin: "https://evil.example" } }))
        .status,
      403,
    );
    assert.equal(
      (await fetch(url, { headers: { "sec-fetch-site": "cross-site" } }))
        .status,
      403,
    );
    assert.equal(
      (await fetch(url, { method: "POST", body: "{}" })).status,
      415,
    );
    const request = (body: unknown) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify(body),
      });
    assert.match(
      await (await request({ action: "save", payload: "forged" })).text(),
      /先测试/,
    );
    const invalid = await request({
      action: "test",
      payload: { apiKey: "secret-fixture-key\nwrong" },
    });
    const body = await invalid.text();
    assert.equal(invalid.status, 400);
    assert.ok(!body.includes("secret-fixture-key"));
    const oldOrigin = process.env.COACH_WEB_ORIGIN;
    process.env.COACH_WEB_ORIGIN = "http://public.example";
    try {
      assert.equal(
        await new Promise<number>((resolve) => {
          const req = httpRequest(
            url,
            { headers: { host: "public.example" } },
            (res) => {
              res.resume();
              resolve(res.statusCode!);
            },
          );
          req.end();
        }),
        403,
      );
    } finally {
      if (oldOrigin === undefined) delete process.env.COACH_WEB_ORIGIN;
      else process.env.COACH_WEB_ORIGIN = oldOrigin;
    }
    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldEnv === undefined) delete process.env.COACH_SERVICES_CONFIG;
    else process.env.COACH_SERVICES_CONFIG = oldEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
