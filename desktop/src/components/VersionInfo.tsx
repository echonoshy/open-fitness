import { useUiLocale } from "../i18n";
import { useState } from "react";
import codeTranslation from "../../../docs/licenses/open-fitness-code.zh-Hans.md?raw";
import codeLicense from "../../../LICENSE?raw";
import englishNotices from "../../../docs/licenses/asset-sources.en.md?raw";
import englishAssetLicense from "../../../docs/licenses/CC-BY-NC-4.0.txt?raw";
import assetNotices from "../../../ASSET-LICENSES.md?raw";
import originalAssetLicense from "../../../docs/licenses/CC-BY-NC-4.0.zh-Hans.md?raw";
import { ProductLogo } from "./ProductLogo";
import { CoachMarkdown } from "./CoachMarkdown";
import { SegmentedControl } from "./SegmentedControl";
import { version } from "../../package.json";
import { desktop } from "../platform";

// Reflow the distributed plain text for the same reader used by the other licenses.
const englishAssetTerms = englishAssetLicense.trim().split(/\n\s*\n/).flatMap((block, index) => {
  const text = block.trim().replace(/-\n\s*/g, "-").replace(/\s+/g, " ");
  if (/^=+$/.test(text)) return [];
  if (index === 0) return ["# " + text];
  if (/^(Section \d+ --|Using Creative Commons Public Licenses$)/.test(text)) return ["## " + text];
  return [text];
}).join("\n\n");

const licenseDocuments = [
  {
    id: "sources",
    label: "素材来源",
    edition: "项目素材授权清单",
    text: assetNotices,
    english: englishNotices,
  },
  {
    id: "code",
    label: "项目代码",
    edition: "PolyForm Noncommercial 1.0.0 · 中文参考译文",
    text: codeTranslation,
    english: "# " + codeLicense.replace(/^# /gm, "## "),
  },
  {
    id: "content",
    label: "原创素材",
    edition: "CC BY-NC 4.0 · 官方简体中文",
    text: originalAssetLicense,
    english: englishAssetTerms,
  },
];
const licenseTabs = licenseDocuments.map(
  ({ id, label }) => [id, label] as const,
);

export function VersionInfo() {
  const { language, uiText } = useUiLocale();
  const [license, setLicense] = useState("sources");
  const document = licenseDocuments.find(({ id }) => id === license)!;
  return (
    <section
      className="settings-card version-info"
      aria-labelledby="version-title"
    >
      <div className="settings-heading">
        <h2 id="version-title">{uiText("关于与版本")}</h2>
      </div>
      <div className="version-columns">
        <section className="version-overview" aria-label={uiText("版本信息")}>
          <div className="version-product">
            <ProductLogo />
            <strong>v{uiText(version)}</strong>
          </div>
          <dl>
            <dt>{uiText("构建时间")}</dt>
            <dd>
              <time dateTime={__APP_BUILD_TIME__}>
                {new Date(__APP_BUILD_TIME__).toLocaleString(language, {
                  timeZone: "Asia/Shanghai",
                  dateStyle: "long",
                  timeStyle: "short",
                  hour12: false,
                })}{" "}
                {uiText("· 北京时间")}
              </time>
            </dd>
            <dt>{uiText("运行模式")}</dt>
            <dd>
              {uiText(desktop ? "桌面端" : "浏览器端")}
              {uiText(import.meta.env.DEV ? " · 开发模式" : "")}
            </dd>
          </dl>
          <p>{uiText("反馈问题时，请附上版本号和构建时间。")}</p>
        </section>
        <section className="version-licenses" aria-label={uiText("使用许可")}>
          <h3>{uiText("使用许可")}</h3>
          <p>
            {uiText("限非商业使用。分享或改编原创图标及清单中指定的文字时，请署名并注明改动。商业使用须另获授权。")}
          </p>
          <details>
            <summary>{uiText("查看完整许可与来源")}</summary>
            <SegmentedControl
              label={uiText("许可文档")}
              value={license}
              onChange={setLicense}
              items={licenseTabs}
            />
            <div
              className="license-text"
              key={license}
              tabIndex={0}
              role="region"
              aria-label={uiText(document.label + "正文")}
            >
              <span className="license-edition">{uiText(document.edition)}</span>
              <div lang={language} data-license={license}>
                <CoachMarkdown text={language === "en" ? document.english : document.text} />
              </div>
              {language !== "en" && license === "code" && (
                <details>
                  <summary>{uiText("对照英文原文")}</summary>
                  <div lang="en">
                    <CoachMarkdown text={codeLicense} />
                  </div>
                </details>
              )}
            </div>
          </details>
        </section>
      </div>
    </section>
  );
}
