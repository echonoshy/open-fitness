import { useUiLocale } from "../i18n";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Bookmark, Camera, ListChecks, X } from "lucide-react";
import { ProductLogo } from "./ProductLogo";
import "./welcome-guide.css";

const trainingTips = [
  {
    icon: Camera,
    title: "跟着示范练",
    text: "做深蹲时，按提示侧身站好，摄像头会帮你计数。",
  },
  {
    icon: Bookmark,
    title: "收藏常练动作",
    text: "在动作库搜动作、看示范，喜欢的点加入常练。",
  },
  {
    icon: ListChecks,
    title: "按计划训练",
    text: "在计划页安排动作、组数和休息，练完去记录页看进度。",
  },
];

const voiceGroups = [
  {
    label: "训练控制",
    examples: [
      ["准备好了", "开始训练"],
      ["中途停一下", "暂停训练"],
      ["接着练", "继续训练"],
      ["练下一组", "再来一组"],
      ["换个动作", "换成哑铃侧平举"],
      ["本次练完", "结束并保存"],
    ],
  },
  {
    label: "动作讲解",
    examples: [
      ["听动作要领", "讲一下深蹲的动作要点"],
      ["看动作示范", "打开动作参考"],
      ["看清细节", "请把参考视频放大一点"],
      ["恢复原尺寸", "参考视频恢复默认大小"],
      ["收起示范", "隐藏动作参考"],
    ],
  },
  {
    label: "画面调整",
    examples: [
      ["想看近一点", "放大一点"],
      ["看完整画面", "恢复全身"],
      ["保持构图", "固定当前画面"],
      ["跟随身体", "恢复自动取景"],
      ["淡化背景", "打开背景虚化"],
      ["看清背景", "恢复清晰背景"],
    ],
  },
  {
    label: "记录与计划",
    examples: [
      ["看本组进度", "这组做了多少次？"],
      ["回顾这周", "我这周练了几次？"],
      ["对照上次", "上次深蹲做了多少次？"],
      ["看上月记录", "我上个月练过几次深蹲？"],
      ["开始计划", "开始一个深蹲计划，三组，每组十次，组间休息一分钟"],
    ],
  },
  {
    label: "教练偏好",
    examples: [
      ["减少提醒", "少说一点"],
      ["增加鼓励", "多鼓励我"],
      ["恢复频率", "恢复适中提醒"],
      ["打断播报", "停止播报"],
      ["记下器械", "记住我家里只有哑铃"],
      ["记下习惯", "记住我喜欢在早上训练"],
    ],
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
  const { language, uiText } = useUiLocale();
  const [page, setPage] = useState(initialPage);
  const [group, setGroup] = useState(voiceGroups[0]);
  const directVoiceHelp = initialPage === "voice";
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

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
        <ProductLogo />
        {!directVoiceHelp && (
          <span
            className="guide-step"
            aria-label={uiText(`第 ${page === "overview" ? "1" : "2"} 页，共 2 页`)}
          >
            <span aria-hidden="true">
              {uiText(page === "overview" ? "1" : "2")} / 2
            </span>
          </span>
        )}
        <button aria-label={uiText("退出引导")} onClick={onDismiss}>
          <X size={19} />
        </button>
      </div>
      <div className="guide-body" key={page}>
        <h2 id="welcome-guide-title" ref={heading} tabIndex={-1}>
          {uiText(page === "overview" ? "开始第一次训练" : "和语音教练说说话")}
        </h2>
        <p id="welcome-guide-description" className="guide-description">
          {uiText(page === "overview"
            ? "在训练页选好动作，点开始训练。"
            : voiceAvailable
              ? "打开训练页的麦克风就能直接说。教练说话时，也可以打断它。"
              : "先在设置的AI 服务里连接语音，再打开训练页的麦克风。")}
        </p>

        {page === "overview" ? (
          <ul className="guide-training-tips">
            {trainingTips.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Icon size={18} aria-hidden="true" />
                <div>
                  <strong>{uiText(title)}</strong>
                  <p>{uiText(text)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div
              className="guide-categories"
              role="group"
              aria-label={uiText("语音示例分类")}
            >
              {voiceGroups.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={item.label === group.label}
                  onClick={() => setGroup(item)}
                >
                  {uiText(item.label)}
                </button>
              ))}
            </div>
            <ul
              className="guide-phrases"
              aria-label={uiText(`${group.label}示例`)}
              aria-live="polite"
              aria-atomic="true"
            >
              {group.examples.map(([situation, phrase]) => (
                <li key={phrase}>
                  <span className="phrase-context">{uiText(situation)}</span>
                  <span className="spoken-phrase">
                    {uiText(phrase)}
                    {language === "en" && <small lang="zh-CN" className="guide-mandarin">{phrase}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="guide-actions">
        {page === "overview" ? (
          <>
            <button className="guide-secondary" onClick={onDismiss}>
              {uiText("跳过引导")}
            </button>
            <button className="primary" onClick={() => setPage("voice")}>
              {uiText("语音怎么用")}
            </button>
          </>
        ) : (
          <>
            {!directVoiceHelp && (
              <button
                className="guide-secondary"
                onClick={() => setPage("overview")}
              >
                {uiText("上一步")}
              </button>
            )}
            <button className="primary" onClick={onDismiss}>
              {uiText("知道了")}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
