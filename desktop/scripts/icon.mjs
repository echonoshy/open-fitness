import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const source = "assets/branding/app-icon.png";
await mkdir("build/icon.iconset", { recursive: true });
for (const n of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const size = String(n * scale);
    const png = `build/icon.iconset/icon_${n}x${n}${scale === 2 ? "@2x" : ""}.png`;
    execFileSync("sips", ["-z", size, size, source, "--out", png]);
  }
}
execFileSync("iconutil", [
  "-c",
  "icns",
  "build/icon.iconset",
  "-o",
  "build/icon.icns",
]);
