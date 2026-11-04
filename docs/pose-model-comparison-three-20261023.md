# MediaPipe Lite / Full / Heavy 三模型实测

测试日期：2026-10-23。应用基准：viaim Coach 0.3.7。此报告补充 Lite，并将 Full、Heavy 在同一轮环境中重新测试，便于横向比较。

后续版本状态：按用户决定，0.3.8 已统一使用 Full，不提供模型选择。以下保留 0.3.7 测试时的结果与建议，文中“保留 Heavy”指测试当时的配置。

当前设备和样本下，Full 是较均衡的后续候选：实时速度接近 Lite，俯卧撑计数比 Lite 完整；Heavy 明显更慢，本轮没有证据证明其整体训练效果更好。三个模型均未通过深蹲视频的准备检查，因此本轮不直接更改应用默认模型，也不将任一模型视为已完成真人训练验收。

## 方法与条件

- Apple M4、16 GiB 内存、macOS 27.0.1；Electron 45.0.0；MediaPipe Tasks Vision 1.1.1。
- 三者均为官方 float16/1 模型；使用 0.3.7 发布包内同一份 Worker、同一份 WASM、CPU delegate、VIDEO 模式、单人，三个置信度阈值均为 0.5。只更换权重路径。
- 计数、平滑、角度、准备检查和恢复逻辑完全相同。核对过相关源码，与前一轮 Heavy / Full 测试未发生变化；沿用同一份已编译测试模块。
- 独立 Electron 测试窗口和用户目录，不修改生产包。默认模型仍为 Heavy。
- 固定视频：相同深蹲和俯卧撑素材，统一 1280×720、15 fps，分别为 111、127 帧。每个模型各跑两遍，共 476 帧；同一帧依次送入三模型，每帧轮换先后顺序。每段视频重新创建 Worker。
- 两遍固定视频结果的全部关键点逐项一致。Full、Heavy 的关键点也与上一轮双模型测试相同。每个模型在两个视频中均为 100% 检测到 33 点，且动作所需关节全部通过现有可见性检查。可见性不是定位准确率。
- 静态图：每个模型 3 轮，每轮 40 帧；摄像头：Lite → Full → Heavy → Heavy → Full → Lite，各轮 60 帧，只有正在测试的模型运行。
- 推理耗时排除每个模型每轮前 5 帧；摄像头有效 FPS 包含每轮完整 60 帧和首帧推理，采用与应用相同的帧回调、忙时跳帧方式。
- 固定视频是离线按源时间戳逐帧处理，未按实时运行速度跳帧。它比较相同输入下的模型和计数输出，不能代替实时真人训练。

## 性能对比

| 指标 | Lite | Full | Heavy |
| --- | ---: | ---: | ---: |
| 模型大小，十进制 MB | 5.78 | 9.40 | 30.66 |
| 动作视频平均单帧推理 | 13.23 ms | 19.74 ms | 71.91 ms |
| 动作视频 P95 单帧推理 | 15.90 ms | 22.70 ms | 73.60 ms |
| 摄像头平均单帧推理 | 15.10 ms | 21.47 ms | 73.53 ms |
| 摄像头合并两轮有效 FPS | 26.71 | 24.27 | 10.64 |
| 摄像头各轮 FPS | 26.08 / 27.38 | 24.21 / 24.34 | 10.63 / 10.64 |
| 固定静态图膝角标准差，每轮结果相同 | 1.53° | 0.47° | 1.03° |

Full 的动态推理耗时约为 Lite 的 1.49 倍、Heavy 的 27%。在当前 30 FPS 摄像头采集条件下，Lite 的实际处理速度比 Full 高约 10%，Full 比 Heavy 高约 128%。摄像头传输、帧回调和图像转交也占用时间，实际 FPS 不能用推理耗时的倒数替代。

静态膝角标准差只衡量同一张不动图片的输出波动，不能外推为运动、遮挡或复杂机位的总体稳定性。该图片上 Full 的波动最小；这也说明模型更大不保证所有场景都更稳定。

摄像头为 `viaim Connect Camera (2207:0017)`，1280×720、30 FPS。三模型各 120 帧均检测到 33 点，但均无帧通过完整深蹲所需关节检查，现场未形成完整入镜的全身动作。这部分只支持速度和运行稳定性结论，没有验收真人动作计数。摄像头图像和人体坐标未保存，测试结束后媒体流与测试进程均已关闭。

## 计数、角度和反馈

两个公开视频经逐帧概览确认，各包含 4 次完整动作；俯卧撑是脚放在健身球上的变式。无人工标注的真实三维关节角度，以下结果不等于通用模型准确率。

| 相同应用规则的输出 | Lite | Full | Heavy |
| --- | ---: | ---: | ---: |
| 深蹲计数，视频 4 次 | 0 | 0 | 0 |
| 深蹲原始膝角最高值 | 149.0° | 157.0° | 178.4° |
| 俯卧撑计数，视频 4 次 | 2 | 4 | 4 |
| 俯卧撑已计数动作中被判幅度不足 | 0/2 | 1/4 | 4/4 |
| 已计数俯卧撑各次评分 | 100、100 | 80、100、100、100 | 70、80、80、80 |

三者对深蹲全程均选择右侧、俯卧撑均选择左侧，因此本轮角度差异不是选取身体不同侧造成的。

### Lite 的俯卧撑少计原因

Lite 的 2 次计数分别发生在第 38、67 帧。第 91–127 帧，即片段最后约 2.4 秒，平滑后的肘角最高仅约 153.87°，一直低于当前 155° 回位门槛；计数器持续处于 ASCENT 阶段，没有把后续动作确认为完成。此时动作所需关节均可见，因此不能用“检测到了关键点”来证明计数已正确。

Lite 已计入的两次得到 100 分，也不能解释为 Lite 更准确：它漏了两次动作。不同模型的成绩、幅度纠错不能脱离完整计数率单独比较。

### 三者深蹲均为 0 的原因

Lite 的原始膝角最高约 149°，Full 最高约 157°，均不满足当前 >165° 的站直准备条件。Heavy 可超过 165°，但该视频未满足连续 0.6 秒稳定站立检查，且另有 7 帧未通过侧身检查，最终同样没有进入可计数深蹲状态。

这反映了模型输出与当前角度、平滑及状态规则之间的适配问题。不能将所有失败都归结为模型规格，也不能根据此样本简单调低全局阈值后就认为问题解决。

![三模型在相同动作视频中的角度输出](../desktop/output/pose-model-comparison/three-models/angle-comparison.png)

绿线为 Lite，橙线为 Full，蓝线为 Heavy。图中是模型输出归一化图像 x/y/z 计算出的原始角度，虚线为当前回位阈值。实际计数和评分还经过平滑、准备及状态检查，图中某一帧越过虚线不等于已经计数。

## 当前选择建议

- **Lite**：模型最小、推理最快，适合优先降低计算开销的候选方向；本机相比 Full 仅增加约 2.4 FPS，本次俯卧撑却只计到 2/4 次。需要处理回位判定适配后再判断可用性。
- **Full**：本轮较均衡。约 24 FPS，俯卧撑计到 4/4 次，固定静态图波动较小；适合作为后续角度与计数适配的优先候选，尚未证明全动作和真人场景下更准确。
- **Heavy**：约 10.6 FPS，计算成本明显更高。本轮俯卧撑同样计到 4/4，但幅度反馈与 Full 不同，深蹲准备问题仍然存在；没有足够证据证明它在当前产品上值得这部分性能开销。

下一步应优先检查当前图像 x/y/z 角度计算与三个模型输出的适配、站立校准和回位判定，并以固定视频回归加真人侧身训练验收来决定默认模型。当前生产默认保留 Heavy，本轮仅扩充对照测试。

## 记录与复现

- [汇总 JSON](../desktop/output/pose-model-comparison/three-models/summary.json)
- [第一轮视频结果](../desktop/output/pose-model-comparison/three-models/clips.json)、[第二轮视频结果](../desktop/output/pose-model-comparison/three-models/clips-repeat.json)
- [计数评分回放](../desktop/output/pose-model-comparison/three-models/session-replay.json)、[静态图结果](../desktop/output/pose-model-comparison/three-models/static.json)、[摄像头汇总](../desktop/output/pose-model-comparison/three-models/camera.json)
- [测试环境](../desktop/output/pose-model-comparison/harness-three.cjs)、[模型初始化和逐帧测试](../desktop/output/pose-model-comparison/init-three.js)、[统计及绘图脚本](../desktop/output/pose-model-comparison/analyze-three.py)、[输入和脚本哈希](../desktop/output/pose-model-comparison/three-models/provenance.json)

在 desktop 目录执行 `uv run --with matplotlib python output/pose-model-comparison/analyze-three.py` 可重新汇总已保存结果及生成图表。output 目录为本机测试产物，不进入发布包。

Worker SHA-256：`cd547335bc10a04cf5dbacf05a7176f6c227b7d6dbf72bbbdfeeb2b848a917c7`。

| 权重 | SHA-256 |
| --- | --- |
| Lite | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Full | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| Heavy | `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` |

官方资料：[MediaPipe Pose Landmarker 与三档模型](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)。模型均来自官方 `pose_landmarker_{lite,full,heavy}/float16/1` 固定版本。

测试素材：[Ultralytics 深蹲视频](https://github.com/ultralytics/assets/releases/download/v0.0.0/squats.demo.video.mp4)、[Ultralytics 俯卧撑视频](https://github.com/ultralytics/assets/releases/download/v0.0.0/pushups.demo.video.mp4)、[MediaPipe 静态图片](https://storage.googleapis.com/mediapipe-assets/pose.jpg)。
