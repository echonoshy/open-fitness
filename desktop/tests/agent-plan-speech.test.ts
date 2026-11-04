import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { WebSocketServer } from "ws";
import {
  agentPlanAsr,
  agentPlanTts,
  parseAsrFrame,
} from "../electron/agent-plan-speech";
import { loadServiceConfig } from "../electron/service-config";
import { configureServices, service, voiceServiceStatus } from "../electron/services";
import { readPcmWav, writePcmWav } from "../src/core/pcm-wav";
import {
  agentPlanSpeaker,
  COACH_VOICES,
  DEFAULT_VOICE,
} from "../src/core/voices";

const connection = {
  baseUrl: "https://openspeech.example/api/v3/plan",
  apiKey: "private-speech-key",
};
const signal = () => new AbortController().signal;
const audio = { code: 0, data: Buffer.from([1, 0, 2, 0]).toString("base64") };
const done = { code: 20000000 };
const jsonResponse = (items: unknown[]) =>
  new Response(items.map((x) => JSON.stringify(x)).join("\n"));

function withConfig() {
  const dir = mkdtempSync(join(tmpdir(), "agent-plan-speech-")),
    file = join(dir, "services.json");
  const config = loadServiceConfig();
  config.llm.apiKey = "primary-key";
  for (const kind of ["asr", "tts"] as const)
    config[kind] = {
      baseUrl: connection.baseUrl,
      provider: "agent-plan",
      model: `doubao-seed-${kind}-2.0`,
    };
  return {
    config,
    save() {
      writeFileSync(file, JSON.stringify(config));
      configureServices(file);
    },
    file,
    cleanup() {
      configureServices();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("Agent Plan speech validates model versions without exposing credentials", () => {
  const f = withConfig();
  try {
    f.save();
    f.config.asr.model = "voxcpm2";
    assert.throws(() => f.save(), /asr.model/);
  } finally {
    f.cleanup();
  }
});

test("TTS uses the shared key and cloud speaker without leaking legacy voice parameters", async () => {
  const f = withConfig(),
    original = globalThis.fetch;
  const requests: any[] = [];
  try {
    f.save();
    assert.equal(voiceServiceStatus().usesVolcenginePresets, true);
    assert.deepEqual(COACH_VOICES.map((voice) => voice.preset.name), [
      "温柔小哥", "阳光青年", "高冷沉稳", "儒雅青年", "Vivi", "小何", "爽快思思", "温柔小雅",
    ]);
    globalThis.fetch = async (url, init) => {
      requests.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse([audio, done]);
    };
    for (const voice of COACH_VOICES) {
      const result = await service(
        "tts",
        { text: "保持节奏。", voice: voice.id },
        signal(),
      );
      const req = requests.at(-1);
      assert.equal(req.url, connection.baseUrl + "/tts/unidirectional");
      assert.equal(req.headers.get("X-Api-Key"), "primary-key");
      assert.equal(req.headers.get("X-Api-Resource-Id"), "seed-tts-2.0");
      assert.equal(req.headers.get("Authorization"), null);
      assert.equal(req.body.req_params.speaker, agentPlanSpeaker(voice.id));
      assert.equal(req.body.req_params.audio_params.speech_rate, 0);
      assert.equal("ref_text" in req.body, false);
      assert.equal(readPcmWav(result as Uint8Array).sampleRate, 24000);
    }
    assert.equal(
      new Set(COACH_VOICES.map((v) => agentPlanSpeaker(v.id))).size,
      8,
    );
  } finally {
    globalThis.fetch = original;
    f.cleanup();
  }
});

test("TTS incrementally decodes split JSON and odd PCM chunks, including an unterminated final line", async () => {
  const original = globalThis.fetch,
    chunks: Uint8Array[] = [];
  const encoded = new TextEncoder().encode(
    [
      { code: 0, data: Buffer.from([1, 0, 2]).toString("base64") },
      { code: 0, data: Buffer.from([0]).toString("base64") },
      done,
    ]
      .map((x) => JSON.stringify(x))
      .join("\r\n"),
  );
  try {
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < encoded.length; i += 7)
              c.enqueue(encoded.slice(i, i + 7));
            c.close();
          },
        }),
      );
    assert.deepEqual(
      await agentPlanTts(
        connection,
        "你好",
        agentPlanSpeaker(),
        signal(),
        (c) => {
          assert.equal(c.sampleRate, 24000);
          assert.equal(c.audio.length % 2, 0);
          chunks.push(c.audio);
        },
      ),
      { completed: true },
    );
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 0, 2, 0]));
    assert.equal(chunks.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("TTS rejects truncated, empty and malformed audio responses", async () => {
  const original = globalThis.fetch;
  try {
    for (const items of [
      [audio],
      [done],
      [{ code: 0, data: "%%%" }, done],
      [{ code: 0, data: "AQ==" }, done],
    ]) {
      globalThis.fetch = async () => jsonResponse(items);
      await assert.rejects(
        agentPlanTts(connection, "你好", agentPlanSpeaker(), signal()),
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("HTTP 200 with disabled deduction is an actionable error, never retried or treated as audio", async () => {
  const f = withConfig(),
    original = globalThis.fetch;
  let calls = 0,
    emitted = 0;
  try {
    f.save();
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse([
        {
          code: 45000030,
          message: "Forbidden.AgentPlanDeductNotEnabled echoed primary-key",
        },
      ]);
    };
    await assert.rejects(
      service("tts", "测试", signal(), () => emitted++),
      (e) => /套餐抵扣/.test(String(e)) && !String(e).includes("primary-key"),
    );
    assert.equal(calls, 1);
    assert.equal(emitted, 0);
  } finally {
    globalThis.fetch = original;
    f.cleanup();
  }
});

test("TTS abort during audio prevents completion and any later audio or retry", async () => {
  const f = withConfig(),
    original = globalThis.fetch,
    abort = new AbortController();
  let calls = 0,
    emitted = 0;
  try {
    f.save();
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse([audio, audio, done]);
    };
    await assert.rejects(
      service("tts", "测试", abort.signal, () => {
        emitted++;
        abort.abort();
      }),
      { name: "AbortError" },
    );
    assert.equal(emitted, 1);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    f.cleanup();
  }
});

test("a failed TTS stream is never replayed after audio has been emitted", async () => {
  const f = withConfig(),
    original = globalThis.fetch;
  let calls = 0;
  try {
    f.save();
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse([audio, { code: 50000000 }]);
    };
    await assert.rejects(service("tts", "测试", signal(), () => {}));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    f.cleanup();
  }
});

function responseFrame(data: unknown, last = false, code = 0) {
  const payload = gzipSync(Buffer.from(JSON.stringify(data))),
    frame = Buffer.alloc(12 + payload.length);
  frame.set([0x11, code ? 0xf0 : last ? 0x93 : 0x91, 0x11, 0]);
  frame.writeInt32BE(code || (last ? -2 : 1), 4);
  frame.writeUInt32BE(payload.length, 8);
  frame.set(payload, 12);
  return frame;
}
async function asrServer() {
  const http = createServer(),
    ws = new WebSocketServer({ server: http });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const port = (http.address() as { port: number }).port;
  return {
    ws,
    config: { ...connection, baseUrl: `http://127.0.0.1:${port}/api/v3/plan` },
    async close() {
      for (const c of ws.clients) c.terminate();
      ws.close();
      http.close();
      await once(http, "close");
    },
  };
}

test("ASR sends authenticated PCM16 audio and requires the final signed response before returning text", async () => {
  const s = await asrServer();
  let metadata: any,
    payload = Buffer.alloc(0),
    endSequence = 0;
  s.ws.on("connection", (ws, req) => {
    assert.equal(req.url, "/api/v3/plan/sauc/bigmodel_nostream");
    assert.equal(req.headers["x-api-key"], connection.apiKey);
    assert.equal(
      req.headers["x-api-resource-id"],
      "volc.seedasr.sauc.duration",
    );
    ws.on("message", (raw) => {
      const frame = raw as Buffer,
        body = gunzipSync(frame.subarray(12));
      if (frame[1] >> 4 === 1) {
        metadata = JSON.parse(body.toString());
        ws.send(responseFrame({ result: { text: "不要返回中间结果" } }));
      } else {
        payload = Buffer.concat([payload, body]);
        if (frame[1] & 2) {
          endSequence = frame.readInt32BE(4);
          ws.send(responseFrame({ result: { text: " 换成深蹲。 " } }, true));
        }
      }
    });
  });
  try {
    const result = await agentPlanAsr(
      s.config,
      writePcmWav(new Uint8Array(24000), 24000),
      signal(),
    );
    assert.equal(result, "换成深蹲。");
    assert.equal(metadata.audio.format, "pcm");
    assert.equal(metadata.audio.rate, 16000);
    assert.equal(payload.length, 16000);
    assert.ok(endSequence < 0);
  } finally {
    await s.close();
  }
});

test("ASR rejects provider errors after a successful WebSocket handshake", async () => {
  const s = await asrServer();
  s.ws.on("connection", (ws) =>
    ws.once("message", () =>
      ws.send(
        responseFrame(
          { message: "Forbidden.AgentPlanDeductNotEnabled private-speech-key" },
          false,
          45000030,
        ),
      ),
    ),
  );
  try {
    await assert.rejects(
      agentPlanAsr(
        s.config,
        writePcmWav(new Uint8Array(3200), 16000),
        signal(),
      ),
      (e) =>
        /套餐抵扣/.test(String(e)) && !String(e).includes(connection.apiKey),
    );
  } finally {
    await s.close();
  }
});

test("ASR cancellation closes the socket and cannot return stale results", async () => {
  const s = await asrServer(),
    abort = new AbortController();
  let peerClosed!: Promise<unknown>;
  s.ws.on("connection", (ws) => {
    peerClosed = once(ws, "close");
    ws.once("message", () => abort.abort());
  });
  try {
    await assert.rejects(
      agentPlanAsr(
        s.config,
        writePcmWav(new Uint8Array(3200), 16000),
        abort.signal,
      ),
      { name: "AbortError" },
    );
    await peerClosed;
  } finally {
    await s.close();
  }
});

test("ASR rejects early socket closure and malformed binary packets", async () => {
  const s = await asrServer();
  s.ws.on("connection", (ws) => ws.once("message", () => ws.close()));
  try {
    await assert.rejects(
      agentPlanAsr(
        s.config,
        writePcmWav(new Uint8Array(3200), 16000),
        signal(),
      ),
      /提前结束/,
    );
    for (const bytes of [
      Buffer.alloc(3),
      responseFrame({}).subarray(0, 10),
      Buffer.from([0x10, 0x91, 0x11, 0, 0, 0, 0, 0]),
    ])
      assert.throws(() => parseAsrFrame(bytes));
  } finally {
    await s.close();
  }
});

test("already cancelled ASR does not open a connection", async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    agentPlanAsr(
      connection,
      writePcmWav(new Uint8Array(3200), 16000),
      c.signal,
    ),
    { name: "AbortError" },
  );
});
