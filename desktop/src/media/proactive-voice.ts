/** One optional utterance. User speech invalidates generation AND playback. */
export class ProactiveVoice {
  private controller?: AbortController;
  private audible = false;
  private check?: (audible: boolean) => boolean;
  get busy() {
    return !!this.controller;
  }
  cancel() {
    this.controller?.abort();
    this.controller = undefined;
    this.check = undefined;
  }
  validate() {
    if (this.check && !this.check(this.audible)) this.cancel();
  }
  async run(
    generate: (signal: AbortSignal) => Promise<string>,
    play: (
      text: string,
      signal: AbortSignal,
      firstAudio: () => void,
    ) => Promise<void>,
    valid: (audible: boolean) => boolean,
    onSpoken: (text: string) => void,
  ) {
    this.cancel();
    const local = new AbortController();
    this.controller = local;
    this.check = valid;
    this.audible = false;
    const current = () =>
      this.controller === local && !local.signal.aborted && valid(this.audible);
    try {
      const text = await generate(local.signal);
      if (!text || !current()) return;
      await play(text, local.signal, () => {
        if (!current()) {
          local.abort();
          return;
        }
        if (!this.audible) {
          this.audible = true;
          onSpoken(text);
        }
      });
    } catch {
      // Optional coaching must not turn a workout into a stream of error dialogs.
    } finally {
      if (this.controller === local) {
        this.controller = undefined;
        this.check = undefined;
      }
    }
  }
}
