import { CalendarDays, X } from "lucide-react";

function DateField({
  label,
  placeholder,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const [year, month, day] = value.split("-");
  return (
    <label className="date-field">
      <input
        aria-label={label}
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={({ target }) => onChange(target.value)}
      />
      <span className="date-display" aria-hidden="true">
        <CalendarDays size={15} />
        {value ? `${year}年${Number(month)}月${Number(day)}日` : placeholder}
      </span>
    </label>
  );
}

export function HistoryDateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="date-range" role="group" aria-label={label + "日期范围"}>
      <DateField
        label={label + "开始日期"}
        placeholder="开始日期"
        value={from}
        max={to}
        onChange={(value) => onChange(value, to)}
      />
      <span className="date-until" aria-hidden="true">
        至
      </span>
      <DateField
        label={label + "结束日期"}
        placeholder="结束日期"
        value={to}
        min={from}
        onChange={(value) => onChange(from, value)}
      />
      {(from || to) && (
        <button
          type="button"
          className="icon-button"
          aria-label="清除日期筛选"
          title="清除日期筛选"
          onClick={() => onChange("", "")}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
