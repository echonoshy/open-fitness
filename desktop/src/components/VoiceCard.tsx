import { useUiLocale } from "../i18n";
import { Check, Circle, Play, Square } from "lucide-react";
import type { COACH_VOICES } from "../core/voices";

type Voice = (typeof COACH_VOICES)[number];

interface Props {
  voice: Voice;
  selected: boolean;
  playing: boolean;
  busy: boolean;
  loaded: boolean;
  showDescription: boolean;
  preview: (id: string) => void;
  select: (id: string) => void;
}

// Decorative sound motif. Playback state is conveyed by the play/stop control.
const bars = [
  4, 8, 6, 14, 20, 12, 8, 16, 23, 14, 6, 9, 5, 11, 17, 22, 13, 7, 12, 16, 9, 6,
  10, 4,
];

export function VoiceCard({
  voice,
  selected,
  playing,
  busy,
  loaded,
  showDescription,
  preview,
  select,
}: Props) {
  const { uiText } = useUiLocale();
  const [number, name] = voice.name.split(" · ");
  return (
    <article
      className="voice-option"
      aria-label={uiText(voice.name)}
      data-selected={selected}
      data-playing={playing}
    >
      <div className="voice-card-heading">
        <span className="voice-number">{uiText(number)}</span>
        <button
          type="button"
          className="voice-pick"
          disabled={!loaded || selected}
          aria-pressed={selected}
          aria-label={uiText(`${selected ? "已选择" : "使用"}${voice.name}`)}
          onClick={() => select(voice.id)}
        >
          {selected ? <Check size={14} /> : <Circle size={13} />}
          {uiText(selected ? "已选择" : "选用")}
        </button>
      </div>
      <h4>{uiText(name)}</h4>
      {showDescription && <p>{uiText(voice.description)}</p>}
      <button
        type="button"
        className="voice-preview"
        disabled={busy}
        aria-label={uiText(`${playing ? "停止试听" : "试听"}${voice.name}`)}
        onClick={() => preview(voice.id)}
      >
        <span className="voice-play-icon">
          {playing ? (
            <Square size={11} fill="currentColor" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
        </span>
        <span>{uiText(playing ? "停止试听" : "试听")}</span>
        <svg className="voice-wave" viewBox="0 0 96 24" aria-hidden="true">
          {bars.map((height, i) => (
            <rect
              key={i}
              x={4 * i}
              y={(24 - height) / 2}
              width="2"
              height={height}
              rx="1"
            />
          ))}
        </svg>
      </button>
    </article>
  );
}
