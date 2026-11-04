export function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export function decodeBytes(encoded: string) {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}
export async function readWebResponse(
  response: Response,
  signal?: AbortSignal,
  onChunk?: (chunk: any) => void,
): Promise<any> {
  if (!response.ok)
    throw Error(`语音连接失败 (${response.status})，请检查服务诊断。`);
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("application/x-ndjson")
  )
    throw Error(
      "未连接 Web 语音后端，请使用 npm run web 或 npm run serve:web 启动。",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    complete = false,
    result: unknown;
  const consume = (line: string) => {
    if (!line.trim()) return;
    signal?.throwIfAborted();
    if (complete) throw Error("语音服务在结束后继续返回数据。");
    const event = JSON.parse(line);
    if (event.type === "error") throw Error(event.message || "语音服务失败");
    if (event.type === "result") {
      complete = true;
      result = event.binary ? decodeBytes(event.result) : event.result;
    } else if (event.type === "chunk")
      onChunk?.(
        event.chunk.type === "audio"
          ? { ...event.chunk, audio: decodeBytes(event.chunk.audio) }
          : event.chunk,
      );
    else throw Error("语音服务返回了未知事件");
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!complete) throw Error("语音连接提前结束，响应未完成。");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
