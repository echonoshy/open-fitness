import { dataSchema, type SavedPlan, type TrashEntry } from "./core/data";
import type { Fact } from "./core/knowledge";
import type { Reference } from "./core/analysis";
import type { Exercise } from "./core/engine";
import type { RecordRow } from "./core/session";
import { coachVoice } from "./core/voices";
import {
  chooseBrowserFiles,
  downloadBrowserFile,
  type ImportKind,
} from "./web-files";
import { encodeBytes, readWebResponse } from "./core/web-protocol";
type VoiceServiceStatus = { available: boolean; usesVolcenginePresets: boolean };
export interface Settings {
  language?: "zh-CN" | "en";
  onboardingSeen?: boolean;
  backgroundBlur?: boolean;
  exerciseReference?: boolean;
  exerciseReferenceSize?: "medium" | "large";
  camera?: string;
  microphone?: string;
  speaker?: string;
  cameraLabel?: string;
  microphoneLabel?: string;
  speakerLabel?: string;
  voice: boolean;
  coachVoice?: string;
  guidance?: "quiet" | "balanced" | "active";
}
export interface Data {
  version?: number;
  homeShortcuts?: string[];
  freePractice?: { movementSlugs: string[] };
  profile?: Fact[];
  plans?: SavedPlan[];
  references?: Partial<Record<Exercise, Reference>>;
  checkpoint?: RecordRow | null;
  trash?: TrashEntry[];
  settings: Settings;
  records: RecordRow[];
  timedRecords?: import("./core/timed-training").TimedRecord[];
  timedCheckpoint?: import("./core/timed-training").TimedRecord | null;
}
declare global {
  interface Window {
    coach?: {
      voiceServiceStatus: () => Promise<VoiceServiceStatus>;
      aiServices: (
        action: "get" | "test" | "save",
        payload?: unknown,
      ) => Promise<unknown>;
      files: (
        kind: "legacy" | "csv" | "backup",
      ) => Promise<{ name: string; text?: string; facts?: Fact[] }[] | null>;
      export: (name: string, text: string | Uint8Array) => Promise<boolean>;
      diagnose: () => Promise<unknown>;
      onClose: (callback: () => Promise<void>) => () => void;
      onChunk: (callback: (id: string, data: any) => void) => () => void;
      service: (id: string, kind: string, payload: unknown) => Promise<any>;
      cancel: (id: string) => Promise<void>;
      load: () => Promise<Data>;
      save: (data: Data) => Promise<void>;
      permissions: () => Promise<{ camera: boolean; microphone: boolean }>;
      trace: (data: unknown) => Promise<void>;
    };
  }
}
export const desktop = !!window.coach;
export async function readData(): Promise<Data> {
  const raw = window.coach
    ? await window.coach.load()
    : JSON.parse(
        localStorage.getItem("open-fitness") ?? localStorage.getItem("viaim-coach") ?? '{"settings":{},"records":[]}',
      );
  const checked = dataSchema.safeParse(raw);
  if (!checked.success) throw Error("本地数据格式损坏");
  const d = checked.data;
  return {
    ...d,
    version: 6,
    profile: d.profile ?? [],
    plans: d.plans ?? [],
    references: d.references ?? {},
    settings: {
      voice: true,
      exerciseReference: true,
      exerciseReferenceSize: "medium",
      guidance: "balanced",
      ...d.settings,
      coachVoice: coachVoice(d.settings.coachVoice).id,
    },
  };
}
export async function saveData(data: Data) {
  dataSchema.parse(data);
  if (window.coach) await window.coach.save(data);
  else localStorage.setItem("open-fitness", JSON.stringify(data));
}
export async function request(
  kind: string,
  payload: unknown,
  signal?: AbortSignal,
  chunk?: (data: any) => void,
) {
  if (!window.coach) {
    const response = await fetch("./api/coach/service", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        payload: payload instanceof Uint8Array ? encodeBytes(payload) : payload,
        stream: !!chunk,
      }),
      signal,
    });
    return readWebResponse(response, signal, chunk);
  }
  if (signal?.aborted) throw Error("已取消");
  const id = crypto.randomUUID();
  const abort = () => void window.coach!.cancel(id);
  signal?.addEventListener("abort", abort, { once: true });
  const unsubscribe = chunk
    ? window.coach.onChunk((requestId, data) => {
        if (requestId === id && !signal?.aborted) chunk(data);
      })
    : undefined;
  try {
    const result = await window.coach.service(id, kind, payload);
    if (signal?.aborted) throw Error("已取消");
    return result;
  } finally {
    unsubscribe?.();
    signal?.removeEventListener("abort", abort);
  }
}
export const trace = (data: unknown) => {
  void window.coach?.trace(data).catch(console.error);
};

export async function readVoiceServiceStatus(): Promise<VoiceServiceStatus> {
  try {
    if (window.coach) return await window.coach.voiceServiceStatus();
    const response = await fetch("./api/coach/health", {
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const status = await response.json();
      return {
        available: status.available === true,
        usesVolcenginePresets: status.usesVolcenginePresets === true,
      };
    }
  } catch {}
  return { available: false, usesVolcenginePresets: false };
}
export const importFiles = (kind: ImportKind) =>
  window.coach ? window.coach.files(kind) : chooseBrowserFiles(kind);
export const exportFile = async (
  name: string,
  contents: string | Uint8Array,
) =>
  window.coach
    ? window.coach.export(name, contents)
    : downloadBrowserFile(name, contents);
export async function diagnoseServices() {
  if (window.coach) return window.coach.diagnose();
  const permission = async (name: "camera" | "microphone") => {
    try {
      return (
        await navigator.permissions.query({ name: name as PermissionName })
      ).state;
    } catch {
      return "浏览器不支持查询；请通过设备按钮授权";
    }
  };
  const [camera, microphone] = await Promise.all([
    permission("camera"),
    permission("microphone"),
  ]);
  let backend: unknown;
  try {
    const response = await fetch("./api/coach/diagnose", {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error(String(response.status));
    backend = await response.json();
  } catch {
    backend = {
      error:
        "Web 语音后端未连接，请使用 npm run web 或 npm run serve:web 启动后重试。",
    };
  }
  return {
    runtime: "Web",
    camera,
    microphone,
    secureContext: window.isSecureContext,
    storage: "当前浏览器本机存储；可用 JSON 备份与桌面端互相迁移",
    backend,
  };
}
