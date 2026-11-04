export type PcmPush = (bytes: Uint8Array, rate: number) => void;
export type PcmSource = (
  signal: AbortSignal,
  push: PcmPush,
) => Promise<unknown>;
export type SpeechKind = "waiting" | "progress" | "answer" | "final";
type SpeechItem = { text: string; kind: SpeechKind; source?: PcmSource };
const feedback = (kind: SpeechKind) =>
  kind === "waiting" || kind === "progress";
function abortable(work: Promise<unknown>, signal: AbortSignal) {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A single playback timeline. Synthesize the next sentence as soon as the
 * previous HTTP stream ends, without waiting for its audio to finish playing. */
export class ReplySpeechQueue {
  private pending: SpeechItem[] = [];
  private closed = false;
  private wake?: () => void;
  private completion?: Promise<unknown>;
  private active?: {
    kind: SpeechKind;
    controller: AbortController;
    audible: boolean;
  };
  private completedProgress: string[] = [];
  private waitingAudible = false;
  constructor(
    private synthesize: (
      text: string,
      signal: AbortSignal,
      push: PcmPush,
      kind: SpeechKind,
    ) => Promise<unknown>,
    private play: (source: PcmSource) => Promise<unknown>,
    private events: {
      onAudio?: (text: string, kind: SpeechKind) => void;
      onFeedbackError?: (error: unknown) => void;
    } = {},
  ) {}
  /** Prefer a model's specific intention to fallback audio that has not started. */
  replaceWaiting(text: string) {
    if (this.closed || this.waitingAudible || !text.trim()) return false;
    this.pending = this.pending.filter((item) => item.kind !== "waiting");
    if (this.active?.kind === "waiting") this.active.controller.abort();
    this.enqueue(text, "waiting");
    return true;
  }
  enqueue(text: string, kind: SpeechKind = "answer", source?: PcmSource) {
    if (this.closed || !text.trim()) return;
    if (kind !== "waiting") this.discardFeedback();
    this.pending.push({ text: text.trim(), kind, source });
    this.wake?.();
    if (!this.completion) {
      this.completion = this.play(async (signal, push) => {
        while (true) {
          signal.throwIfAborted();
          const next = this.pending.shift();
          if (next) {
            // Only complete, successfully synthesized receipts can cover an
            // identical prefix of the final answer. Pending/failed audio cannot.
            let text = next.text;
            if (next.kind === "final") {
              for (const receipt of this.completedProgress) {
                if (!text.startsWith(receipt)) break;
                text = text.slice(receipt.length).trimStart();
              }
            }
            if (!text) continue;
            const controller = new AbortController();
            const active = { kind: next.kind, controller, audible: false };
            this.active = active;
            const stopped = () => controller.abort();
            signal.addEventListener("abort", stopped, { once: true });
            if (signal.aborted) controller.abort();
            // Optional feedback must never hold the answer hostage to a slow TTS.
            const timeout = feedback(next.kind)
              ? setTimeout(() => controller.abort(), 2500)
              : undefined;
            const emit: PcmPush = (bytes, rate) => {
              if (
                this.active !== active ||
                controller.signal.aborted ||
                signal.aborted ||
                !bytes.length
              )
                return;
              if (!active.audible) {
                active.audible = true;
                if (next.kind === "waiting") this.waitingAudible = true;
                this.events.onAudio?.(text, next.kind);
              }
              push(bytes, rate);
            };
            try {
              controller.signal.throwIfAborted();
              await abortable(
                Promise.resolve(
                  next.source
                    ? next.source(controller.signal, emit)
                    : this.synthesize(text, controller.signal, emit, next.kind),
                ),
                controller.signal,
              );
              controller.signal.throwIfAborted();
              if (!active.audible) throw Error("没有收到语音音频");
              if (next.kind === "progress") this.completedProgress.push(text);
            } catch (error) {
              signal.throwIfAborted();
              if (!feedback(next.kind)) throw error;
              if (!controller.signal.aborted)
                this.events.onFeedbackError?.(error);
            } finally {
              clearTimeout(timeout);
              signal.removeEventListener("abort", stopped);
              if (this.active === active) this.active = undefined;
            }
          } else if (this.closed) break;
          else
            await new Promise<void>((resolve) => {
              const done = () => {
                signal.removeEventListener("abort", done);
                this.wake = undefined;
                resolve();
              };
              this.wake = done;
              signal.addEventListener("abort", done, { once: true });
              if (signal.aborted) done();
            });
        }
      });
      // A producer may fail while the model is still generating; finish still
      // propagates that failure, without an unhandled rejection in the interim.
      void this.completion.catch(() => {});
    }
  }
  private discardFeedback() {
    this.pending = this.pending.filter((item) => !feedback(item.kind));
    if (this.active && feedback(this.active.kind) && !this.active.audible)
      this.active.controller.abort();
  }
  async finish() {
    this.closed = true;
    this.wake?.();
    await this.completion;
  }
}
