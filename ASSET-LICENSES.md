# open-fitness 素材许可与来源

代码的非商用许可见 [LICENSE](LICENSE)。素材按下面的清单分别授权。未列明授权的内容，请向原权利人取得许可后再使用或分发。

## 项目原创素材 · 署名、非商业性使用

本版原创应用图标（`desktop/assets/branding/icon.svg` 及其导出的 PNG、ICNS）和项目自行撰写的使用说明（`README.md`、`docs/trial-guide.md` 中的原创文字）采用 **CC BY-NC 4.0 国际许可**。可以在非商业用途下复制、分享、改编，须保留署名、附上许可证链接并注明改动。商业使用须另获权利人授权。

署名示例：open-fitness contributors，《open-fitness 应用图标》，CC BY-NC 4.0；若改编，请补充修改说明。作品来源 https://github.com/echonoshy/open-fitness ，许可 https://creativecommons.org/licenses/by-nc/4.0/ 。[完整条文](docs/licenses/CC-BY-NC-4.0.txt)

## MoveKit · 动作演示、封面和衍生资料

MoveKit 动画、预览、截图、增强视频和封面属于原权利人。项目现有资料未提供覆盖正式分发的授权凭证，所存副本仅作内部参考。复制、增强、截帧和翻译均不产生原内容的再授权。请勿以项目许可提取、转载、公开分发或商用这些内容。免费样例也须遵循其原始使用条件。

范围包括 `desktop/public/movekit-library/hd/` 的最终 720p 演示及封面（训练小窗共用其中九组），以及 `data/movekit-library*.json` 中源自 MoveKit 的目录和动作说明。来源与处理记录见 [动作库来源](docs/movekit-library-2026-11-02.md) 、[现用 720p 成片校验清单](desktop/public/movekit-library/hd/manifest.json) 和 [旧版九组参考来源记录](desktop/public/exercise-reference/provenance.json)。权利人条款 https://movekit.com/license 。

## 动作文字与训练知识

- `data/exercises.json` 的英文动作数据来自 yuhonas/free-exercise-db，按上游 Unlicense 公共领域声明使用。保留其原有权利，包括商业使用。来源 https://github.com/yuhonas/free-exercise-db 。[上游许可原文](docs/licenses/free-exercise-db-Unlicense.txt)
- `data/exercises.zh-CN.json` 是项目对上述英文数据的中文翻译。其中项目享有权利的原创翻译表达适用 CC BY-NC 4.0；原文和动作本身的权利状态独立。
- `data/knowledge/` 的原始训练笔记、基线对照数据和源自 AI Gym Coach 的实现，来源为 Feki-Tech/ai-gym-coach。在固定基线中未找到明确的再分发许可，本项目不对这些部分作再授权。详见 [项目来源](docs/sources.md)。

## 语音、模型、图标库与运行时

- 八款历史合成音色的参考母带、试听和预录讲解位于 `desktop/assets/voices/`、`desktop/public/voices/`、`desktop/public/exercise-narration/`。现有记录可核对来源及生成过程，未确认独立再分发音频或克隆音色的授权。火山引擎在线音色受提供方服务条款约束。详见 [音色来源](docs/voices.md)。
- MediaPipe Pose Landmarker 模型、Silero VAD 模型和相关 WASM 文件分别遵循其上游条款。MediaPipe、ONNX Runtime、sql.js、Lucide 图标及其他依赖保留各自的许可、版权和署名。项目自有图标的 CC 许可仅涉及上文明确列出的图标。
- 历史 Fitness Trainer 原型保留其 [MIT 许可及版权声明](docs/licenses/fitness-trainer-MIT.txt)。

## 用户资料

摄像头画面、上传的视频、个人参考动作、训练记录和服务凭据由用户控制，不属于项目可授权的素材。
