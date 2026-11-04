# 教练音色

在「设置 → 教练声音」点击「试听」，再点「选用」。初次使用默认为「女声 1 · 清透自然」。训练播报与在线回答使用所选声音，动作示范讲解使用预录音频。

## 在线音色与离线素材的对应关系

Agent Plan 使用服务商预设音色。应用保留原来的选择 ID，以便沿用用户已保存的设置，并找到对应的预录动作讲解。

| 界面名称 | Agent Plan 预设 | 历史素材编号 |
| --- | --- | --- |
| 男声 1 · 温润细致 | 温柔小哥 | N6 |
| 男声 2 · 清楚直接 | 阳光青年 | P4 |
| 男声 3 · 沉着低音 | 高冷沉稳 | P5 |
| 男声 4 · 成熟坦然 | 儒雅青年 | P8 |
| 女声 1 · 清透自然 | Vivi | W01 |
| 女声 2 · 轻松随和 | 小何 | W04 |
| 女声 3 · 活力自然 | 爽快思思 | W13 |
| 女声 4 · 清透温和 | 温柔小雅 | W18 |

在线预设的名称与服务标识以[音色配置](../desktop/src/core/voices.ts)为准。启用在线语音需要在「设置 → AI 服务」测试并保存 Agent Plan Key。配置保存在本机，完整训练备份不含 Key。

## 维护与验证

- 在 `desktop/` 运行 `npm test` 可核对音色映射。运行 `npm run narration:check` 可核对各动作的预录讲解。实际试听时，在应用内选定输出设备，分别播放试听和动作讲解。
- 动作讲解保存在 `desktop/public/exercise-narration/`，录音摘要见[讲解清单](../desktop/public/exercise-narration/manifest.json)。这些历史合成录音与当前在线音色可能听起来不同。
- `npm run verify:vad` 使用[W01 历史合成语音样本](../desktop/tests/fixtures/vad/w01-speech.wav)检查语音打断检测。该文件来自 `mandarin-female-v5` 批次，只用于测试。音频使用范围见[素材许可与署名](../ASSET-LICENSES.md)。
