import { speechText } from "../core/voice-routing";
import {
  ReplySpeechQueue,
  type SpeechKind,
  type PcmSource,
} from "./speech-queue";

export interface TurnFeedbackOptions {
  waiting?: (stage?: string) => string;
  allowPreamble?: (text: string) => boolean;
  onWaiting?: (source: "model" | "context" | "query") => void;
}

/** Feedback has its own lifetime and never counts as a streamed final answer. */
export class TurnFeedback {
  private answered = false;
  private done = false;
  private feedbackGiven = false;
  private waitingSource?: "model" | "context" | "query";
  private waitingText?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private delayElapsed = false;
  private stage?: string;
  constructor(
    private queue: ReplySpeechQueue,
    private signal: AbortSignal,
    private enabled: () => boolean,
    private show: (text: string, kind: SpeechKind) => void,
    private options: TurnFeedbackOptions = {},
  ) {
    signal.addEventListener("abort", this.dispose, { once: true });
    if (signal.aborted) this.dispose();
    else if (options.waiting)
      this.timer = setTimeout(() => {
        this.delayElapsed = true;
        this.waiting();
      }, 750);
  }
  private allowed() {
    return !this.done && !this.signal.aborted;
  }
  preamble(raw: string) {
    if (this.options.allowPreamble?.(raw) === false) return;
    this.offerWaiting(raw, "model");
  }
  private offerWaiting(raw: string, source: "model" | "context" | "query") {
    if (!this.allowed() || this.answered || this.feedbackGiven) return;
    const priority = { context: 0, query: 1, model: 2 };
    if (this.waitingSource && priority[source] <= priority[this.waitingSource])
      return;
    const text = speechText(raw);
    if (!text) return;
    if (text === this.waitingText) {
      this.waitingSource = source;
      return;
    }
    if (this.enabled() && !this.queue.replaceWaiting(text)) return;
    this.waitingSource = source;
    this.waitingText = text;
    this.clearTimer();
    this.show(text, "waiting");
    this.options.onWaiting?.(source);
  }
  private waiting() {
    if (!this.allowed() || !this.enabled() || !this.options.waiting) return;
    this.offerWaiting(
      this.options.waiting(this.stage),
      this.stage ? "query" : "context",
    );
  }
  query(text: string) {
    if (!this.allowed() || this.answered || this.feedbackGiven) return;
    this.stage = text;
    this.show(text, "waiting");
    if (this.delayElapsed) this.waiting();
  }
  progress(raw: string) {
    if (!this.allowed() || this.answered) return;
    const text = speechText(raw);
    if (!text) return;
    this.clearTimer();
    this.feedbackGiven = true;
    this.show(text, "progress");
    // Long receipts remain visible and are included in the final answer.
    if (this.enabled() && text.length <= 48)
      this.queue.enqueue(text, "progress");
  }
  sentence(raw: string) {
    if (!this.allowed()) return;
    const text = speechText(raw);
    if (!text) return;
    this.clearTimer();
    if (this.enabled()) {
      this.answered = true;
      this.queue.enqueue(text, "answer");
    }
  }
  async finish(raw: string, failure = false, source?: PcmSource) {
    if (!this.allowed()) return;
    this.dispose();
    if ((!this.answered || failure) && this.enabled())
      this.queue.enqueue(speechText(raw), "final", source);
    await this.queue.finish();
  }
  dispose = () => {
    this.done = true;
    this.clearTimer();
    this.signal.removeEventListener("abort", this.dispose);
  };
  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
