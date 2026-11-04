import { metricSummary, type ServiceMetric } from "../src/core/diagnostics";
import { dataSchema } from "../src/core/data";
import {
  app,
  dialog,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  systemPreferences,
} from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { profilePath } from "./profile-path";
import { existsSync, mkdirSync } from "node:fs";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  appendFile,
  copyFile,
  stat,
} from "node:fs/promises";
import {
  service,
  diagnoseServices,
  configureServices,
  voiceServiceStatus,
} from "./services";
import { AiServicesSettings, aiSettingsError } from "./ai-services";
import { DatabaseSync } from "node:sqlite";
import {
  isAllowedRendererUrl,
  isAllowedAppPermission,
  isLibraryVideoDownload,
} from "./content-policy";
app.setName("open-fitness");
if (!app.commandLine.hasSwitch("user-data-dir")) {
  const userDataPath = profilePath(app.getPath("appData"));
  mkdirSync(userDataPath, { recursive: true });
  app.setPath("userData", userDataPath);
}
// VideoToolbox encoder discovery can crash the macOS GPU process while opening
// a camera (VTCompressionSessionCreate: nil ClientName). Pose inference still
// needs WebGL, so disable only hardware video encoding, not GPU acceleration.
if (process.platform === "darwin")
  app.commandLine.appendSwitch("disable-accelerated-video-encode");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "coach",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
const dev = process.argv.includes("--dev");
let win: BrowserWindow | null = null;
// A renderer keeps a snapshot in memory. Two instances sharing userData must
// never write independent snapshots over each other's plans or records.
const ownsDataDirectory = app.requestSingleInstanceLock();
if (!ownsDataDirectory) app.quit();
app.on("second-instance", () => {
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
});
const allowed = (url: string) => isAllowedRendererUrl(url, dev);
const serviceMetrics: ServiceMetric[] = [];
const controllers = new Map<string, AbortController>();
let writes = Promise.resolve();
let interfaceLanguage: "zh-CN" | "en" = "zh-CN";
let knownPlans: string | undefined;
function sender(event: Electron.IpcMainInvokeEvent) {
  if (!event.senderFrame || !allowed(event.senderFrame.url))
    throw Error("拒绝未知页面");
}
async function load() {
  try {
    const data = JSON.parse(
      await readFile(join(app.getPath("userData"), "data.json"), "utf8"),
    );
    interfaceLanguage = data.settings?.language === "en" ? "en" : "zh-CN";
    knownPlans = JSON.stringify(data.plans ?? []);
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      knownPlans = "[]";
      return { settings: {}, records: [] };
    }
    throw Error("本地记录读取失败，请保留数据文件后检查");
  }
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 760,
    backgroundColor: "#18191b",
    title: "open-fitness",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let mayClose = false;
  win.on("close", (event) => {
    if (!mayClose) {
      event.preventDefault();
      win?.webContents.send("close-request");
    }
  });
  ipcMain.removeHandler("close-ready");
  ipcMain.handle("close-ready", async (event) => {
    sender(event);
    await writes;
    mayClose = true;
    win?.close();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!allowed(url)) e.preventDefault();
  });
  win.webContents.on("console-message", (_e, ...args) =>
    console.log("[renderer]", ...args),
  );
  win.webContents.on("render-process-gone", (_e, details) =>
    console.error("renderer gone", details),
  );
  await win.loadURL(dev ? "http://127.0.0.1:5178" : "coach://app/index.html");
}
app.whenReady().then(async () => {
  if (!ownsDataDirectory) return;
  const configuredPath = process.env.COACH_SERVICES_CONFIG;
  const configPath =
    configuredPath || join(app.getPath("userData"), "services.json");
  try {
    const privateKeyFile = join(process.resourcesPath, "private-test.key");
    const packagedKey =
      app.isPackaged && !configuredPath && existsSync(privateKeyFile)
        ? (await readFile(privateKeyFile, "utf8")).trim()
        : undefined;
    configureServices(configPath, !configuredPath, packagedKey);
    console.log("[services] 配置文件：", configPath);
  } catch (error) {
    dialog.showErrorBox(
      "服务配置错误",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }
  ipcMain.handle("voice-service-status", (event) => {
    sender(event);
    return voiceServiceStatus();
  });
  const aiSettings = new AiServicesSettings(configPath);
  ipcMain.handle(
    "ai-services",
    async (event, action: unknown, payload: unknown) => {
      sender(event);
      try {
        if (action === "get") return aiSettings.view();
        if (action === "test") return await aiSettings.test(payload);
        if (action === "save") {
          const view = aiSettings.save(payload);
          for (const controller of controllers.values()) controller.abort();
          return view;
        }
        throw Error("设置格式不正确");
      } catch (error) {
        throw Error(aiSettingsError(error));
      }
    },
  );
  const root = resolve(__dirname, "../dist");
  protocol.handle("coach", (request) => {
    const u = new URL(request.url);
    const path = resolve(root, "." + decodeURIComponent(u.pathname));
    if (u.host !== "app" || !path.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path).href);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
    isAllowedAppPermission(permission, origin, dev),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback, details) =>
      callback(isAllowedAppPermission(permission, details.requestingUrl, dev)),
  );
  session.defaultSession.on("will-download", (event, item, contents) => {
    if (
      isLibraryVideoDownload(
        item.getURL(),
        item.getMimeType(),
        contents?.getURL() ?? "",
        dev,
      )
    )
      event.preventDefault();
  });
  ipcMain.handle("media-permission", async (event) => {
    sender(event);
    if (process.platform === "darwin") {
      const camera = await systemPreferences.askForMediaAccess("camera");
      const microphone =
        await systemPreferences.askForMediaAccess("microphone");
      return { camera, microphone };
    }
    return { camera: true, microphone: true };
  });
  ipcMain.handle(
    "service",
    async (event, id: string, kind: string, payload: unknown) => {
      sender(event);
      if (typeof id !== "string" || id.length > 80 || controllers.has(id))
        throw Error("请求编号无效");
      if (JSON.stringify(payload).length > 8_000_000) throw Error("请求过大");
      const controller = new AbortController();
      controllers.set(id, controller);
      const started = performance.now();
      let firstMs: number | undefined,
        outcome: ServiceMetric["outcome"] = "ok";
      try {
        return await service(kind, payload, controller.signal, (data) => {
          firstMs ??= Math.round(performance.now() - started);
          if (!event.sender.isDestroyed())
            event.sender.send("service-chunk", id, data);
        });
      } catch (e) {
        outcome = controller.signal.aborted ? "cancelled" : "error";
        throw e;
      } finally {
        controllers.delete(id);
        const metric = {
          kind,
          ms: Math.round(performance.now() - started),
          firstMs,
          outcome,
        };
        serviceMetrics.push(metric);
        if (serviceMetrics.length > 500) serviceMetrics.shift();
        void appendFile(
          join(app.getPath("userData"), "services.jsonl"),
          JSON.stringify({ at: new Date().toISOString(), id, ...metric }) +
            "\n",
        ).catch(console.error);
      }
    },
  );
  ipcMain.handle("cancel", (event, id: string) => {
    sender(event);
    controllers.get(id)?.abort();
  });
  ipcMain.handle("load", (event) => {
    sender(event);
    return load();
  });
  ipcMain.handle("save", async (event, data: unknown) => {
    sender(event);
    if (
      !data ||
      typeof data !== "object" ||
      JSON.stringify(data).length > 20_000_000
    )
      throw Error("数据格式无效");
    const checked = dataSchema.safeParse(data);
    if (!checked.success) throw Error("训练数据校验失败");
    const task = writes
      .catch(() => {})
      .then(async () => {
        const dir = app.getPath("userData");
        await mkdir(dir, { recursive: true });
        const file = join(dir, "data.json");
        let diskPlans = "[]";
        try {
          const old = JSON.parse(await readFile(file, "utf8"));
          diskPlans = JSON.stringify(old.plans ?? []);
          if ((old.version ?? 1) < ((data as any).version ?? 1))
            await copyFile(file, file + ".v" + (old.version ?? 1) + ".backup");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        // Earlier desktop releases do not participate in the instance lock.
        if (knownPlans !== diskPlans)
          throw Error(
            "计划列表已被另一个窗口更改。请退出其他版本后重新打开，以载入最新计划。",
          );
        const plans = checked.data.plans ?? [];
        const nextPlans = JSON.stringify(
          (data as typeof checked.data).plans ?? [],
        );
        if (nextPlans !== diskPlans) {
          const backup = join(dir, "plan-library.backup.json");
          await writeFile(
            backup + ".tmp",
            JSON.stringify({ settings: {}, records: [], plans }),
          );
          await rename(backup + ".tmp", backup);
        }
        await writeFile(file + ".tmp", JSON.stringify(data));
        await rename(file + ".tmp", file);
        interfaceLanguage = checked.data.settings.language ?? "zh-CN";
        knownPlans = nextPlans;
      });
    writes = task;
    await task;
  });
  ipcMain.handle("trace", async (event, data: unknown) => {
    sender(event);
    const line = JSON.stringify({ at: new Date().toISOString(), data });
    if (line.length > 100_000) throw Error("日志过大");
    await appendFile(
      join(app.getPath("userData"), "controls.jsonl"),
      line + "\n",
    );
  });
  ipcMain.handle("files", async (event, kind: string) => {
    sender(event);
    if (!["legacy", "csv", "backup"].includes(kind))
      throw Error("不支持的导入格式");
    const choice = await dialog.showOpenDialog(win!, {
      title: interfaceLanguage === "en"
        ? (kind === "legacy" ? "Choose a legacy project folder" : "Choose workout data")
        : (kind === "legacy" ? "选择旧版项目文件夹" : "选择训练数据"),
      properties: kind === "legacy" ? ["openDirectory"] : ["openFile"],
      filters:
        kind === "csv"
          ? [{ name: "CSV", extensions: ["csv"] }]
          : [{ name: "JSON", extensions: ["json"] }],
    });
    if (choice.canceled) return null;
    const file = choice.filePaths[0];
    if (kind !== "legacy") {
      if ((await stat(file)).size > 20_000_000) throw Error("文件超过20MB");
      return [{ name: kind, text: await readFile(file, "utf8") }];
    }
    const result: any[] = [];
    for (const name of ["workout_log.json", "references.json"])
      try {
        const path = join(file, name);
        if ((await stat(path)).size > 20_000_000) throw Error("文件超过20MB");
        result.push({ name, text: await readFile(path, "utf8") });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    try {
      await stat(join(file, "coach_profile.db"));
      const db = new DatabaseSync(join(file, "coach_profile.db"), {
        readOnly: true,
      });
      try {
        const facts = db
          .prepare("SELECT category,key,value,updated_at FROM facts")
          .all()
          .map((r: any) => ({
            category: r.category,
            key: r.key,
            value: r.value,
            updatedAt: String(r.updated_at),
          }));
        result.push({ name: "coach_profile.db", facts });
      } finally {
        db.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (!result.length) throw Error("此文件夹没有旧版训练记录或用户资料");
    return result;
  });
  ipcMain.handle(
    "export",
    async (event, name: string, text: string | Uint8Array) => {
      sender(event);
      if (
        typeof name !== "string" ||
        name.length > 150 ||
        !(typeof text === "string" || text instanceof Uint8Array) ||
        text.length > 500_000_000
      )
        throw Error("导出参数无效");
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: name.replace(/[\\/]/g, "_"),
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, text);
      return true;
    },
  );
  ipcMain.handle("diagnose", async (event) => {
    sender(event);
    const services = await diagnoseServices();
    let quality: Record<string, number> = {},
      controls = { ok: 0, rejected: 0 };
    try {
      const lines = (
        await readFile(join(app.getPath("userData"), "controls.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .slice(-500);
      for (const line of lines) {
        try {
          const { data } = JSON.parse(line);
          if (data?.event === "reply_quality")
            for (const flag of data.flags ?? [])
              quality[flag] = (quality[flag] ?? 0) + 1;
          if (data?.event === "control_applied")
            controls[data.ok ? "ok" : "rejected"]++;
        } catch {}
      }
    } catch {}
    return {
      quality,
      controls,
      logScope: "控制与回复质量统计取最近500条本地控制日志",
      version: app.getVersion(),
      metrics: metricSummary(serviceMetrics),
      metricsScope:
        "本次应用运行最近500个请求；耗时单位毫秒，TTS首包是服务到达时间，非扬声器实际出声时间",
      services,
      dataPath: app.getPath("userData"),
      camera:
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("camera")
          : "unknown",
      microphone:
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("microphone")
          : "unknown",
    };
  });
  await createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) void createWindow();
  });
});
app.on("window-all-closed", () => {
  for (const c of controllers.values()) c.abort();
  app.quit();
});
