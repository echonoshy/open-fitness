export function isAllowedRendererUrl(value: string, dev = false): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (
      (url.protocol === "coach:" && url.host === "app") ||
      (dev && url.origin === "http://127.0.0.1:5178")
    );
  } catch {
    return false;
  }
}

export function isAllowedAppPermission(
  permission: string,
  url: string,
  dev = false,
): boolean {
  return (
    isAllowedRendererUrl(url, dev) &&
    ["media", "speaker-selection", "fullscreen"].includes(permission)
  );
}

/** Keep workout exports usable while the library remains a viewing-only UI. */
export function isLibraryVideoDownload(
  url: string,
  mimeType: string,
  pageUrl: string,
  dev = false,
): boolean {
  if (!isAllowedRendererUrl(pageUrl, dev)) return false;
  if (mimeType.toLowerCase().startsWith("video/")) return true;
  try {
    return /^\/movekit-library\/(?:files|hd)\/[^/]+\.mp4$/i.test(
      new URL(url).pathname,
    );
  } catch {
    return false;
  }
}
