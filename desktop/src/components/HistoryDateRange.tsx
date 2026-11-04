import { useUiLocale } from "../i18n";
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
  const { language, uiText } = useUiLocale();
  const [year, month, day] = value.split("-");
  return (
    <label className="date-field">
      <input
        aria-label={uiText(label)}
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={({ target }) => onChange(target.value)}
      />
      <span className="date-display" aria-hidden="true">
        <CalendarDays size={15} />
        {value ? new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(language, {year: "numeric", month: "short", day: "numeric"}) : uiText(placeholder)}
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
  const { uiText } = useUiLocale();
  return (
    <div className="date-range" role="group" aria-label={uiText(label + "日期范围")}>
      <DateField
        label={uiText(label + "开始日期")}
        placeholder={uiText("开始日期")}
        value={from}
        max={to}
        onChange={(value) => onChange(value, to)}
      />
      <span className="date-until" aria-hidden="true">
        {uiText("至")}
      </span>
      <DateField
        label={uiText(label + "结束日期")}
        placeholder={uiText("结束日期")}
        value={to}
        min={from}
        onChange={(value) => onChange(from, value)}
      />
      {(from || to) && (
        <button
          type="button"
          className="icon-button"
          aria-label={uiText("清除日期筛选")}
          title={uiText("清除日期筛选")}
          onClick={() => onChange("", "")}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
