# open-fitness 开发维护

当前产品由 Electron、React、TypeScript 和同源 Web 服务组成，不运行本地 Python 服务。使用说明见 [试用指南](../docs/trial-guide.md)，测试范围见 [验证清单](../docs/validation.md)。以下命令均在 `desktop/` 执行。

## 安装与运行

Node.js 22.12+ 或 24.x，npm 使用仓库锁文件安装。本次维护验证使用 Node.js 24.14.0 / npm 11.9.0。

```sh
npm ci
npm run dev
```

`npm ci` 的 postinstall 会准备 MediaPipe、Silero、ONNX Runtime、SQLite WASM、动作知识和姿态 Worker。姿态模型固定使用 MediaPipe Pose Landmarker Full（float16 / v1），缓存于 `public/models/pose_landmarker_full.task`；首次下载固定版本并检查 SHA-256。已有缓存时无需重复下载，构建会清理旧 Lite、Heavy 缓存，客户端不提供模型选择。Full 在独立 Worker 中使用 CPU 推理，输出 33 个关键点，模型包约 9.4 MB。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 构建资源并启动 Electron 开发版 |
| `npm run web` | Web 开发服务，地址 `http://127.0.0.1:5178` |
| `npm test` | 本地自动化回归，不连接真实 AI 服务 |
| `npm run build` | TypeScript 检查、资源生成、前端和主进程/Web 后端构建 |
| `npm start` | 启动已构建的 Electron 代码，需先 build |
| `npm run serve:web` | 已构建的 Web 服务；用 `PORT=5182` 等环境变量换端口 |
| `npm run icon` | 从最终美术源文件生成 `build/icon.icns` |
| `npm run package` | 使用本机密钥文件生成自用包 |
| `npm run package:public` | 生成不含 Key 的分发包 |
| `npm run verify:vad` | 用本地样本执行真实 Silero 推理，结果在 `output/` |
| `npm run verify:services` | 显式调用真实 LLM / ASR / TTS，测试合成语音和内存训练状态 |

修改动作资料或姿态 Worker 后，先执行 `npm run build` 或重新启动 `npm run dev`，让生成资源更新。只部署 `dist/` 时，语音功能还需要 `dist-web/server.mjs` 提供接口。

## 目录与运行职责

| 目录 | 职责 |
| --- | --- |
| `src/components/`、`src/App.tsx` | React 界面与训练、设备、语音协调 |
| `src/core/` | 训练状态、计数、姿态检查、数据、教练工具、语音轮次 |
| `src/media/` | 摄像头、MediaPipe Worker、Silero 人声检测、播放队列 |
| `electron/` | 桌面窗口、权限、文件读写、可配置服务请求 |
| `web/` | 同源语音 API 和 Web 静态服务 |
| `config/` | 随包默认服务配置 |
| `assets/branding/` | 最终图标源文件；生成的图标在 `build/` |
| `public/exercise-narration/`、`public/pcm-worklet.js` | 动作示范的预录讲解与录音 Worklet，教练音色试听由当前 TTS 服务实时合成 |
| `tests/` | 功能回归；算法对照 JSON 位于 `fixtures/`，无需运行 Python |
| `scripts/` | 构建、资源准备和仍适用的维护命令 |
| `output/`、`release/`、`dist*/`、`build/` | 本机生成内容，Git 忽略 |

从「训练」页开始训练，在「动作库 → 常练动作」管理收藏，在「计划」页编排训练。全库 582 个动作中，原有 8 个计数动作和平板支撑继续使用 `SessionEngine`；其余动作通过 `TimedTraining` 保存独立统计：385 个估算计数、19 个保持计时、148 个活动计时、21 个普通计时。共享摄像头、关节点、背景虚化与动作示范，不复用无关动作的评分。

新增统计规则在 `src/core/movement-statistics.ts`，视频标定数据在 `movement-calibration.json`。更新演示素材后，先在单独 Python 环境安装 MediaPipe / OpenCV，执行 `scripts/extract-movement-poses.py --output <缓存目录>`，再执行 `npx tsx scripts/calibrate-movement-statistics.ts <缓存目录>`；提取过程离线进行，不属于应用运行依赖。实际训练与记录的核验方法见[验证清单](../docs/validation.md)。

自动计数和姿态计时状态以本地 `SessionEngine` 为准；模型调用工具后读取实际执行结果。摄像头视频与姿态推理在本机进行。开启语音时，音频片段、对话和所需训练上下文发往配置的服务。

原有九个动作的关节角度使用平滑后的 MediaPipe **归一化图像 x/y/z**，与保留的算法对照样本一致。深蹲先检查侧身、同侧肩髋膝踝入镜及站立稳定。短暂丢点保留窗口为 0.65 秒，处理帧间隔上限为 1 秒；恢复需连续性检查，缺失时间不计入动作或支撑时长。实现以 `src/core/pose-checks.ts`、`session.ts` 和 `media/pose.worker.ts` 为准。新增动作使用校正画面宽高比后的二维关节信号，发生超过 0.5 秒的帧间隔或关键关节缺失时丢弃未完成周期；这套估算规则没有真人准确率基准。

## 服务配置

公开源码与分发包只包含三个官方 HTTPS 接口及模型名称。普通用户首次使用 AI 时，在「设置 → AI 服务」填一个 Agent Plan Key。大模型、语音识别与语音合成全部测试通过后即可保存。此后可在同一处替换 Key。大模型请求只发送一次，限额或鉴权错误会直接返回。

| 打包命令（在 `desktop/` 执行） | macOS ARM64 安装包 |
| --- | --- |
| `npm run package`（亦可用 `npm run package:private`） | `release-private/mac-arm64/open-fitness.app`，自动带上本机 Key |
| `npm run package:public` | `release/mac-arm64/open-fitness.app`，不含 Key |

自用打包从仓库根目录的 `.secrets/agent-plan.key` 读取单行 Key。整个目录由 Git 忽略。更换自用包的默认 Key 时，更新此文件再打包即可。缺少文件时，自用打包会提示文件路径。分发命令可在全新克隆中执行，跳过本机密钥文件。拿到自用包的人可以提取其中的 Key。

桌面端首次启动在资料目录生成 `services.json`。内测包会在官方默认配置缺少 Key 时导入随包凭据，已有个人 Key 优先。通过设置保存的 Key 和导入的测试 Key 使用本机 AES-256-GCM 加密，配置与配套的 `services.json.key` 权限均为 0600，不进入训练备份。旧配置中的公网 HTTP 端点、备用模型及独立语音 Key 会在升级时移除。原官方大模型的 Key 可以继续共用。

可用 `COACH_SERVICES_CONFIG=/绝对路径/services.json` 指定已有私有配置。显式覆盖不导入随包 Key。macOS 本机 Web 预览可沿用桌面配置，AI 设置的读写仅允许本机回环连接。

Web 服务默认只监听 `127.0.0.1`，语音接口检查同源请求；经反向代理使用时设置 `COACH_WEB_ORIGIN` 为实际页面来源。摄像头和麦克风需要 localhost 或 HTTPS 安全上下文及用户授权。

## 数据与兼容性

- 新安装的桌面资料目录为 `~/Library/Application Support/open-fitness/`。如果同级已有旧目录 `Viaim Coach/`，桌面与本机 Web 服务沿用它，保留训练记录、服务配置和已选音色。显式 `--user-data-dir` 仍可用于隔离验证。
- 桌面端：资料目录中的 `data.json`；控制与诊断日志为同目录的 `controls.jsonl`。0.3.35 数据格式为 v3；升级前按旧版本保存 `data.json.v2.backup`（从 v1 升级则为 v1），正常写入采用串行原子替换。
- Web：数据保存在当前来源的浏览器本机存储，桌面和 Web 通过完整 JSON 备份迁移。清除站点数据会删除浏览器记录。
- 计时记录使用 `timedRecords` / `timedCheckpoint`，与自动计数的 `records` 分开；完整 JSON 备份含两类记录，Strong / Hevy CSV 仍只交换原有自动计数与姿态计时记录。计时记录不含暂停和休息，不代表有效动作时长，自填次数不计入评分和个人纪录。
- 训练每 5 秒保存检查点。桌面正常关闭前归档当前组；意外中断后恢复为中断记录，不自动接续计数，最后约 5 秒可能缺失。
- 旧 `workout_log.json`、`coach_profile.db` 和可选 `references.json` 导入仍保留。SQLite 通过 JavaScript/WASM 读取，与是否安装 Python 无关。
- CSV 用于交换记录，不能保留完整评分、节奏和最近删除等内容；完整恢复使用 JSON。最近删除可恢复，永久删除前的旧备份仍可能包含内容。

## 打包与交付

在 macOS 上执行：

```sh
npm test
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:public
```

当前包包含仅供内部参考的第三方演示。交付前请按 [素材许可清单](../ASSET-LICENSES.md) 核对拟分发的内容。

分发命令会更新 `release/mac-arm64/`。完成内测签名、检查包内版本与构建时间后，生成本次分发的 ZIP：

```sh
mkdir -p release/share
ditto -c -k --sequesterRsrc --keepParent "release/mac-arm64/open-fitness.app" "release/share/open-fitness-trial.zip"
cd release/share
shasum -a 256 open-fitness-trial.zip > open-fitness-trial.zip.sha256
```

实际交付时将 `trial` 换为版本与日期，避免覆盖既有发布。分发包需检查 ZIP 完整性、解压内容与 `.app` 一致，再做真实设备检查；build 成功不代表现场验收。当前未做 Developer ID 签名或 Apple 公证。

版本号取自 `package.json` 的 `version`，发布时同步 `package-lock.json`。设置页显示当前版本号、构建时间、运行模式与使用许可。日常清理不提升版本，也不把旧 ZIP 视为包含新源码。

### 内测临时签名与画面远近

0.3.9 的“画面远近”提供 1.0–2.0 倍显示缩放。1.0 倍完整显示输入画面，窗口比例不同时会留边；视频和骨架同步缩放，识别仍使用原始完整帧，不控制硬件镜头。关闭或切换摄像头会复位。

无需证书的内测构建可在打包后执行 `npm run sign:internal -- "release/mac-arm64/open-fitness.app"`，也可指定其他输出路径。该命令从内到外进行临时签名并严格验证，未公证版本仍可能需要首次手动放行。重新打包后必须再次签名。
