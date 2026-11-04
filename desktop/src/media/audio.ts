import { SpeechTurnDetector } from "../core/speech-turn";
import { Resampler } from "@ricky0123/vad-web/dist/resampler";
export function wav(chunks: Float32Array[], rate: number) {
  const n = chunks.reduce((s, c) => s + c.length, 0),
    joined = new Float32Array(n);
  let i = 0;
  for (const c of chunks) {
    joined.set(c, i);
    i += c.length;
  }
  const len = Math.floor((n * 16000) / rate),
    buf = new ArrayBuffer(44 + len * 2),
    v = new DataView(buf);
  const str = (p: number, s: string) => {
    for (let j = 0; j < s.length; j++) v.setUint8(p + j, s.charCodeAt(j));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + len * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, len * 2, true);
  for (let j = 0; j < len; j++) {
    const start = Math.floor((j * rate) / 16000),
      end = Math.min(n, Math.floor(((j + 1) * rate) / 16000));
    let sum = 0;
    for (let k = start; k < end; k++) sum += joined[k];
    v.setInt16(
      44 + j * 2,
      Math.max(-1, Math.min(1, sum / Math.max(1, end - start))) * 32767,
      true,
    );
  }
  return new Uint8Array(buf);
}
export interface ListenOptions {
  device?: string;
  playing: () => boolean;
  onStart: (overlap: boolean) => number;
  onCandidate?: (active: boolean) => void;
  onDiagnostic?: (
    data: ReturnType<SpeechTurnDetector["diagnostics"]> & {
      event: string;
      playing: boolean;
      queuedFrames: number;
      inferenceMs: number;
    },
  ) => void;
  onSpeech: (data: Uint8Array, token: number, overlap: boolean) => void;
  onLevel: (level: number) => void;
  onReady?: (settings: MediaTrackSettings) => void;
  onError: (error: unknown) => void;
  signal: AbortSignal;
}
export async function listen(options: ListenOptions) {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, options.signal]);
  let stream: MediaStream | undefined,
    ctx: AudioContext | undefined,
    node: AudioWorkletNode | undefined,
    source: MediaStreamAudioSourceNode | undefined;
  let model:
    | Awaited<ReturnType<typeof import("./speech-model").speechModel>>
    | undefined;
  const detector = new SpeechTurnDetector();
  let pending: Float32Array[] = [];
  let processing = false,
    token = 0,
    lastLevel = 0,
    lastDiagnostic = 0;
  let released = false;
  const release = () => {
    if (!processing && model && !released) {
      released = true;
      void model.release().catch(() => {});
    }
  };
  const cleanup = () => {
    options.onCandidate?.(false);
    detector.reset();
    pending = [];
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
    }
    source?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    release();
  };
  const stop = () => {
    lifetime.abort();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  const failed = (error: unknown) => {
    if (signal.aborted) return;
    stop();
    options.onError(error);
  };
  try {
    signal.throwIfAborted();
    const { speechModel } = await import("./speech-model");
    signal.throwIfAborted();
    model = await speechModel(signal);
    signal.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.device ? { exact: options.device } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    signal.throwIfAborted();
    const track = stream.getAudioTracks()[0];
    const modes = track.getCapabilities().echoCancellation as unknown as
      (boolean | string)[] | undefined;
    if (modes?.includes("all")) {
      try {
        await track.applyConstraints({
          echoCancellation: { exact: "all" },
        } as unknown as MediaTrackConstraints);
      } catch {
        // Some Chromium/device combinations advertise "all" but reject it.
        // Keep ordinary browser echo cancellation instead of disabling the mic.
        await track.applyConstraints({ echoCancellation: true });
      }
    }
    signal.throwIfAborted();
    track.onended = () => failed(Error("麦克风已断开，请重新连接设备。"));
    options.onReady?.(track.getSettings());
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(
      new URL("pcm-worklet.js", document.baseURI).href,
    );
    signal.throwIfAborted();
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, "pcm");
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    const resampler = new Resampler({
      nativeSampleRate: ctx.sampleRate,
      targetSampleRate: 16000,
      targetFrameSize: 512,
    });
    const drain = async () => {
      if (processing) return;
      processing = true;
      try {
        while (pending.length && !signal.aborted) {
          const frame = pending.shift()!;
          const inferenceStarted = performance.now();
          const probability = await model!.process(frame);
          if (signal.aborted) break;
          const playing = options.playing();
          const event = detector.feed(frame, probability.isSpeech, playing);
          if (
            event ||
            (playing && performance.now() - lastDiagnostic >= 2000)
          ) {
            options.onDiagnostic?.({
              ...detector.diagnostics(),
              event: event?.type ?? "sample",
              playing,
              queuedFrames: pending.length,
              inferenceMs: Math.round(performance.now() - inferenceStarted),
            });
            lastDiagnostic = performance.now();
          }
          if (event?.type === "candidate") options.onCandidate?.(true);
          if (event?.type === "candidate_end") options.onCandidate?.(false);
          if (event?.type === "start") token = options.onStart(event.overlap);
          if (event?.type === "end")
            options.onSpeech(wav([event.audio], 16000), token, event.overlap);
        }
      } catch (error) {
        failed(error);
      } finally {
        processing = false;
        if (signal.aborted) release();
      }
    };
    node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (signal.aborted) return;
      if (performance.now() - lastLevel > 100) {
        options.onLevel(
          Math.sqrt(data.reduce((n, x) => n + x * x, 0) / data.length),
        );
        lastLevel = performance.now();
      }
      pending.push(...resampler.process(data));
      // Stale frames must never trigger a late interrupt. Fail visibly if inference cannot keep up.
      if (pending.length > 24) {
        failed(Error("人声检测处理过慢，请关闭其他高负载应用后重开语音教练。"));
        return;
      }
      void drain();
    };
    await ctx.resume();
    signal.throwIfAborted();
    return stop;
  } catch (error) {
    stop();
    cleanup();
    throw error;
  }
}
