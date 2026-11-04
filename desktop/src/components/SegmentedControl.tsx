import type { CSSProperties } from "react";

export interface NavigationProps {
  value: string;
  onChange: (id: string) => void;
  items: readonly (readonly [string, string])[];
  label: string;
}

export function SegmentedControl({
  value,
  onChange,
  items,
  label,
}: NavigationProps) {
  return (
    <div
      className="segmented-control"
      role="group"
      aria-label={label}
      style={
        {
          "--segment-count": items.length,
        } as CSSProperties
      }
    >
      {items.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
