<h1>
  <img src="website/assets/app-icon.png" alt="" width="52" height="52" align="middle">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="desktop/assets/branding/navigation-wordmark.svg">
    <img src="website/assets/navigation-wordmark.svg" alt="open-fitness" width="192" align="middle">
  </picture>
</h1>

**简体中文** · [English](README.en.md) · [官网](https://echonoshy.github.io/open-fitness/) · [桌面版下载](https://echonoshy.github.io/open-fitness/#download)

open-fitness 是一款摄像头与语音健身教练。挑一个想练的动作，设好组数和目标。做深蹲时，应用会在你起身后计次。练完打开「记录」，就能看到每组做了多少，以及每次的动作反馈。

[![观看实机演示：午间深蹲](website/preview-media/open-fitness-tour.jpg)](https://echonoshy.github.io/open-fitness/#demo)

[观看「午间深蹲」实机演示](https://echonoshy.github.io/open-fitness/#demo) · 从选动作到保存一组训练，使用预录动作样本，静音可看。

## 开始训练

- **挑动作。** 在「动作库」按名称、肌群或器械查找。深蹲、俯卧撑等支持自动计次，平板支撑按保持时长记录。其他动作的统计方式见动作详情。
- **排计划。** 为每个动作设置组数、次数或时长、负重和休息时间。保存计划后，下次可以接着用。
- **和教练说话。** 在「设置 → AI 服务」连接自己的 Agent Plan Key，训练时可以问「深蹲时怎么呼吸」，也可以说「这组做十次」。基础训练和记录可直接使用。

摄像头画面和姿态分析留在本机。启用在线语音教练后，语音片段、对话及必要的训练上下文会发送给配置的服务。

## 文档

[使用指南与备份](docs/trial-guide.md) · [开发、运行与打包](desktop/README.md) · [测试范围](docs/validation.md) · [教练音色](docs/voices.md) · [官网演示工程](media/tour/README.md)

项目自有代码采用 PolyForm Noncommercial 许可，商业使用需要另获授权。第三方素材按各自条款使用。详见[代码许可](LICENSE)、[素材许可与署名](ASSET-LICENSES.md)和[项目来源](docs/sources.md)。
