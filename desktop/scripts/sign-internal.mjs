import { signAsync } from "@electron/osx-sign";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const app = resolve(process.argv[2] || "release/mac-arm64/open-fitness.app");
if (process.platform !== "darwin" || !app.endsWith(".app")) {
  throw new Error("请在 macOS 上指定 .app 路径");
}
await signAsync({
  app,
  platform: "darwin",
  identity: "-",
  identityValidation: false,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
});
execFileSync(
  "codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", app],
  { stdio: "inherit" },
);
console.log("内测临时签名完成；未经过 Apple 公证，首次打开可能需要手动放行。");
