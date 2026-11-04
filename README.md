# open-fitness

面向 macOS Apple Silicon 的摄像头与语音健身教练，当前试用版 **0.3.48**。Electron + React + TypeScript 客户端在本机统一通过 MediaPipe Full 完成姿态分析，无需选择模型；语音识别、对话和合成连接独立服务。**使用、开发和打包均无需本地 Python 环境。**

## 使用许可

本项目自有软件采用 [PolyForm Noncommercial 1.0.0](LICENSE)，允许按条款学习、使用和修改，商业使用须另获授权。项目原创图标和指定原创文字采用 [CC BY-NC 4.0](docs/licenses/CC-BY-NC-4.0.txt)。第三方素材保留原权利，尤其是 MoveKit 视频与封面，现有记录未确认对外分发授权。完整适用范围和署名方式见 [素材许可与来源](ASSET-LICENSES.md)，应用内可在「设置 → 关于与版本」离线查看。

## 开始试用

解压 macOS arm64 试用 ZIP，将 `open-fitness.app` 拖入「应用程序」后打开。通过 `npm run package:public` 构建时，应用位于 `desktop/release/mac-arm64/open-fitness.app`。更换版本前先正常退出正在运行的应用。

首次使用在设置中选择摄像头、麦克风、扬声器并授权；开启摄像头后按引导侧身站稳，从一组深蹲开始。使用火山 Agent Plan 时，可在「设置 → 教练声音」试听并选择四款男声、四款女声，初次使用默认「女声 1 · 清透自然」。

- [试用说明](docs/trial-guide.md)：首次使用、训练、语音、数据备份和问题反馈。
- [开发维护](desktop/README.md)：启动命令、目录职责、服务配置与打包。
- [验证清单与已知限制](docs/validation.md)：自动化覆盖、历史现场验证及待试用检查项。
- [主动语音交互设计](docs/voice-interaction.md)：竞品依据、提醒节奏、模型表达和打断边界。
- [音色维护](docs/voices.md)：已确认音色、参考音频与服务器恢复方式。
- [版本记录](CHANGELOG.md)：供项目维护查阅；软件「设置 → 关于与版本」可查看版本、构建信息和使用许可。
- [来源记录](docs/sources.md)：算法、动作资料与旧原型溯源。

## 当前功能

- 九种动作的姿态计次或支撑计时、训练计划、自动休息、逐次反馈和个人参考动作。
- 语音控制、流式回答、直接说话打断，以及服务与音视频设备诊断。
- 训练历史、趋势和长期资料。动作库提供 582 个带演示的动作，支持中英文搜索和常练收藏。
- JSON 备份、Strong / Hevy CSV 交换、旧 Python 数据导入和最近删除恢复。
- 浏览器模式使用同一套界面和训练核心，数据与桌面端独立保存。

## 开发入口

使用 Node.js 22.12+ 或 24.x 和 npm。本次维护验证环境为 Node.js 24.14.0 / npm 11.9.0。

```sh
cd desktop
npm ci
npm run dev
```

`npm test` 运行本地回归；`npm run build` 构建桌面端与 Web；`npm run package:public` 在 Mac 上生成无 Key 的 arm64 应用。维护者的 `npm run package` 自动读取本机密钥文件用于自用包。首次安装需要下载 npm 依赖和姿态模型，之后姿态推理与人声检测离线运行。

## 项目边界

活动源码集中在 `desktop/`；`data/` 只放动作目录和知识原文；`docs/` 只保留当前使用、维护与来源说明。测试样本在 `desktop/tests/fixtures/`，生成资源和本机验证报告不作为源码提交。

viaim Connect 作为摄像头、麦克风和扬声器外设使用；应用运行在 Mac 上。

全新安装的桌面数据位于 `~/Library/Application Support/open-fitness/`。已有安装继续使用同级的 `Viaim Coach/` 目录。根目录已有的旧训练记录和上传视频是个人资料，继续保留并从 Git 排除。
