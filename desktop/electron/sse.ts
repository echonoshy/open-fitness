export async function* events(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  const parse = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    return !data || data === "[DONE]" ? null : JSON.parse(data);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const item = parse(block);
        if (item) yield item;
      }
      if (done) {
        if (buffer.trim()) {
          const item = parse(buffer);
          if (item) yield item;
        }
        break;
      }
      if (buffer.length > 8_000_000) throw Error("流式响应过大");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
