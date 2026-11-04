import { useUiLocale } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play } from "lucide-react";
import type { Movement } from "../core/movement-library";

function clock(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function MovementPlayer({ item }: { item: Movement }) {
  const { uiText } = useUiLocale();
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(item.durationSeconds);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const element = video.current;
    const pauseHidden = () => {
      if (document.hidden) element?.pause();
    };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      element?.pause();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, [retry]);
  useEffect(() => {
    let wasFullscreen = false;
    const changed = () => {
      const active = document.fullscreenElement === container.current;
      setFullscreen(active);
      if (wasFullscreen && !active) fullscreenButton.current?.focus();
      wasFullscreen = active;
    };
    const exitOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        document.fullscreenElement === container.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        void document.exitFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", exitOnEscape, true);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", exitOnEscape, true);
    };
  }, []);

  const togglePlayback = async () => {
    const element = video.current;
    if (!element) return;
    setMessage("");
    if (!element.paused) element.pause();
    else {
      try {
        await element.play();
      } catch {
        setMessage("播放暂未开始，请重试。");
      }
    }
  };
  const toggleFullscreen = async () => {
    if (expanding) return;
    setExpanding(true);
    setMessage("");
    try {
      if (document.fullscreenElement === container.current)
        await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch {
      setMessage("暂时无法进入全屏，请重试。");
    } finally {
      setExpanding(false);
    }
  };

  return (
    <div
      ref={container}
      className="movement-player"
      role="region"
      aria-label={uiText(`${item.name}播放器`)}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      {failed ? (
        <>
          <img
            src={item.poster}
            alt={uiText(`${item.name}动作图示`)}
            draggable={false}
          />
          <div className="movement-video-error" role="alert">
            <strong>{uiText("视频暂时无法播放")}</strong>
            <span>{uiText("可以先看动作图示和要领，或重新加载。")}</span>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setReady(false);
                setTime(0);
                setPlaying(false);
                setRetry((value) => value + 1);
              }}
            >
              {uiText("重新加载视频")}
            </button>
          </div>
        </>
      ) : (
        <>
          <video
            key={retry}
            ref={video}
            src={item.video}
            poster={item.poster}
            controls={false}
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            draggable={false}
            loop
            muted
            playsInline
            autoPlay={
              !window.matchMedia("(prefers-reduced-motion: reduce)").matches
            }
            preload="metadata"
            aria-label={uiText(`${item.name}动作视频`)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration);
              setReady(true);
            }}
            onError={() => {
              setFailed(true);
              setPlaying(false);
            }}
          />
        </>
      )}
      <div className="movement-player-controls">
        <button
          type="button"
          className="icon-button"
          disabled={failed}
          aria-label={uiText(playing ? "暂停演示" : "播放演示")}
          onClick={() => void togglePlayback()}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <span className="movement-player-time">
          {uiText(clock(time))} / {uiText(clock(duration))}
        </span>
        <input
          type="range"
          min={0}
          max={Number.isFinite(duration) ? duration : 0}
          step={0.01}
          value={time}
          disabled={!ready || failed}
          aria-label={uiText("视频进度")}
          aria-valuetext={`${clock(time)}，共 ${clock(duration)}`}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (video.current) video.current.currentTime = next;
            setTime(next);
          }}
        />
        <button
          ref={fullscreenButton}
          type="button"
          className="icon-button"
          aria-label={uiText(fullscreen ? "退出视频全屏" : "全屏观看")}
          title={uiText(fullscreen ? "退出全屏（Esc）" : "全屏观看")}
          disabled={expanding}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </div>
      {message && (
        <p className="movement-player-message" role="status">
          {uiText(message)}
        </p>
      )}
    </div>
  );
}
