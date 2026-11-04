import { readFile } from "node:fs/promises";
import { configureServices, endpoints } from "../electron/services";
configureServices(process.env.COACH_SERVICES_CONFIG);
const selection = JSON.parse(
  await readFile(
    new URL("../assets/voices/selection.json", import.meta.url),
    "utf8",
  ),
);
const response = await fetch(endpoints.tts + "/audio/voices");
if (!response.ok) throw Error(await response.text());
const existing = await response.json();
for (const voice of selection.voices) {
  if (existing.voices.includes(voice.id)) {
    console.log(voice.code + " already registered");
    continue;
  }
  const bytes = await readFile(
    new URL("../assets/voices/" + voice.referenceFile, import.meta.url),
  );
  const form = new FormData();
  form.set("name", voice.id);
  form.set("consent", "original-synthetic-voice-generated-by-voxcpm2");
  form.set("ref_text", voice.referenceText);
  form.set("speaker_description", voice.design);
  form.set(
    "audio_sample",
    new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    "reference.wav",
  );
  const r = await fetch(endpoints.tts + "/audio/voices", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error(await r.text());
  console.log(voice.code + " registered as " + voice.id);
}
