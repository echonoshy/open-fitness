# 项目来源

代码、原创图标与文字、第三方视频和模型分别适用各自的许可。完整说明见[素材许可与署名](../ASSET-LICENSES.md)。

## 训练算法与对照样本

训练算法和部分资料参考了 Feki-Tech/ai-gym-coach 的提交 `6400cb23b1cf68be3d83f2eeadeab05984d6cfbe`。项目目前在 TypeScript 客户端运行训练逻辑。[上游状态对照样本](../desktop/tests/fixtures/upstream-parity.json)和[角度对照样本](../desktop/tests/fixtures/upstream-pose-angles.json)用于回归测试。真人训练的验证条件见[验证清单](validation.md)。

早期训练原型使用了 Fitness Trainer。仓库保留其 [MIT 许可与版权声明](licenses/fitness-trainer-MIT.txt)。

## 动作与知识资料

- [动作文字库](../data/exercises.json)来自 yuhonas/free-exercise-db，上游采用 [Unlicense](licenses/free-exercise-db-Unlicense.txt)。[中文翻译](../data/exercises.zh-CN.json)与原数据逐条对应。构建时会检查原文摘要与翻译覆盖情况。
- [训练知识原文](../data/knowledge/)用于教练资料检索，相关来源和使用范围列于素材许可清单。
- 在线教练音色、历史合成音色母带和预录讲解的对应关系见[教练音色](voices.md)。
