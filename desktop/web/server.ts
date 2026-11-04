import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { coachApi } from "./api";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const types: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer((req, res) => {
  void coachApi(req, res, () => {
    void (async () => {
      try {
        const path = decodeURIComponent(
          new URL(req.url ?? "/", "http://localhost").pathname,
        );
        const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
        if (!file.startsWith(root + sep)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const bytes = await readFile(file);
        res.writeHead(200, {
          "Content-Type": types[extname(file)] ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(bytes);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    })();
  }).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
const port = Number(process.env.PORT ?? 5178);
server.listen(port, "127.0.0.1", () =>
  console.log(`open-fitness Web: http://127.0.0.1:${port}`),
);
