import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import coachIcon from "../../assets/branding/icon.svg";
import "./welcome-guide.css";

const voiceGroups = [
  {
    label: "训练控制",
    hint: "训练时可以暂停或继续。要换动作时，可以直接说动作名称。",
    examples: ["暂停训练", "继续训练", "换成哑铃侧平举"],
  },
  {
    label: "动作讲解",
    hint: "询问动作要点，或调整屏幕上的示范视频。",
    examples: [
      "讲一下深蹲的动作要点",
      "打开动作参考",
      "放大动作参考",
      "隐藏动作参考",
    ],
  },
  {
    label: "画面调整",
    hint: "打开摄像头后，可以调整取景和背景。",
    examples: ["放大一点", "恢复全身", "固定画面", "打开背景虚化"],
  },
  {
    label: "记录与计划",
    hint: "查看之前的训练，或告诉教练下一次想怎么练。",
    examples: [
      "我这周练了几次？",
      "上次深蹲做了多少？",
      "开始一个深蹲计划，3 组，每组 10 次，组间休息 60 秒",
    ],
  },
  {
    label: "教练偏好",
    hint: "告诉教练你喜欢的提醒方式，或请它记住常用器械。",
    examples: ["少说一点", "多鼓励我", "停止播报", "记住我家里只有哑铃"],
  },
];

interface Props {
  initialPage: "overview" | "voice";
  voiceAvailable: boolean;
  onDismiss: () => void;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}

export function WelcomeGuide({
  initialPage,
  voiceAvailable,
  onDismiss,
  fallbackFocus,
}: Props) {
  const [page, setPage] = useState(initialPage);
  const [group, setGroup] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = voiceGroups[group];

  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      if (
        previous instanceof HTMLElement &&
        previous !== document.body &&
        previous.isConnected
      )
        previous.focus();
      else fallbackFocus.current?.focus();
    };
  }, [fallbackFocus]);

  useEffect(() => {
    heading.current?.focus();
    dialog.current?.scrollTo(0, 0);
  }, [page]);

  return (
    <dialog
      ref={dialog}
      className="welcome-guide"
      aria-labelledby="welcome-guide-title"
      aria-describedby="welcome-guide-description"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <div className="guide-topline">
        <img
          className="guide-logo"
          src={coachIcon}
          alt="open-fitness"
          width="40"
          height="40"
        />
        <span
          className="guide-step"
          aria-label={`第 ${page === "overview" ? "1" : "2"} 页，共 2 页`}
        >
          <span aria-hidden="true">{page === "overview" ? "1" : "2"} / 2</span>
        </span>
        <button aria-label="退出引导" onClick={onDismiss}>
          <X size={19} />
        </button>
      </div>
      <h2 id="welcome-guide-title" ref={heading} tabIndex={-1}>
        {page === "overview" ? "开始第一次训练" : "你可以这样说"}
      </h2>
      <p id="welcome-guide-description" className="guide-description">
        {page === "overview"
          ? "在「训练」页选好动作，点「开始训练」。"
          : "在训练页打开麦克风就能直接说，教练说话时也可以打断。"}
      </p>

      {page === "overview" ? (
        <>
          <ul className="guide-features">
            <li>
              <h3>摄像头</h3>
              <p>自动计数时，按画面提示站好。仅计时的动作可以关着摄像头练。</p>
            </li>
            <li>
              <h3>动作示范</h3>
              <p>跟着参考视频练。小窗挡住画面时，拖到顺手的位置即可。</p>
            </li>
            <li>
              <h3>常练动作</h3>
              <p>在「动作库」点「加入常练」，下次就能在「常练动作」里找到它。</p>
            </li>
          </ul>
          <div className="guide-start">
            <strong>试试语音</strong>
            <p>打开训练页的麦克风，说「暂停训练」或「继续训练」。</p>
          </div>
        </>
      ) : (
        <div className="guide-voice">
          <div
            className="guide-categories"
            role="group"
            aria-label="语音示例分类"
          >
            {voiceGroups.map((item, index) => (
              <button
                key={item.label}
                aria-pressed={group === index}
                onClick={() => setGroup(index)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="guide-examples" aria-live="polite" aria-atomic="true">
            <p>{selected.hint}</p>
            <ul aria-label={`${selected.label}示例`}>
              {selected.examples.map((example) => (
                <li key={example}>
                  <span>{example}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="guide-voice-note">
            {voiceAvailable
              ? "语音需要联网。没有回应时，先检查训练页的麦克风。"
              : "语音服务尚未连接。可到「设置」里的「AI 服务」检查连接，或先用按钮训练。"}
          </p>
        </div>
      )}

      <div className="guide-actions">
        {page === "overview" ? (
          <>
            <button className="guide-secondary" onClick={onDismiss}>
              跳过引导
            </button>
            <button className="primary" onClick={() => setPage("voice")}>
              查看语音示例
            </button>
          </>
        ) : (
          <>
            <button
              className="guide-secondary"
              onClick={() => setPage("overview")}
            >
              上一步
            </button>
            <button className="primary" onClick={onDismiss}>
              完成引导
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
