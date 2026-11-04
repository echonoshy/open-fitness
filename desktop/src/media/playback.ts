// One output channel for auditions, replies and exercise cues. Stopping also
// aborts synthesis, so a late HTTP response cannot start an obsolete voice.
export class VoicePlayback {
  private current?: AbortController;
  private output?: { audible: () => boolean; duck: (enabled: boolean) => void };
  get active() {
    return !!this.current;
  }
  get audible() {
    return this.output?.audible() ?? false;
  }
  duck(enabled: boolean) {
    this.output?.duck(enabled);
  }
  stop() {
    this.current?.abort();
    this.current = undefined;
    this.output = undefined;
  }

  async stream(
    source: (
      signal: AbortSignal,
      push: (bytes: Uint8Array, rate: number) => void,
    ) => Promise<unknown>,
    sink?: string,
    external?: AbortSignal,
  ) {
    this.stop();
    const controller = new AbortController();
    this.current = controller;
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    const context = new AudioContext();
    const gain = context.createGain();
    gain.connect(context.destination);
    const nodes = new Set<AudioBufferSourceNode>();
    let next = 0,
      first = Infinity,
      pending = new Uint8Array(0),
      last: AudioBufferSourceNode | undefined,
      received = 0;
    const output = {
      audible: () =>
        !controller.signal.aborted &&
        context.state === "running" &&
        context.currentTime >= first &&
        context.currentTime < next,
      duck: (enabled: boolean) => {
        if (controller.signal.aborted || context.state === "closed") return;
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setTargetAtTime(
          enabled ? 0.15 : 1,
          context.currentTime,
          0.015,
        );
      },
    };
    this.output = output;
    const stopped = () => {
      // Stop every scheduled chunk now; closing the device alone is asynchronous.
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setValueAtTime(0, context.currentTime);
      for (const node of nodes) {
        try {
          node.stop();
        } catch {
          /* An ended node is already silent. */
        }
        node.disconnect();
      }
      nodes.clear();
      void context.close().catch(() => {});
    };
    controller.signal.addEventListener("abort", stopped, { once: true });
    try {
      controller.signal.throwIfAborted();
      if (sink)
        await (
          context as AudioContext & { setSinkId: (id: string) => Promise<void> }
        ).setSinkId(sink);
      await context.resume();
      controller.signal.throwIfAborted();
      await source(controller.signal, (bytes, rate) => {
        if (controller.signal.aborted) return;
        if (!Number.isFinite(rate) || rate < 8000 || rate > 96000)
          throw Error("音频采样率无效");
        const data = new Uint8Array(pending.length + bytes.length);
        data.set(pending);
        data.set(bytes, pending.length);
        const size = Math.floor(data.length / 2);
        pending = data.slice(size * 2);
        if (!size) return;
        const buffer = context.createBuffer(1, size, rate),
          samples = buffer.getChannelData(0),
          view = new DataView(data.buffer);
        for (let i = 0; i < size; i++)
          samples[i] = view.getInt16(i * 2, true) / 32768;
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        next = Math.max(next, context.currentTime + 0.04);
        first = Math.min(first, next);
        nodes.add(node);
        node.onended = () => {
          nodes.delete(node);
          node.disconnect();
        };
        node.start(next);
        next += buffer.duration;
        last = node;
        received += size;
      });
      controller.signal.throwIfAborted();
      if (pending.length || !received) throw Error("音频数据不完整");
      if (last && next > context.currentTime)
        await new Promise<void>((resolve) => {
          const done = () => {
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const final = last!;
          final.onended = () => {
            nodes.delete(final);
            final.disconnect();
            done();
          };
          controller.signal.addEventListener("abort", done, { once: true });
        });
      return !controller.signal.aborted;
    } catch (e) {
      if (!controller.signal.aborted) throw e;
      return false;
    } finally {
      controller.signal.removeEventListener("abort", stopped);
      external?.removeEventListener("abort", abort);
      await context.close().catch(() => {});
      if (this.output === output) this.output = undefined;
      if (this.current === controller) this.current = undefined;
    }
  }

  async play(
    source: (signal: AbortSignal) => Promise<Uint8Array>,
    sink?: string,
    external?: AbortSignal,
  ) {
    this.stop();
    const controller = new AbortController();
    this.current = controller;
    const abort = () => controller.abort();
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) controller.abort();
    let audio: HTMLAudioElement | undefined;
    let url: string | undefined;
    const check = () => controller.signal.throwIfAborted();
    const output = {
      audible: () =>
        !!audio && !audio.paused && !audio.ended && !controller.signal.aborted,
      duck: (enabled: boolean) => {
        if (audio) audio.volume = enabled ? 0.15 : 1;
      },
    };
    this.output = output;
    try {
      check();
      const bytes = await source(controller.signal);
      check();
      url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
      );
      audio = new Audio(url);
      if (sink) await audio.setSinkId(sink);
      check();
      await new Promise<void>((resolve, reject) => {
        const stopped = () => {
          audio!.pause();
          resolve();
        };
        controller.signal.addEventListener("abort", stopped, { once: true });
        audio!.onended = () => {
          controller.signal.removeEventListener("abort", stopped);
          resolve();
        };
        audio!.onerror = () => {
          controller.signal.removeEventListener("abort", stopped);
          reject(Error("语音播放失败"));
        };
        audio!.play().catch((error) => {
          controller.signal.removeEventListener("abort", stopped);
          reject(error);
        });
      });
      return !controller.signal.aborted;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      return false;
    } finally {
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
      if (this.output === output) this.output = undefined;
      external?.removeEventListener("abort", abort);
      if (this.current === controller) this.current = undefined;
    }
  }
}
