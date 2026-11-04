import { useUiLocale } from "../i18n";
import { type CSSProperties, type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { SegmentedControl, type NavigationProps } from "./SegmentedControl";

export function PageHeading({
  title,
  sub,
  extra,
}: {
  title: string;
  sub?: string;
  extra?: ReactNode;
}) {
  const { uiText } = useUiLocale();
  return (
    <div className="page-title">
      <div>
        <h1>{uiText(title)}</h1>
        {sub && <p className="muted">{uiText(sub)}</p>}
      </div>
      {extra}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
}) {
  const { uiText } = useUiLocale();
  return (
    <div className="quiet-empty">
      <span className="empty-icon">
        <Icon size={23} strokeWidth={1.5} />
      </span>
      <strong>{uiText(title)}</strong>
      {text && <p>{uiText(text)}</p>}
    </div>
  );
}

export function SectionHeading({
  title,
  detail,
  icon: Icon,
}: {
  title: ReactNode;
  detail?: string;
  icon?: LucideIcon;
}) {
  const { uiText } = useUiLocale();
  return (
    <div className="section-heading">
      <h2>
        {Icon && <Icon size={18} strokeWidth={1.6} />}
        {uiText(title)}
      </h2>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function Metric({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  color?: string;
}) {
  const { uiText } = useUiLocale();
  return (
    <div
      className="stat-block"
      style={{ "--stat-color": color } as CSSProperties}
    >
      <span className="stat-label">{uiText(label)}</span>
      <div>
        <strong>{uiText(value)}</strong>
        {unit && <span className="stat-unit">{uiText(unit)}</span>}
      </div>
    </div>
  );
}

export function TabNavigation(props: NavigationProps & { primary?: boolean }) {
  return props.primary ? (
    <PrimaryNavigation {...props} />
  ) : (
    <SegmentedControl {...props} />
  );
}

function PrimaryNavigation({ value, onChange, items, label }: NavigationProps) {
  const { uiText } = useUiLocale();
  return (
    <div className="tab-navigation" role="group" aria-label={uiText(label)}>
      {items.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className={value === id ? "selected" : ""}
          aria-current={value === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {uiText(text)}
        </button>
      ))}
    </div>
  );
}

export const chartColors = [
  "#8acdea",
  "#b58ae8",
  "#f3ae7d",
  "#cde899",
  "#e6df99",
  "#83bca0",
  "#9698dd",
  "#de9da8",
];
const muscleColors: Record<string, string> = Object.fromEntries(
  [
    "胸部",
    "背部",
    "肩部",
    "股四头肌",
    "臀部",
    "腿后侧",
    "肱二头肌",
    "肱三头肌",
    "核心",
  ].map((name, i) => [name, chartColors[i % chartColors.length]]),
);

export function Distribution({
  groups,
}: {
  groups: { muscle: string; sets: number; last: string }[];
}) {
  const { language, uiText } = useUiLocale();
  const total = groups.reduce((sum, g) => sum + g.sets, 0);
  let offset = 0;
  return (
    <div className="distribution">
      <div className="distribution-ring">
        <svg
          viewBox="0 0 220 220"
          role="img"
          aria-label={
            uiText(total
              ? `近七天肌群关联训练共 ${total} 组，具体分布见图例`
              : "暂无近七天肌群训练数据")
          }
        >
          <circle
            cx="110"
            cy="110"
            r="88"
            fill="none"
            stroke="#3c3c3b"
            strokeWidth="22"
          />
          {groups
            .filter((g) => g.sets > 0)
            .map((g) => {
              const percent = (g.sets / total) * 100;
              const start = offset;
              offset += percent;
              return (
                <circle
                  key={g.muscle}
                  cx="110"
                  cy="110"
                  r="88"
                  pathLength="100"
                  fill="none"
                  stroke={muscleColors[g.muscle] ?? chartColors[0]}
                  strokeWidth="22"
                  strokeDasharray={`${Math.max(0.15, percent - 4)} ${100 - Math.max(0.15, percent - 4)}`}
                  strokeDashoffset={-start - 2}
                  strokeLinecap="round"
                  transform="rotate(-90 110 110)"
                />
              );
            })}
        </svg>
        <div className="ring-caption">
          <strong>{total}</strong>
          <span>{uiText("关联组数")}</span>
        </div>
      </div>
      <div className="distribution-legend">
        {groups.length ? (
          groups.map((g) => (
            <div
              key={g.muscle}
              title={uiText(`最近训练：${new Date(g.last).toLocaleDateString(language)}`)}
            >
              <i
                style={{ background: muscleColors[g.muscle] ?? chartColors[0] }}
              />
              <span>{uiText(g.muscle)}</span>
              <b>
                {g.sets}
                <small>{uiText(" 组")}</small>
              </b>
            </div>
          ))
        ) : (
          <p className="muted">
            {uiText("完成训练后，")}
            <br />
            {uiText("在这里看见肌群分布。")}
          </p>
        )}
      </div>
    </div>
  );
}
