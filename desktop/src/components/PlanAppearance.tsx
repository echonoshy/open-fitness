import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  Activity, BicepsFlexed, Bike, CalendarDays, Check, Dumbbell, Flag, Flame,
  Footprints, HeartPulse, Leaf, Medal, Moon, Mountain, Music2, PersonStanding,
  Route, Sparkles, Sun, Target, Timer, Trophy, Waves, Wind, Zap,
} from "lucide-react";
import {
  defaultPlanColor, defaultPlanIcon, planColors, planIcons,
  type PlanColor, type PlanIcon,
} from "../core/data";
import "./plan-appearance.css";

const symbols = {
  calendar: ["日历", CalendarDays], dumbbell: ["哑铃", Dumbbell],
  biceps: ["手臂", BicepsFlexed], activity: ["脉搏", Activity],
  heart: ["心率", HeartPulse], flame: ["火焰", Flame],
  bolt: ["闪电", Zap], target: ["目标", Target],
  footprints: ["脚步", Footprints], bike: ["骑行", Bike],
  mountain: ["山峰", Mountain], waves: ["水波", Waves],
  stretch: ["伸展", PersonStanding], route: ["路线", Route],
  timer: ["计时器", Timer], flag: ["旗帜", Flag],
  sun: ["太阳", Sun], moon: ["月亮", Moon], leaf: ["绿叶", Leaf],
  wind: ["清风", Wind], music: ["音符", Music2], sparkles: ["星光", Sparkles],
  medal: ["奖牌", Medal], trophy: ["奖杯", Trophy],
} as const;
const palette = {
  lime: ["嫩绿", "#cce89a"], amber: ["琥珀", "#eec778"],
  orange: ["珊瑚橙", "#f3a17d"], rose: ["玫瑰粉", "#ea96ae"],
  violet: ["淡紫", "#b5a1e8"], sky: ["天蓝", "#8bbbe8"],
  teal: ["薄荷", "#84cdbd"], silver: ["银灰", "#bbc0c5"],
} as const;

export type PlanAppearance = { name: string; icon: PlanIcon; color: PlanColor };

export function PlanBadge({
  icon = defaultPlanIcon, color = defaultPlanColor,
}: { icon?: PlanIcon; color?: PlanColor }) {
  const [label, Icon] = symbols[icon];
  return (
    <span className="plan-badge" style={{ color: palette[color][1] }}>
      <Icon role="img" aria-label={label} />
    </span>
  );
}

export function PlanAppearanceDialog({
  initial, onApply, onCancel,
}: {
  initial: PlanAppearance;
  onApply: (value: PlanAppearance) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);

  return (
    <dialog className="plan-appearance-dialog" ref={dialog} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const name = draft.name.trim();
        if (name) onApply({ ...draft, name });
      }}>
        <div className="appearance-body">
          <h2 id={titleId}>计划名称与图标</h2>
          <div className="appearance-preview">
            <PlanBadge icon={draft.icon} color={draft.color} />
            <input aria-label="计划名称" placeholder="输入计划名称" value={draft.name}
              maxLength={80} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <fieldset className="appearance-choices">
            <legend>颜色</legend>
            <div className="appearance-swatches">
              {planColors.map((id) => {
                const [label, tint] = palette[id];
                return (
                  <label key={id} title={label} className="appearance-choice">
                    <input type="radio" name="plan-color" aria-label={label} checked={draft.color === id}
                      onChange={() => setDraft({ ...draft, color: id })} />
                    <span style={{ backgroundColor: tint }}>
                      {draft.color === id && <Check size={15} strokeWidth={3} />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="appearance-choices">
            <legend>图标</legend>
            <div className="appearance-symbols" style={{ color: palette[draft.color][1] }}>
              {planIcons.map((id) => {
                const [label, Icon] = symbols[id];
                return (
                  <label key={id} title={label} className="appearance-choice">
                    <input type="radio" name="plan-icon" aria-label={label} checked={draft.icon === id}
                      onChange={() => setDraft({ ...draft, icon: id })} />
                    <span><Icon size={19} aria-hidden="true" /></span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
        <footer>
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" disabled={!draft.name.trim()}>完成</button>
        </footer>
      </form>
    </dialog>
  );
}
