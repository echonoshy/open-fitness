import type { Exercise } from "../core/engine";
import { coachVoice } from "../core/voices";
import { readPcmWav } from "../core/pcm-wav";
import type { PcmSource } from "./speech-queue";

/** Bundled recordings share the reply timeline, speaker selection and cancellation. */
export function exerciseNarrationSource(
  exercise: Exercise,
  voice: string,
  load: typeof fetch = fetch,
): PcmSource {
  return async (signal, push) => {
    signal.throwIfAborted();
    const response = await load(
      `./exercise-narration/${coachVoice(voice).id}/${exercise}.wav`,
      { signal },
    );
    if (!response.ok)
      throw Error("本地讲解音频读取失败，请重新打开应用后重试。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal.throwIfAborted();
    const { pcm, sampleRate } = readPcmWav(bytes);
    push(pcm, sampleRate);
  };
}
