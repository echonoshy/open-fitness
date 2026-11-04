import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("coach", {
  voiceServiceStatus: () => ipcRenderer.invoke("voice-service-status"),
  aiServices: (action: string, payload?: unknown) =>
    ipcRenderer.invoke("ai-services", action, payload),
  files: (kind: string) => ipcRenderer.invoke("files", kind),
  export: (name: string, text: string | Uint8Array) =>
    ipcRenderer.invoke("export", name, text),
  diagnose: () => ipcRenderer.invoke("diagnose"),
  onChunk: (callback: (id: string, data: unknown) => void) => {
    const listener = (_e: unknown, id: string, data: unknown) =>
      callback(id, data);
    ipcRenderer.on("service-chunk", listener);
    return () => ipcRenderer.removeListener("service-chunk", listener);
  },
  onClose: (callback: () => Promise<void>) => {
    let closing = false;
    const listener = () => {
      if (closing) return;
      closing = true;
      callback()
        .then(() => ipcRenderer.invoke("close-ready"))
        .catch(() => {})
        .finally(() => {
          closing = false;
        });
    };
    ipcRenderer.on("close-request", listener);
    return () => ipcRenderer.removeListener("close-request", listener);
  },
  service: (id: string, kind: string, payload: unknown) =>
    ipcRenderer.invoke("service", id, kind, payload),
  cancel: (id: string) => ipcRenderer.invoke("cancel", id),
  load: () => ipcRenderer.invoke("load"),
  save: (data: unknown) => ipcRenderer.invoke("save", data),
  permissions: () => ipcRenderer.invoke("media-permission"),
  trace: (data: unknown) => ipcRenderer.invoke("trace", data),
});
