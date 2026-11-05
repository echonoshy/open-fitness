# 官网功能演示

68 秒实机演示，分为姿态识别、动作库、训练计划、自动计次、动作参考、背景虚化、AI 语音教练、动作讲解和训练记录九章。[Remotion 时间轴](src/index.jsx)

`public/` 保存已裁切的无声录屏及配乐。动作库录屏展示卡片浏览、俯卧撑和杠铃卧推示范。00:32 的训练参考窗使用应用内同一套俯卧撑视频，展示打开、拖动和放大。配乐节选 Kevin MacLeod 的《EDM Detection Mode》，与画面一起导出。语音问答和动作讲解沿用此前的实机录制，问答文字按当时的识别和回复整理。训练使用的预录动作见[素材署名](../../ASSET-LICENSES.md)。

在本目录运行 `npm ci` 安装依赖。`npm run studio` 打开时间轴，`npm run render` 输出 `out/open-fitness-tour.mp4`。改动片长或章节时，同步更新[官网播放器](../../website/index.html)和[中文字幕](../../website/assets/tour.zh.vtt)。
