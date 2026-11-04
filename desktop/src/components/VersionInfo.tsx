import codeLicense from "../../../LICENSE?raw";
import assetNotices from "../../../ASSET-LICENSES.md?raw";
import contentLicense from "../../../docs/licenses/CC-BY-NC-4.0.txt?raw";
import { CoachMarkdown } from "./CoachMarkdown";
import { version } from "../../package.json";
import { desktop } from "../platform";

export function VersionInfo() {
  return (
    <section
      className="settings-card version-info"
      aria-labelledby="version-title"
    >
      <div className="settings-heading">
        <h2 id="version-title">关于与版本</h2>
      </div>
      <div className="service-row">
        <span>open-fitness</span>
        <strong>v{version}</strong>
      </div>
      <div className="service-row">
        <span>构建时间</span>
        <time dateTime={__APP_BUILD_TIME__}>
          {new Date(__APP_BUILD_TIME__).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}
          （北京时间）
        </time>
      </div>
      <div className="service-row">
        <span>运行模式</span>
        <span>
          {desktop ? "桌面端" : "浏览器端"}
          {import.meta.env.DEV ? " · 开发模式" : ""}
        </span>
      </div>
      <h3>使用许可</h3>
      <p>项目代码采用 PolyForm Noncommercial 1.0.0。原创图标和清单中指定的文字采用 CC BY-NC 4.0，分享或改编须署名并注明改动。商业使用须另获授权。</p>
      <p>MoveKit 动作视频和封面仅供内部参考。语音、模型和其他第三方内容各有适用条款。</p>
      <details>
        <summary>素材许可与来源</summary>
        <div className="license-text"><CoachMarkdown text={assetNotices} /></div>
      </details>
      <details>
        <summary>代码许可全文 · PolyForm Noncommercial 1.0.0</summary>
        <div className="license-text"><CoachMarkdown text={codeLicense} /></div>
      </details>
      <details>
        <summary>原创素材许可全文 · CC BY-NC 4.0</summary>
        <pre className="license-text">{contentLicense}</pre>
      </details>
      <p>反馈问题时，请附上版本号和构建时间，方便确认你正在使用的版本。</p>
    </section>
  );
}
