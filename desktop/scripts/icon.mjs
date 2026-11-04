import { Resvg } from "@resvg/resvg-js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const svg = await readFile("assets/branding/icon.svg", "utf8");
await mkdir("build/icon.iconset", { recursive: true });
for (const n of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: n * scale } })
      .render()
      .asPng();
    await writeFile(
      `build/icon.iconset/icon_${n}x${n}${scale === 2 ? "@2x" : ""}.png`,
      png,
    );
  }
execFileSync("iconutil", [
  "-c",
  "icns",
  "build/icon.iconset",
  "-o",
  "build/icon.icns",
]);
