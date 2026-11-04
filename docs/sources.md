# 项目来源与历史

完整素材许可、署名与待授权内容见 [素材许可与来源](../ASSET-LICENSES.md)。

## AI Gym Coach 基线

本项目在保留自身提交历史的基础上，以 Feki-Tech/ai-gym-coach 提交 `6400cb23b1cf68be3d83f2eeadeab05984d6cfbe` 为算法与功能参考。机器可读来源保留在 [LOCAL_SOURCE.json](../LOCAL_SOURCE.json)，本仓库基线标签为 `baseline/ai-gym-coach-2026-10-21`。

目前产品代码位于 `desktop/`，使用 TypeScript；上游 Python 运行入口、账号/日历、移动端、Docker/Azure、传感器和训练分类器等内容不属于当前维护范围。移除这些说明不影响本项目历史提交。

保留的上游对照样本位于 `desktop/tests/fixtures/upstream-parity.json` 与 `upstream-pose-angles.json`，由 TypeScript 测试读取。它们用于检查固定输入下的状态和坐标行为，不代表真人动作准确率。

## 动作与知识资料

[exercises.json](../data/exercises.json) 包含 876 个动作，其内部元数据记录 free-exercise-db 来源与 `Unlicense (public domain)`；中文译文位于 `exercises.zh-CN.json`。构建检查原文 SHA-256、中文覆盖和步骤数量，生成 `desktop/public/knowledge.json`，无需手改生成文件。

`data/knowledge/` 保留本地训练知识原文。应用标示各知识项来源；资料内容与实时姿态测量属于不同能力。

## 更早的 Fitness Trainer 原型

早期 Python/Flask 原型来自本机已适配的 Fitness Trainer，原型版本节点为 `702dd29`。随后曾保存在 `legacy/fitness-trainer/`，现已退出活动目录。其原始 MIT 许可和版权声明单独保留于 [fitness-trainer-MIT.txt](licenses/fitness-trainer-MIT.txt)，该许可属于旧原型，不将它扩展声明为整个当前项目的许可。

## 查阅清理前内容

0.3.47 清理前的源码节点为 `fb1e8dd`。旧版验收报告和独立跟练原型可用 `git show fb1e8dd:<原文件路径>` 查阅。

更早的 Python 原型保存在 `bca3ee1`。无需切换或覆盖当前目录，可以只读查看旧文件：

```sh
git show bca3ee1:UPSTREAM_README.md
git show bca3ee1:docs/baseline.md
git show bca3ee1:docs/camera-fix-0.3.4-validation.md
git show bca3ee1:legacy/fitness-trainer/README.md
```

旧文档中的启动命令、环境、服务和验收状态只适用于当时版本。当前入口与运行方式以项目 README 和开发维护文档为准。viaim Connect 作为外设使用，应用运行在 Mac 上；用户记录不参与构建。
