/** Runs on 16 kHz Silero frames. Start is confirmed before interrupting;
 * audio before that decision remains in the segment, including its first syllable. */
export class SpeechTurnDetector {
  active = false;
  private pre: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private positive = 0;
  private strong = 0;
  private gap = 0;
  private candidate = false;
  private candidateAge = 0;
  private window: { dt: number; speech: boolean }[] = [];
  private quiet = 0;
  private duration = 0;
  private overlap = false;
  private floor = 0.002;
  private observation = { probability: 0, rms: 0, noiseFloor: 0.002 };
  diagnostics() {
    return {
      ...this.observation,
      candidate: this.candidate,
      active: this.active,
      positiveMs: Math.round(this.positive * 1000),
      strongMs: Math.round(this.strong * 1000),
    };
  }
  reset() {
    this.active = false;
    this.pre = [];
    this.frames = [];
    this.positive = this.strong = this.gap = this.quiet = this.duration = 0;
    this.candidate = false;
    this.candidateAge = 0;
    this.window = [];
    this.overlap = false;
  }
  feed(
    frame: Float32Array,
    probability: number,
    playing: boolean,
  ):
    | { type: "start"; overlap: boolean }
    | { type: "candidate"; overlap: true }
    | { type: "candidate_end"; overlap: true }
    | { type: "end"; audio: Float32Array; overlap: boolean }
    | null {
    const dt = frame.length / 16000;
    const rms = Math.sqrt(frame.reduce((s, v) => s + v * v, 0) / frame.length);
    if (!Number.isFinite(probability) || !Number.isFinite(rms)) return null;
    this.observation = { probability, rms, noiseFloor: this.floor };
    if (!this.active) {
      this.pre.push(frame);
      while (this.pre.length > Math.ceil(0.48 / dt)) this.pre.shift();
      if (!playing && probability < 0.15)
        this.floor +=
          (1 - Math.exp(-dt / 1.5)) * (Math.max(0.0005, rms) - this.floor);
      const speech =
        probability >= 0.65 && rms > Math.max(0.001, this.floor * 1.4);
      const strong =
        probability >= 0.88 && rms > Math.max(0.001, this.floor * 2);
      this.window.push({ dt, speech });
      while (this.window.reduce((n, f) => n + f.dt, 0) > 0.32 + 1e-6)
        this.window.shift();
      if (speech) {
        this.positive =
          playing || this.overlap
            ? this.window.reduce((n, f) => n + (f.speech ? f.dt : 0), 0)
            : this.positive + dt;
        this.strong = strong ? this.strong + dt : 0;
        this.gap = 0;
        this.overlap ||= playing;
      } else {
        this.strong = 0;
        this.gap += dt;
        // Allow two weak frames during double-talk instead of restarting at
        // every consonant / AEC fluctuation. Sustained noise still resets it.
        if (!this.overlap || this.gap > 0.064 + 1e-6) {
          const restore = this.candidate;
          this.positive = this.gap = 0;
          this.window = [];
          this.candidateAge = 0;
          this.overlap = this.candidate = false;
          if (restore) return { type: "candidate_end", overlap: true };
        }
      }
      const confirmed = this.overlap
        ? this.strong + 1e-6 >= 0.16 || this.positive + 1e-6 >= 0.224
        : this.positive + 1e-6 >= 0.096;
      if (!confirmed) {
        if (this.candidate) this.candidateAge += dt;
        if (this.candidate && this.candidateAge > 0.384) {
          this.positive = this.strong = this.gap = this.candidateAge = 0;
          this.window = [];
          this.overlap = this.candidate = false;
          return { type: "candidate_end", overlap: true };
        }
        if (this.overlap && !this.candidate && this.positive + 1e-6 >= 0.064) {
          this.candidate = true;
          return { type: "candidate", overlap: true };
        }
        return null;
      }
      this.active = true;
      this.frames = [...this.pre];
      this.pre = [];
      this.duration = this.frames.reduce((s, f) => s + f.length / 16000, 0);
      this.quiet = 0;
      return { type: "start", overlap: this.overlap };
    }
    this.frames.push(frame);
    this.duration += dt;
    this.quiet = probability < 0.35 ? this.quiet + dt : 0;
    if (this.quiet < 0.64 && this.duration < 15) return null;
    const audio = new Float32Array(
      this.frames.reduce((n, f) => n + f.length, 0),
    );
    let offset = 0;
    for (const f of this.frames) {
      audio.set(f, offset);
      offset += f.length;
    }
    const overlap = this.overlap;
    this.reset();
    return { type: "end", audio, overlap };
  }
}
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** A second line of defence against residual echo. Never drop short commands. */
export function isPlaybackEcho(transcript: string, spoken: string[]) {
  const t = normalize(transcript);
  if (t.length < 8) return false;
  return spoken.some((s) => {
    const source = normalize(s);
    if (source.includes(t)) return true;
    const pairs = new Set(
      Array.from({ length: Math.max(0, source.length - 1) }, (_, i) =>
        source.slice(i, i + 2),
      ),
    );
    let matches = 0;
    for (let i = 0; i < t.length - 1; i++)
      if (pairs.has(t.slice(i, i + 2))) matches++;
    return matches / (t.length - 1) > 0.92 && t.length <= source.length * 1.15;
  });
}
