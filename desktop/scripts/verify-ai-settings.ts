import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { AiServicesSettings } from "../electron/ai-services";
import { loadServiceConfig } from "../electron/service-config";
import { configureServices, service } from "../electron/services";
import { aiServicesDraft } from "../src/core/ai-services";
const source = process.env.COACH_SERVICES_CONFIG;
if (!source) throw Error("需要指定本机私有服务配置");
const dir = mkdtempSync(join(tmpdir(), "coach-ai-live-"));
const file = join(dir, "services.json");
const initial = loadServiceConfig(source);
writeFileSync(file, JSON.stringify(initial), { mode: 0o600 });
const results: object[] = [];
const out = resolve("output/ai-service-settings");
mkdirSync(out, { recursive: true });
try {
  const settings = new AiServicesSettings(file);
  const shared = aiServicesDraft(settings.view());
  const before = readFileSync(file, "utf8");
  const first = await settings.test(shared);
  results.push({ name: "shared-real-test", results: first.results });
  assert.ok(first.ticket);
  assert.equal(readFileSync(file, "utf8"), before);
  const bad = { ...shared, apiKey: "ark-invalid-settings-test-key" };
  const failed = await settings.test(bad);
  results.push({ name: "invalid-key-keeps-active", results: failed.results });
  assert.ok(failed.results.every((row) => !row.ok));
  assert.equal(failed.ticket, undefined);
  assert.throws(() => settings.save(first.ticket));
  assert.equal(readFileSync(file, "utf8"), before);
  const retry = await settings.test(shared);
  assert.ok(retry.ticket);
  settings.save(retry.ticket);
  assert.equal(loadServiceConfig(file).llm.apiKey, initial.llm.apiKey);
  assert.ok(!readFileSync(file, "utf8").includes(initial.llm.apiKey!));
  configureServices(file);
  const wav = (await service(
    "tts",
    "今天先练十二次深蹲。",
    AbortSignal.timeout(20000),
  )) as Uint8Array;
  const transcript = await service("asr", wav, AbortSignal.timeout(20000));
  const llm = (await service(
    "llm",
    {
      input: [{ role: "user", content: `只重复这句话：${transcript}` }],
      tools: [],
      tool_choice: "none",
      max_output_tokens: 64,
    },
    AbortSignal.timeout(20000),
  )) as any;
  assert.match(String(transcript), /深蹲/);
  assert.equal(llm.status, "completed");
  results.push({
    name: "saved-key-tts-asr-llm",
    ok: true,
    transcript,
    audioBytes: wav.length,
    llmStatus: llm.status,
  });
  writeFileSync(
    join(out, "live-verification.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        originalConfigChanged: false,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  configureServices();
  rmSync(dir, { recursive: true, force: true });
}
