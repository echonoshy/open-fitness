import { useUiLocale } from "../i18n";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, RotateCcw, Volume2, X } from "lucide-react";
import { EXERCISES, type Exercise } from "../core/engine";
import { EXERCISE_REFERENCES } from "../core/exercise-reference";
import {
  REFERENCE_SIZES,
  REFERENCE_SIZE_LABELS,
  type ReferenceSize,
} from "../core/reference-view";

import { useReferenceDrag } from "./use-reference-drag";
import type { Movement } from "../core/movement-library";

interface Props {
  movement?: Movement;
  exercise: Exercise;
  size: ReferenceSize;
  setSize: (size: ReferenceSize) => Promise<void>;
  explainAvailable: boolean;
  explain: () => void;
  close: () => Promise<void>;
  report: (error: unknown) => void;
}

export function ExerciseReference(p: Props) {
  const drag = useReferenceDrag();
  return (
    <div
      ref={drag.slot}
      className="reference-slot"
      data-detached={drag.detached || undefined}
      data-size={p.size}
      {...drag.handlers}
    >
      <ReferencePlayer
        key={p.movement?.slug ?? p.exercise}
        {...p}
        returnHome={drag.detached ? drag.reset : undefined}
      />
    </div>
  );
}

function ReferencePlayer(p: Props & { returnHome?: () => void }) {
  const { uiText } = useUiLocale();
  const reference = p.movement ?? EXERCISE_REFERENCES[p.exercise];
  const name = p.movement?.name ?? EXERCISES[p.exercise].label;
  const video = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [changing, setChanging] = useState(false);
  const change = async (apply: () => Promise<void>) => {
    setChanging(true);
    try {
      await apply();
    } catch (error) {
      p.report(error);
    } finally {
      setChanging(false);
    }
  };

  useEffect(() => {
    const media = video.current;
    if (!media) return;
    let active = true;
    const start = () => {
      media.muted = true;
      void media.play().catch(() => {
        if (active) setPaused(true);
      });
    };
    const visibility = () => {
      if (document.hidden) media.pause();
      else if (active && !media.error && !userPaused.current) start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", visibility);
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, []);

  const togglePlayback = async () => {
    const media = video.current;
    if (!media) return;
    if (failed) {
      setFailed(false);
      media.load();
    } else if (!media.paused) {
      userPaused.current = true;
      media.pause();
      return;
    }
    try {
      userPaused.current = false;
      await media.play();
    } catch {
      setPaused(true);
    }
  };

  return (
    <aside
      className="exercise-reference-card"
      aria-label={uiText("动作参考")}
      data-size={p.size}
      style={{ "--reference-aspect": aspectRatio } as CSSProperties}
    >
      <div
        className="reference-heading"
        title={uiText("拖动可移动视频，松手停在当前位置")}
      >
        <strong>{uiText(name)}</strong>
        {p.returnHome && (
          <button
            type="button"
            className="reference-return"
            aria-label={uiText("将参考视频放回原位")}
            title={uiText("放回原位")}
            onClick={p.returnHome}
          >
            <RotateCcw size={15} />
          </button>
        )}
        <button
          type="button"
          aria-label={uiText("关闭动作参考")}
          title={uiText("关闭动作参考")}
          disabled={closing || changing}
          onClick={async () => {
            setClosing(true);
            try {
              await p.close();
            } catch (error) {
              p.report(error);
            } finally {
              setClosing(false);
            }
          }}
        >
          <X size={17} />
        </button>
      </div>
      <div className="reference-media">
        <video
          ref={video}
          draggable={false}
          src={reference.video}
          poster={reference.poster}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-label={uiText(`${name}动作示范`)}
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            if (media.videoWidth > 0 && media.videoHeight > 0)
              setAspectRatio(media.videoWidth / media.videoHeight);
          }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onError={() => setFailed(true)}
        />
        {failed && (
          <p className="reference-error" role="status">
            {uiText("示范暂时无法播放，可重试或听语音讲解。")}
          </p>
        )}
        <button
          className="reference-playback"
          type="button"
          aria-label={
            uiText(failed ? "重试动作示范" : paused ? "播放动作示范" : "暂停动作示范")
          }
          title={uiText(failed ? "重试播放" : paused ? "播放示范" : "暂停示范")}
          onClick={() => void togglePlayback()}
        >
          {failed ? (
            <RotateCcw size={14} />
          ) : paused ? (
            <Play size={14} />
          ) : (
            <Pause size={14} />
          )}
        </button>
      </div>
      <div className="reference-footer">
        <div className="reference-sizes" role="group" aria-label={uiText("参考视频尺寸")}>
          {REFERENCE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-label={uiText(`参考视频设为${REFERENCE_SIZE_LABELS[size]}`)}
              aria-pressed={p.size === size}
              title={uiText(`参考视频${REFERENCE_SIZE_LABELS[size]}`)}
              disabled={changing}
              onClick={() => void change(() => p.setSize(size))}
            >
              {uiText(REFERENCE_SIZE_LABELS[size])}
            </button>
          ))}
        </div>
        {p.explainAvailable && (
          <button
            type="button"
            onClick={p.explain}
            aria-label={uiText("讲解当前动作要点")}
          >
            <Volume2 size={14} />{uiText(" 讲解")}
          </button>
        )}
      </div>
    </aside>
  );
}
