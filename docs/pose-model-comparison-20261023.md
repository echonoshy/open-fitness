# MediaPipe Heavy 与 Full 本机实测

测试日期：2026-10-23。当前应用版本：0.3.7。

后续版本状态：0.3.8 已统一使用 Full，不提供模型选择；以下保留 0.3.7 测试时的配置与结论。

Full 已实际加载并完成固定视频、静态图和 viaim 摄像头测试。它在当前 CPU 推理方式下明显更快，但输出的关节角度与 Heavy 存在会影响准备检查、动作幅度和评分的差异。当前应用默认保留 Heavy；本轮没有改动生产模型配置、角度算法或计数阈值。

## 测试方法

- 机器：Apple M4、16 GiB 内存、macOS 27.0.1。
- 运行时：Electron 45.0.0，`@mediapipe/tasks-vision` 1.1.1，CPU delegate，VIDEO 模式，单人，三个置信度阈值均为 0.5。
- 从 0.3.7 发布包的 `app.asar` 直接读取同一份 `pose-worker.js`、WASM 和 Heavy 权重；Full 仅更换模型路径。Worker SHA-256：`cd547335bc10a04cf5dbacf05a7176f6c227b7d6dbf72bbbdfeeb2b848a917c7`。
- 测试在独立 Electron 窗口和用户目录中运行。其本地协议额外提供 Full 权重和测试素材，生产安装包没有被修改。计数使用当前源码编译的 `SessionEngine`，包含平滑、可见性、侧身准备和恢复检查。
- 固定视频统一到 1280×720、15 fps。深蹲 111 帧、俯卧撑 127 帧；每个模型完整运行两遍。两个模型对同一帧串行推理，逐帧交替先后顺序。每次视频重新创建 Worker。
- 两遍固定视频输出的全部关键点逐项相同。每个模型共处理 476 帧动态样本，两个视频的动作所需关节可见率均为 100%。这里的可见率是现有应用的坐标边界与 visibility > 0.5 检查，不代表定位准确率。
- 静态图每个模型运行 3 轮，每轮 40 帧。摄像头按 Heavy → Full → Full → Heavy 顺序测试，每轮 60 帧，只有正在测试的模型运行；帧回调与忙时跳帧方式与现有摄像头流程一致。
- 延迟统计统一剔除每个模型每轮的前 5 帧。摄像头有效处理 FPS 包含启动后的首帧和全部 60 帧，不能等同于 `1000 / 单帧推理耗时`。
- 固定视频按源时间戳离线逐帧处理，未因 Heavy 运行较慢跳帧。这用于比较相同输入下的模型输出，不能代替实时动作计数验收。

## 性能结果

| 指标 | Heavy | Full |
| --- | ---: | ---: |
| 权重大小，十进制 MB | 30.66 | 9.40 |
| 固定动作视频平均推理耗时 | 73.56 ms | 20.09 ms |
| 固定动作视频 P95 推理耗时 | 78.30 ms | 23.80 ms |
| 静态图平均推理耗时 | 73.78 ms | 19.70 ms |
| 摄像头平均推理耗时 | 73.20 ms | 20.67 ms |
| 摄像头有效处理 FPS，合并两轮 | 10.72 | 26.37 |
| 摄像头两轮 FPS | 10.58 / 10.86 | 25.47 / 27.33 |

Full 的动态推理耗时约为 Heavy 的 27%，即推理速度约 3.66 倍；本机摄像头实际处理帧率约 2.46 倍。摄像头为 `viaim Connect Camera (2207:0017)`，采集设置为 1280×720、30 fps。

摄像头测试时没有持续完整入镜的全身动作：Heavy 两轮分别有 10/60、0/60 帧通过深蹲所需关节检查，Full 均为 0/60。检测到 33 点的帧数分别为 Heavy 120/120、Full 119/120。现场画面会变化，因此这些数字不用于排名识别准确率。摄像头测试只支持性能与运行稳定性结论；没有保存摄像头图像或人体坐标，也没有确认真人完成动作计数。测试结束后已停止媒体流并退出测试进程。

## 动作识别和现有规则的差异

公开视频经逐帧概览检查，各含 4 次完整动作；俯卧撑素材为双脚放在健身球上的变式。没有人工标注的真实三维关节角度。

| 现有训练逻辑输出 | Heavy | Full |
| --- | ---: | ---: |
| 深蹲视频计数 | 0 | 0 |
| 深蹲原始膝角范围 | 77.1°–178.4° | 55.8°–157.0° |
| 俯卧撑视频计数 | 4 | 4 |
| 俯卧撑被判幅度不足的次数 | 4/4 | 1/4 |
| 俯卧撑各次评分 | 70、80、80、80 | 80、100、100、100 |

深蹲计数为 0 发生在准备检查阶段，不能解释为没有检测到人。两个模型逐帧均能识别该动作所需关节，且均选择身体右侧。Full 的原始膝角整段最高只有约 157°，始终不满足当前 >165° 的站直要求。Heavy 虽能超过该阈值，但没有完成连续 0.6 秒的稳定站立准备检查，且另有 7 帧未通过侧身检查。开头第 9→10 帧的膝角从约 170.6° 变为 165.4°，超过准备检查允许的单帧 5° 变化，会重置稳定时间。两者都没有进入这段视频的可计数深蹲状态。

俯卧撑两个模型均选择身体左侧，次数相同，但平滑后的最低肘角不同，导致幅度纠错和评分明显变化。例如第 2 次最低肘角 Heavy 约 99.8°、Full 约 87.9°，当前充分幅度阈值为 95°。这说明“次数相同”不等于教练反馈相同，也不能据此把分数更高的模型判为更准确。

![相同视频输入下的关节角度曲线](../desktop/output/pose-model-comparison/angle-comparison.png)

图中曲线为当前 `angle()` 对模型输出的归一化图像 x/y/z 坐标计算得到的原始角度。实际计数和评分还会经过平滑与状态检查，因此不能直接用曲线最低点替代每次动作的评分角度。

## 深度坐标与静态抖动

深蹲视频第一帧，同一侧髋、膝、踝得到：

| 角度计算方式 | Heavy | Full |
| --- | ---: | ---: |
| 当前应用的图像 x/y/z 计算 | 168.4° | 154.3° |
| 仅为诊断计算的画面二维角度，x 按 16:9 修正 | 179.4° | 177.0° |

二维画面中的腿都接近伸直，加入模型的深度预测并使用当前三维计算方式后，差异明显放大。该诊断同时改变了是否使用 z 和横纵坐标尺度，不能把全部差值单独归因于 z，更不能证明二维算法在所有机位下更准确。生产角度计算没有在本轮修改。

相同静态图片重复输入、每轮去掉前 5 帧后，膝角标准差 Heavy 约 1.03°、Full 约 0.47°，三轮结果一致。该指标只说明这一张固定图片上的输出波动，不能外推为真人运动、遮挡或复杂机位下的稳定性排名。

## 决策与后续验证

Full 的速度更适合当前本机实时交互，但目前不宜仅替换权重就沿用所有动作判定。应先核查模型深度输出与当前角度计算的适配，验证站立校准、动作幅度、回位阈值和评分，再判断是否将 Full 设为默认。

当前 Heavy 默认配置保持不变。本轮也没有证明 Heavy 已解决深蹲准备或计数问题。验收仍需覆盖侧身站稳 → 下蹲 → 站起的完整真人流程，以及至少多个机位、人物、光照和短暂遮挡场景。

## 原始记录和复现材料

- [汇总数据](../desktop/output/pose-model-comparison/summary.json)
- [第一遍固定视频结果](../desktop/output/pose-model-comparison/clips.json)、[第二遍结果](../desktop/output/pose-model-comparison/clips-repeat.json)
- [计数与评分回放结果](../desktop/output/pose-model-comparison/session-replay.json)
- [静态图结果](../desktop/output/pose-model-comparison/static.json)、[摄像头聚合记录](../desktop/output/pose-model-comparison/camera.json)
- [测试环境入口](../desktop/output/pose-model-comparison/harness.cjs)、[推理初始化及分批处理](../desktop/output/pose-model-comparison/init.js)、[分析与绘图](../desktop/output/pose-model-comparison/analyze.py)、[源码及素材哈希](../desktop/output/pose-model-comparison/provenance.json)

上述 output 目录为本机测试产物，不进入发布包。测试素材提取命令为 `ffmpeg -i <video> -vf 'fps=15,scale=1280:720' -q:v 2 <frames>/%04d.jpg`；分析命令为在 desktop 目录运行 `uv run --with matplotlib python output/pose-model-comparison/analyze.py`。

模型使用官方固定版本 float16/1：[Heavy 权重](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task)、[Full 权重](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task)。SHA-256 分别为 `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` 与 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`。

固定视频来自 Ultralytics 官方示例资产：[深蹲](https://github.com/ultralytics/assets/releases/download/v0.0.0/squats.demo.video.mp4)、[俯卧撑](https://github.com/ultralytics/assets/releases/download/v0.0.0/pushups.demo.video.mp4)。静态图来自 [MediaPipe 官方 pose.jpg](https://storage.googleapis.com/mediapipe-assets/pose.jpg)。这些素材用于本地技术测试，不作为通用准确率基准。
