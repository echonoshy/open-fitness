import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  movementEquipment,
  movementLevels,
  movementMuscles,
  type Movement,
} from "../core/movement-library";

export type MovementFacets = {
  level?: string;
  muscle?: string;
  equipment?: string;
};
const groups = [
  { key: "level", label: "难度", options: movementLevels, visible: 4 },
  { key: "muscle", label: "训练肌群", options: movementMuscles, visible: 8 },
  { key: "equipment", label: "器械", options: movementEquipment, visible: 7 },
] as const;

export function MovementFilters({
  items,
  value,
  onChange,
}: {
  items: Movement[];
  value: MovementFacets;
  onChange: (value: MovementFacets) => void;
}) {
  const levels = useMemo(() => {
    const available = new Set(items.map((item) => item.level));
    return Object.entries(movementLevels).filter(([id]) => available.has(id));
  }, [items]);
  const [expanded, setExpanded] = useState<
    Partial<Record<keyof MovementFacets, boolean>>
  >({});
  return (
    <div className="movement-facets">
      {groups.map(({ key, label, options, visible }) => {
        const entries = key === "level" ? levels : Object.entries(options);
        const open = expanded[key];
        return (
          <fieldset className="facet-group" key={key}>
            <legend>{label}</legend>
            <div className="facet-options">
              <button
                type="button"
                aria-pressed={!value[key]}
                onClick={() => onChange({ ...value, [key]: undefined })}
              >
                全部
              </button>
              {entries
                .filter(([id], i) => open || i < visible || id === value[key])
                .map(([id, text]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={value[key] === id}
                    onClick={() =>
                      onChange({
                        ...value,
                        [key]: value[key] === id ? undefined : id,
                      })
                    }
                  >
                    {text}
                  </button>
                ))}
              {entries.length > visible && (
                <button
                  className="facet-expand"
                  type="button"
                  aria-expanded={!!open}
                  aria-label={`${open ? "收起" : "展开"}全部${label}`}
                  onClick={() =>
                    setExpanded((old) => ({ ...old, [key]: !open }))
                  }
                >
                  {open ? "收起" : "更多"}
                  {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
