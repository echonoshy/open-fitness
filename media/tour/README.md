# 官网实机演示

31 秒的 Remotion 短片，取材于桌面端的一次「午间深蹲」训练。`public/` 中的四段实机录屏对应动作库、计划、计数和记录。时间轴和剪辑位于 [src/index.jsx](src/index.jsx)。

片头和计数使用同一段预录动作。重新制作片头时，从 [Polina Tankilevitch 的 Pexels 原片](https://www.pexels.com/video/young-woman-exercising-6525519/) 下载 1080 × 1920 的 MP4，在本目录准备三秒片段并打开预览。

```sh
ffmpeg -i squat-original.mp4 -ss 0.4 -t 3.15 -vf 'fps=24,scale=720:1280,setsar=1' -c:v libx264 -crf 18 -pix_fmt yuv420p -an public/squat.mp4
npm ci
npm run studio
```

`npm run render` 输出 1080p 无声成片到 `out/open-fitness-tour.mp4`。更新官网时同步替换视频、封面、[章节按钮](../../website/index.html)和[中文字幕](../../website/assets/tour.zh.vtt)。
