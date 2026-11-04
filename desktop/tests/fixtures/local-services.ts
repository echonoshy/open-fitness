// Explicit in-memory transport for tests of OpenAI-compatible streaming.
export function localServices() {
  return {
    llm: { baseUrl: "http://127.0.0.1:9900/v1", model: "local-llm" },
    asr: { baseUrl: "http://127.0.0.1:9900/v1", model: "local-asr" },
    tts: { baseUrl: "http://127.0.0.1:9900/v1", model: "local-tts" },
  };
}
