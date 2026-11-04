export const REFERENCE_SIZES = ["medium", "large"] as const;
export type ReferenceSize = (typeof REFERENCE_SIZES)[number];
export type ReferenceSizeRequest = ReferenceSize | "larger" | "smaller";
export const REFERENCE_SIZE_LABELS: Record<ReferenceSize, string> = {
  medium: "标准",
  large: "放大",
};

export function referenceViewSummary(view: {
  enabled: boolean;
  size: ReferenceSize;
}) {
  return `动作参考当前${view.enabled ? "开启" : "关闭"}，尺寸为${REFERENCE_SIZE_LABELS[view.size]}。`;
}

export function resolveReferenceSize(
  current: ReferenceSize,
  request: ReferenceSizeRequest,
): ReferenceSize {
  if (request !== "larger" && request !== "smaller") return request;
  const index =
    REFERENCE_SIZES.indexOf(current) + (request === "larger" ? 1 : -1);
  return REFERENCE_SIZES[
    Math.max(0, Math.min(REFERENCE_SIZES.length - 1, index))
  ];
}
