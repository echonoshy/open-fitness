import { z } from "zod";

export const voiceCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("exercise_reference_size"),
      size: z.enum(["medium", "large", "larger", "smaller"]),
    })
    .strict(),
  z
    .object({ type: z.literal("exercise_reference"), enabled: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("background_blur"),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_guidance"),
      level: z.enum(["quiet", "balanced", "active"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("speech_control"),
      action: z.enum(["stop", "mute", "unmute"]),
    })
    .strict(),
]);
export type VoiceCommand = z.infer<typeof voiceCommandSchema>;

/** Whole utterances only; negations, quoted speech and compound requests use the model. */
export function localSpeechCommand(text: string): VoiceCommand | null {
  if (
    /^(?:停止说话|停止播报|别说了|不要说了|先别说了|先安静一会儿?|安静一会儿?)$/.test(
      text,
    )
  )
    return { type: "speech_control", action: "stop" };
  if (/^(?:关闭|关掉)(?:所有|全部)?(?:语音播报|教练播报|教练声音)$/.test(text))
    return { type: "speech_control", action: "mute" };
  if (/^(?:开启|打开|恢复)(?:语音播报|教练播报|教练声音)$/.test(text))
    return { type: "speech_control", action: "unmute" };
  return null;
}
