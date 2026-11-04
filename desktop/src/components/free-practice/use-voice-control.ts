import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "../../media/audio";
import { desktop, request as serviceRequest } from "../../platform";
import { deviceError } from "./use-camera";

export function useVoiceControl(
  active: boolean,
  onCommand: (text: string) => string,
  preferredDevice = "",
  onDeviceChange?: (id: string, label: string) => void,
) {
  const [status, setStatus] = useState<
    "off" | "loading" | "listening" | "hearing" | "recognizing" | "error"
  >("off");
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState(preferredDevice);
  const onDevice = useRef(onDeviceChange);
  onDevice.current = onDeviceChange;
  useEffect(() => {
    setDevice(preferredDevice);
  }, [preferredDevice]);
  const callback = useRef(onCommand);
  callback.current = onCommand;
  const lifetime = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    if (lifetime.current && !lifetime.current.signal.aborted)
      setStatus("listening");
  }, []);
  const release = useCallback(() => {
    generation.current++;
    lifetime.current?.abort();
    lifetime.current = null;
    request.current?.abort();
    request.current = null;
  }, []);
  const stop = useCallback(() => {
    release();
    setStatus("off");
    setLevel(0);
    setMessage("");
    setTranscript("");
  }, [release]);
  const start = async (id = device) => {
    stop();
    setStatus("loading");
    setMessage(
      desktop
        ? "正在准备语音，首次使用请允许应用访问麦克风。"
        : "首次开启，请允许浏览器使用麦克风；未看到提示可检查地址栏权限。",
    );
    const controller = new AbortController();
    lifetime.current = controller;
    const alive = () =>
      lifetime.current === controller && !controller.signal.aborted;
    try {
      await listen({
        device: id || undefined,
        signal: controller.signal,
        playing: () => false,
        onReady: (settings) => {
          if (!alive()) return;
          setStatus("listening");
          setDevice(settings.deviceId ?? id);
          setMessage("可以说「暂停」「继续」或「换成深蹲」");
          void navigator.mediaDevices
            .enumerateDevices()
            .then((all) => {
              if (alive()) {
                setDevices(all.filter((d) => d.kind === "audioinput"));
                const selected = all.find(
                  (d) => d.deviceId === (settings.deviceId ?? id),
                );
                if (selected)
                  onDevice.current?.(selected.deviceId, selected.label);
              }
            })
            .catch(() => {});
        },
        onLevel: (value) => {
          if (alive()) setLevel(value);
        },
        onStart: () => {
          invalidate();
          if (alive()) setStatus("hearing");
          return generation.current;
        },
        onSpeech: async (audio, token) => {
          if (!alive() || token !== generation.current) return;
          setStatus("recognizing");
          const turn = new AbortController();
          request.current = turn;
          const signal = AbortSignal.any([
            controller.signal,
            turn.signal,
            AbortSignal.timeout(20000),
          ]);
          try {
            const result = await serviceRequest("asr", audio, signal);
            if (!alive() || token !== generation.current) return;
            const text = typeof result === "string" ? result.trim() : "";
            setTranscript(text.slice(0, 100));
            setMessage(
              text ? callback.current(text) : "这次没听清，可以再说一次。",
            );
            setStatus("listening");
          } catch (error) {
            if (!alive() || turn.signal.aborted || token !== generation.current)
              return;
            setStatus("listening");
            setTranscript("");
            setMessage(
              signal.aborted
                ? "识别等待较久，请再说一次。"
                : "语音识别暂时不可用，可重试或使用下方按钮。",
            );
          } finally {
            if (request.current === turn) request.current = null;
          }
        },
        onError: (error) => {
          if (!alive()) return;
          stop();
          setStatus("error");
          setMessage(deviceError(error, "麦克风"));
        },
      });
    } catch (error) {
      if (!alive()) return;
      stop();
      if (
        error instanceof Error &&
        ["NotFoundError", "OverconstrainedError"].includes(error.name)
      )
        setDevice("");
      setStatus("error");
      setMessage(deviceError(error, "麦克风"));
    }
  };
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => {
    stop();
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      release();
    };
  }, [release, stop]);
  return {
    status,
    message,
    transcript,
    level,
    device,
    devices,
    start,
    stop,
    invalidate,
  };
}
