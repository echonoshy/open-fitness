# 验证清单与已知限制

自动化回归核对固定输入下的行为。计数准确度、远场收音、扬声器打断效果和安装包内的视频播放，需要在目标 Mac 上另行验证。

## 日常自动化检查

在 `desktop/` 执行 `npm test`、`npm run build`。测试覆盖：

| 范围 | 测试文件 |
| --- | --- |
| 计数状态机、训练流程、算法基线 | `engine.test.ts`、`training-data.test.ts`、`fixtures/` |
| 图像坐标、侧面深蹲准备、短丢点恢复和长中断 | `pose-coordinates.test.ts`、`pose-recovery.test.ts`、`training-feedback.test.ts` |
| 教练工具执行、反馈、历史查询、语音快捷指令 | `coach.test.ts`、`coach-experience.test.ts`、`voice-latency.test.ts` |
| 模型意图、真实进度、最终回答和播放取消 | `turn-feedback.test.ts`、`voice-latency.test.ts` |
| 主动提醒频率、过期、事实校验、生成取消 | `interaction.test.ts` |
| 打断、取消、音色、PCM 流和输出设备 | `barge-in.test.ts`、`streaming.test.ts`、`voices.test.ts`、`output-device.test.ts` |
| 数据修改、参考动作、备份恢复及旧 SQLite 导入 | `data-edits.test.ts`、`references.test.ts`、`web-and-recovery.test.ts` |
| 服务配置、AI 设置、在线语音与同源 Web API | `service-config.test.ts`、`ai-services.test.ts`、`agent-plan-speech.test.ts`、`web-api.test.ts` |
| 动作库搜索、训练计划、计时训练与备份 | `movement-library.test.ts`、`catalog-plan.test.ts`、`timed-training.test.ts`、`backup-checkpoint.test.ts` |
| 动作统计、手动修正与记录展示 | `movement-statistics.test.ts`、`catalog-history.test.ts` |
| 多角度俯卧撑与站位恢复 | `pushup-multiview.test.ts`、`pose-recovery.test.ts` |

算法对照使用固定 JSON 样本，不需要 Python。旧数据导入是现有用户功能，保留相关回归。实际收音使用 Silero 和 `SpeechTurnDetector`。

可选维护验证：`npm run verify:vad` 使用随包 Silero 与合成语音样本；`npm run verify:services` 调用真实语音服务，以合成话语和内存状态验证。结果生成到 `desktop/output/`，不读取真实训练记录。这两项都不能替代真实摄像头和扬声器双讲检查。

## 试用检查清单

- [ ] 侧身站位通过检查，连续三次深蹲每次回位只增加一次。
- [ ] 正面站位提示转身；短遮挡后合理恢复，离开画面再返回不补计半次动作。
- [ ] 完成包含多个动作、组间休息的训练计划，历史记录与实际组数一致。
- [ ] 在安装包内打开一个基础动作和一个已安装的可选动作，分别从动作库与训练界面播放演示，检查时间推进、循环和声音状态。
- [ ] 用一个估算计数动作完成一组、手动修正次数并保存，在历史详情与 JSON 备份中核对估算值、手填值和有效训练时长。
- [ ] 在实际训练距离打断扬声器播报，新指令识别和执行正确；不说话时不会持续自我打断。
- [ ] 摄像头与麦克风重开、设备拔插、网络失败有明确反馈，历史和资料仍可保存。
- [ ] JSON 导出后在隔离资料环境恢复，训练记录、计划、资料和参考动作正确。
- [ ] 新发布包在目标 Mac 上解压、启动、授权并完成上述关键流程。

## 当前限制

深蹲视角检查来自骨架比例启发式；镜头俯仰、宽松衣服和遮挡仍会影响结果。训练时请按当前动作提示取景。

动作库的众多动作通过演示数据标定估算或计时。规则覆盖数量不能代表真人计数准确率，各动作需结合机位、遮挡、动作幅度和人工计数核验。

平板支撑的姿态计时依赖关键点与站位检查，地面接触和遮挡需在实际环境中核对。弓步交替腿、引体下巴过杆、硬拉背部形态等也未获得独立完整测量验证。

参考相似度比较角度轨迹，不证明姿势正确；速度下降是角速度趋势；估算 1RM 不是最大力量实测。远场、噪声、旁人说话和长时间双讲效果仍需反馈。分发前应针对实际交付包检查签名、解压和首次启动。
