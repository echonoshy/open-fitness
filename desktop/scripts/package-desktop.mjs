import { execFileSync, execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadArtifact } from "@electron/get";
import electronPackage from "electron/package.json" with { type: "json" };
import checksums from "electron/checksums.json" with { type: "json" };
import { build, Platform, Arch } from "electron-builder";

const mode = process.argv[2];
const target = process.argv[3] ?? "mac-arm64";
if (!["mac-arm64", "mac-x64", "win-x64"].includes(target))
  throw Error("请选择 mac-arm64、mac-x64 或 win-x64");
const windows = target === "win-x64";
if (!windows && process.platform !== "darwin")
  throw Error("Mac 版需要在 macOS 上打包");
const arch = target === "mac-arm64" ? Arch.arm64 : Arch.x64;
if (mode !== "personal" && mode !== "public")
  throw Error("请选择自用打包或公开打包");
const personal = mode === "personal";
const desktop = fileURLToPath(new URL("../", import.meta.url));
const output = personal ? "release-private" : "release";
let key;
if (personal) {
  try {
    key = (
      await readFile(
        new URL("../../.secrets/agent-plan.key", import.meta.url),
        "utf8",
      )
    ).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw Error(
      "自用打包需要仓库根目录下的 .secrets/agent-plan.key。无 Key 分发请运行 npm run package:public。",
    );
  }
  if (!key || key.length > 512 || /\s/.test(key))
    throw Error("本机密钥文件应只包含一个有效的 Agent Plan Key");
}

console.log(
  personal ? "正在构建自用包（包含本机 Key）" : "正在构建分发包（不含 Key）",
);
const options = { cwd: desktop, stdio: "inherit" };
if (!windows) execSync("npm run icon", options);
execSync("npm run build", options);
// Verify cached and newly downloaded runtimes against the locked Electron release.
const electronDist = await downloadArtifact({
  version: electronPackage.version,
  artifactName: "electron",
  platform: windows ? "win32" : "darwin",
  arch: Arch[arch],
  checksums,
});
await build({
  projectDir: desktop,
  targets: windows
    ? Platform.WINDOWS.createTarget("nsis", arch)
    : Platform.MAC.createTarget("dir", arch),
  publish: "never",
  config: {
    directories: { output },
    electronDist,
    ...(personal && {
      afterPack: async ({ appOutDir, packager }) => {
        await writeFile(
          join(packager.getResourcesDir(appOutDir), "private-test.key"),
          key,
          {
            mode: 0o600,
            flag: "wx",
          },
        );
      },
    }),
  },
});
if (!windows) {
  const app = join(
    output,
    arch === Arch.arm64 ? "mac-arm64" : "mac",
    "open-fitness.app",
  );
  execFileSync(process.execPath, ["scripts/sign-internal.mjs", app], options);
  if (target === "mac-x64") {
    const { version } = JSON.parse(
      await readFile(join(desktop, "package.json"), "utf8"),
    );
    const zip = join(output, `open-fitness-${version}-mac-intel-x64.zip`);
    execFileSync(
      "ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip],
      options,
    );
    console.log(zip);
  }
}
