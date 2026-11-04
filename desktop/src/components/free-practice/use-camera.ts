import { useCallback, useEffect, useRef, useState } from "react";
import { desktop } from "../../platform";

export function deviceError(error: unknown, kind: "摄像头" | "麦克风") {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return desktop
      ? `未获得${kind}权限，请在系统设置的「隐私与安全性」中允许本应用后重试。`
      : `未获得${kind}权限，请在浏览器地址栏允许后重试。`;
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return `没有找到可用的${kind}，请连接设备后重试。`;
  if (name === "NotReadableError" || name === "AbortError")
    return `${kind}暂时无法使用，请检查是否被其他应用占用。`;
  return `${kind}未能开启，请检查设备后重试。`;
}

export function useCamera(
  active: boolean,
  preferredDevice = "",
  onDeviceChange?: (id: string, label: string) => void,
) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"off" | "loading" | "on" | "error">(
    "off",
  );
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState(preferredDevice);
  const onDevice = useRef(onDeviceChange);
  onDevice.current = onDeviceChange;
  useEffect(() => {
    setDevice(preferredDevice);
  }, [preferredDevice]);
  const [mirror, setMirror] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const release = useCallback(() => {
    generation.current++;
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
  }, []);
  const stop = useCallback(() => {
    release();
    setStream(null);
    setStatus("off");
    setError("");
  }, [release]);
  const start = async (id = device) => {
    stop();
    const token = generation.current;
    setStatus("loading");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error("unsupported");
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: id ? { exact: id } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      if (generation.current !== token) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = next.getVideoTracks()[0];
      streamRef.current = next;
      setStream(next);
      setDevice(track.getSettings().deviceId ?? id);
      onDevice.current?.(track.getSettings().deviceId ?? id, track.label);
      setStatus("on");
      track.onended = () => {
        stop();
        setStatus("error");
        setError("摄像头已断开，请重新连接后开启。");
      };
      void navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          if (generation.current === token)
            setDevices(all.filter((d) => d.kind === "videoinput"));
        })
        .catch(() => {});
    } catch (reason) {
      if (generation.current !== token) return;
      if (
        reason instanceof Error &&
        ["NotFoundError", "OverconstrainedError"].includes(reason.name)
      )
        setDevice("");
      setStatus("error");
      setError(deviceError(reason, "摄像头"));
    }
  };
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => {
    // A development refresh can preserve React state after releasing the stream.
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
    stream,
    status,
    error,
    devices,
    device,
    mirror,
    setMirror,
    start,
    stop,
  };
}
