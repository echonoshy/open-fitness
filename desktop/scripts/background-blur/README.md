# 背景虚化隔离验证

复用当前应用的 MediaPipe Full 模型，验证人体分割、显示合成以及计数和取景的非回归。此目录不被训练应用导入，不更改应用版本，不写入正式训练数据。

从 `desktop/` 运行：

```sh
node scripts/verify-background-blur.mjs offline
node scripts/verify-background-blur.mjs realtime
node scripts/verify-background-blur.mjs camera
node scripts/verify-background-blur.mjs lifecycle
node scripts/verify-background-blur.mjs stability
node scripts/verify-background-blur.mjs record
node scripts/verify-background-blur.mjs interactive
node scripts/verify-background-blur.mjs integrated
node scripts/verify-background-blur-app.cjs
```

需要现有 `@mediapipe/tasks-vision`、Electron、esbuild、Playwright 安装，以及 `public/models` 和 `public/wasm` 中的模型资源。Playwright 可由 `PLAYWRIGHT_MODULE` 指向现有安装，也会查找本地 npm 缓存。不会自动安装依赖。固定素材复用 `output/pose-model-comparison/` 中的公开视频及已提取的 15 fps、720p 帧；缺失素材时须先恢复该素材，脚本不会下载替代素材。

背景虚化实验的结果写入 `desktop/output/background-blur-20261028/`，当前安装包的检查结果写入 `desktop/output/background-blur-app/`，每轮记录模型 SHA-256、生产源码和实验源码哈希。实验使用独立 Electron 用户目录，生产 Worker 从当前源码构建到实验输出目录。

## 三组对照

- baseline：编译接入前保留的 `baseline.worker.ts`，不开启分割。首次验证时直接编译生产源码，接入后保存为固定对照。
- mask：相同模型、CPU delegate、阈值、VIDEO 模式，开启分割并在同步回调内读取结果。
- blur：与 mask 相同，再用独立 WebGL2 上下文做降采样、双向高斯模糊和蒙版合成。

计数和取景直接调用生产 `SessionEngine`、`CameraFramer`、`processCameraPose`。识别输入始终是原始帧。实验 Worker 仅消费回调有效期内的蒙版，不跨帧缓存，也不持有借用的蒙版。

离线对照逐帧比对关键点全部字段、计数、角度、错误提示、准备状态、评分和取景状态；包含固定取景、微调放大、恢复自动取景和恢复全身命令。执行顺序轮换减少顺序偏差。

实时视频按相同的忙时跳帧策略运行 baseline/blur/blur/baseline；720p 为主测试规格。左右显示保持同帧，测量包含实验显示代码，不能当成正式应用的完整用户输入到屏幕延迟。处理耗时记录到显示提交，未测光子到屏幕延迟。录制会增加开销，因此录制数据不混入性能统计。

摄像头明确优先选择 viaim Connect，其次选择 MacBook 内置摄像头，不把连续互通设备当成训练测试设备。浏览器未提供设备名称时，会短暂打开默认视频流以解锁名称，枚举后立即关闭探测流；探测流不播放、不保存。摄像头测试只保存汇总和每帧时间、检测数量，不保存现场画面或人体坐标。没有合格真人动作时，不将该轮运行视为真人计数验收。

## 限制

- 当前原型把同帧合成放在姿态 Worker 内，虚化后的显示频率跟随姿态处理频率；这是需要在集成时评估的取舍。
- 开启分割与回传蒙版有额外开销，即使关键点数值完全一致也不能声称对性能无影响。
- 人体分割不保证保留健身球、哑铃、杠铃等器械；头发、脚部、遮挡和快速运动需实机观察。
- 首版未使用时间平滑，避免残留上一帧轮廓；无人时输出模糊底图。
- 渲染失败仍返回有效关键点；验证窗口显示原图作为降级并记录错误，下一帧重建效果上下文。正式隐私功能需另定降级行为。
- 用户确认效果后，正式应用已在 0.3.18 接入同一合成模块。`integrated` 验证正式 Worker 的开关连续性；`verify-background-blur-app.cjs` 用录制视频在真实安装包中验证开关、计数、固定取景、故障降级和设置持久化。
- 正式 Worker 在摄像头启动后持续输出蒙版，开关仅控制合成，避免通过重建模型来切换分割输出。这意味着关闭虚化仍有分割输出的计算开销。生产效果故障后需用户切换开关重试，不在每一帧反复重建图形上下文。
- 未完成声音并发压力、所有动作真人测试或长时间稳定性验收。用户已明确要求停止排查摄像头打开失败。
