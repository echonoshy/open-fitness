type OutputDevice = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

// Empty means follow the OS default, not the first enumerated physical output.
export function resolveOutputDevice(
  devices: readonly OutputDevice[],
  savedId?: string,
  savedLabel?: string,
): { speaker: string; speakerLabel: string | undefined } {
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const systemDefault = { speaker: "", speakerLabel: undefined };
  if (!savedId || savedId === "default") return systemDefault;
  const found =
    outputs.find((device) => device.deviceId === savedId) ||
    outputs.find((device) => savedLabel && device.label === savedLabel);
  if (found) return { speaker: found.deviceId, speakerLabel: found.label };
  // Without permission, enumeration can hide devices; preserve the user's choice.
  if (!outputs.some((device) => device.label))
    return { speaker: savedId, speakerLabel: savedLabel };
  return systemDefault;
}
