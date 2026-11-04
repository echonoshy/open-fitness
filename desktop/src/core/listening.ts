export function cleanTranscript(text: string) {
  const t = text.trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  if (
    /^(\[.*\]|[（(](音乐|噪音|掌声|静音)[）)]|字幕.*|感谢观看[。！!]*|thanks for watching[.!]*)$/i.test(
      t,
    )
  )
    return "";
  const tokens = t.toLowerCase().split(/\s+/);
  if (tokens.length >= 6 && new Set(tokens).size <= 2) return "";
  if (/^(.{2,12})\1{3,}[。！!]*$/.test(t)) return "";
  return t; // Preserve short Chinese controls, including 停 / 不 / 好.
}
