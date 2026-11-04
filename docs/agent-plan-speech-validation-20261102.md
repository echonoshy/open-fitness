# Agent Plan 语音接入验证 · 2026-11-02

## 配置与行为

- 当前桌面应用的主 LLM 已使用 Agent Plan；其配置与备用 LLM 保持不变。
- ASR 改为 `doubao-seed-asr-2.0`，资源 ID 为 `volc.seedasr.sauc.duration`，使用 `wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_nostream`。沿用应用的语音判停，提交完整句子后获取最终识别结果。
- TTS 改为 `doubao-seed-tts-2.0`，资源 ID 为 `seed-tts-2.0`，使用 `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`。逐行解析 JSON 音频片段并立即播放 PCM，非流式调用则组装完整 WAV。
- 私有配置中的 ASR/TTS 均设为 `provider: "agent-plan"`、`apiKeyFrom: "llm"`。沿用已有 Key，不在源码、报告或浏览器内暴露凭据。
- 八个声音选择映射到八个官方 TTS 2.0 音色；保持当前选中的男声 1。设置页试听调用在线合成，动作讲解预录音频继续保留。
- 原服务配置在本机以 `services.before-agent-plan-speech-20261102-174759.json` 备份。当前 ASR/TTS 没有自动回退到自部署服务。
- 本机 Web 预览默认读取与桌面应用相同的私有配置；部署时仍支持 `COACH_SERVICES_CONFIG` 显式覆盖。

## 真实接口验证

首次请求时，主 Key 的 ASR/TTS 均返回 `Forbidden.AgentPlanDeductNotEnabled`，备用 Key 的 ASR/TTS 均返回 `AuthenticationError`。用户开启套餐抵扣后，使用原主 Key 重新验证成功。没有开启超额后付费或使用去掉 `/plan/` 的按量计费接口。

| 验证 | 结果 |
| --- | --- |
| 八个音色实际流式合成 | 全部成功，单次首音频 365～687 ms |
| “换成向上推举，这组做十二次” | ASR 返回“换成向上推举，这组做12次。”；真实 LLM 工具执行后切换肩上推举、目标 12 次；回复成功合成 |
| “开始休息一分钟” | ASR 正确识别；真实 LLM 工具执行后进入 60 秒休息；回复成功合成 |
| 两条完整链路中的 ASR 耗时 | 1128 ms、867 ms，不包含录音和判停时间 |
| 首段音频到达后取消 TTS | 仅交付一个音频片段，请求按 AbortError 结束，无后续音频或重复请求 |
| LLM / ASR / TTS 诊断 | 全部通过；修复原有对 Plan `/models` 请求导致的 404 误报，改用真实响应接口 |
| 构建后的 Web 后端 | 正常启动；真实 ASR 返回正确文字，TTS 返回 9 个 PCM 音频片段并正常结束 |

可复测脚本：

```sh
cd desktop
COACH_SERVICES_CONFIG="$HOME/Library/Application Support/viaim Coach/services.json" npx tsx scripts/verify-agent-plan-speech.ts
```

详细结果与生成音频位于本机 `desktop/output/agent-plan-voice/`，包括 `verification.json`、`web-verification.json`、八个声音样本、两条教练回复。该目录不提交到仓库。

## 回归、构建与安装包

- 新增 12 项语音协议测试，覆盖凭据引用、八个音色映射、跨网络分片的 JSON、PCM16 对齐、缺失结束标记、HTTP 200 内的业务错误、取消、错误后的重试边界、ASR 二进制协议、最终结果与提前断开。
- 全量 439 项自动测试通过；诊断修正后 18 项服务专项重新通过；Web 配置调整后 2 项 Web 专项重新通过。
- TypeScript 检查、生产构建、72 条既有预录讲解校验通过。修复新增 WebSocket 依赖在独立 ESM Web 后端构建中的加载问题，并实际启动该构建验证。
- ARM64 安装包已构建并通过临时签名与深度签名校验。包内主进程与本次构建产物哈希一致。
- 交付位置：`~/Desktop/viaim Coach 0.3.32 Agent Plan/viaim Coach.app`。
- 新安装包已启动；在设置页点击当前男声 1 的在线试听，界面完整进入“试听结束”。应用实际日志记录 TTS 成功，首音频 618 ms、合成请求共 4537 ms。输出设备显示为 AirPods，未更改已有设备或声音选择。

## 验证边界

完整语音链路使用合成测试音频，不是用户对物理麦克风说话的现场验收。已确认应用调起在线合成、播放流程正常结束；尚未由用户确认耳机实际听感，也未完成真实房间的回声、双讲打断、摄像头计次和保存训练验收。此次未修改判停、训练动作计数或模型多轮工具执行逻辑。

官方协议来源：[Agent Plan 接入语音模型](https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model?lang=zh)、[TTS HTTP Chunked 协议](https://docs.volcengine.com/docs/6561/1598757?lang=zh)、[官方音色列表](https://www.volcengine.com/docs/6561/1257544?lang=zh)。
