/** Read RIFF chunks rather than assuming a 44-byte header (LIST/JUNK are valid). */
export function readPcmWav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw Error("语音文件不是有效的 WAV");
  let rate = 0,
    channels = 0,
    bits = 0,
    format = 0;
  let pcm: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (start + size > bytes.length) throw Error("语音文件不完整");
    if (tag(offset) === "fmt " && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      rate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    }
    if (tag(offset) === "data") pcm = bytes.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (
    format !== 1 ||
    channels !== 1 ||
    bits !== 16 ||
    rate < 8000 ||
    rate > 96000 ||
    !pcm?.length ||
    pcm.length % 2
  )
    throw Error("语音文件需要完整的单声道 PCM16 音频");
  return { pcm, sampleRate: rate };
}
export function writePcmWav(pcm: Uint8Array, sampleRate: number) {
  const bytes = new Uint8Array(44 + pcm.length),
    view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) =>
    bytes.set(
      [...value].map((c) => c.charCodeAt(0)),
      at,
    );
  tag(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}
export function joinPcmWavs(clips: Uint8Array[], pauseMs = 120) {
  const parts = clips.map(readPcmWav),
    rate = parts[0]?.sampleRate;
  if (!rate || parts.some((p) => p.sampleRate !== rate))
    throw Error("语音片段采样率不一致");
  const gap = Math.round((rate * pauseMs) / 1000) * 2;
  const pcm = new Uint8Array(
    parts.reduce((n, p) => n + p.pcm.length, 0) + gap * (parts.length - 1),
  );
  let offset = 0;
  for (const part of parts) {
    pcm.set(part.pcm, offset);
    offset += part.pcm.length + gap;
  }
  return writePcmWav(pcm, rate);
}
