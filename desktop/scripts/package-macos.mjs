import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, Platform, Arch } from "electron-builder";

const mode = process.argv[2];
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
const run = (command, args) =>
  execFileSync(command, args, { cwd: desktop, stdio: "inherit" });
run("npm", ["run", "icon"]);
run("npm", ["run", "build"]);
await build({
  projectDir: desktop,
  targets: Platform.MAC.createTarget("dir", Arch.arm64),
  publish: "never",
  config: {
    directories: { output },
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
run(process.execPath, [
  "scripts/sign-internal.mjs",
  join(output, "mac-arm64/open-fitness.app"),
]);
