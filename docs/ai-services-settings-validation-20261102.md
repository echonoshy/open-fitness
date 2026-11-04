# AI 服务设置验证 · 2026-11-02

交付版本：0.3.33。桌面应用位于 `/Users/lake/Desktop/viaim Coach 0.3.33 AI 服务/viaim Coach.app`。

## 功能

- 设置新增「AI 服务」。大模型 Key 为默认共用 Key，ASR、TTS 分别可关闭共用并填写独立 Key；留空保留原有配置。
- 使用 Agent Plan 专用地址与豆包语音 2.0。沿用当前 Agent Plan 大模型名称，保留 `llmFallback` 及其 Key，不提供跨厂商配置表单。
- 草稿测试不修改运行中配置。分别实际请求 LLM、ASR、TTS，全部成功才签发有效期 5 分钟的保存凭证。LLM 测试不走备用服务。
- 修改表单立即清除前次测试结果。服务端凭证保存的是已测试配置，拒绝伪造、过期、重复使用或配置版本过时的保存请求。
- 读写配置比较版本、使用短文件锁及原子替换；保存失败保留旧配置。保存回调取消当前回复、清空固定语音缓存，后续请求读取新配置。单次 TTS 的所有分段保持同一配置快照。
- 训练数据与服务凭据分别保存。已有 Key 只展示末四位；不返回完整 Key、不存浏览器 localStorage、不进入训练备份。

## 验证结果

1. `npm test`：458 项通过、0 失败。新增覆盖共用/独立 Key、原值保留、切回共用、失败与伪造凭证、过期、并发修改、写入失败、加密篡改、语音分段一致性和本机 Web 访问限制。
2. `npm run build`：类型检查、资源校验、前后端构建通过。生成 macOS arm64 包，内测签名验证通过；桌面安装包后端内容与当前构建一致。
3. 真实 Agent Plan 共用 Key 测试：LLM 776ms、ASR 748ms、TTS 540ms，三项成功。独立字段测试分别为 670ms、656ms、593ms。
4. 无效测试 Key：三项均返回鉴权失败，无保存凭证，原配置内容保持一致。
5. 保存后的真实 TTS → ASR → LLM 链路：生成 86,776 字节 WAV，识别为「今天先练12次深蹲。」，LLM 返回 completed。
6. 本地 Web 界面：保存初始禁用；错误 Key 后仍禁用；独立 ASR 留空提示填写；成功测试后启用保存；修改 Key 后保存重新禁用。恢复当前共用配置，测试后点击保存，界面显示「已保存并生效」。
7. 桌面 0.3.33：实际启动并进入 AI 服务设置，三项真实测试通过。用户正在操作桌面窗口，后续保存检查在独立预览窗口完成，没有强制重启用户窗口。
8. 保存后启动新的正式构建后端进程：成功解密读取配置，LLM 734ms、ASR 622ms、TTS 536ms；再次合成并识别「服务设置已经生效。」。这验证了新进程重载，不等同于保存后手动重启整个桌面应用。
9. 保存前后 `data.json` SHA-256 一致。当前保留 LLM/ASR/TTS 共用原有效 Key，原备用模型配置保持不变。

独立字段的真实正向测试使用同一把已授权有效 Key，三把不同 Key 的路由与保留逻辑用隔离测试覆盖；没有宣称持有三个不同有效账户。ASR 连通性测试发送短静音，另外使用合成语音完成真实识别链路。本次没有开展新一轮物理麦克风、扬声器、摄像头验收。

## 本机凭据保护范围

新保存的 Key 使用 AES-256-GCM 加密，配置与配套 `services.json.key` 为 0600 权限。配套文件保存加密材料，兼容 Electron 和本机 Node Web 预览。它不是系统钥匙串，不能隔离已拥有同一系统账户文件权限的进程。旧配置可读取，首次从设置保存后写入加密格式；旧版本应用无法读取该格式，需使用 0.3.33 及更新版本。既有历史私有备份未被删除或改写。

## 证据

- `desktop/output/ai-service-settings/unit-tests.log`
- `desktop/output/ai-service-settings/focused-tests.log`
- `desktop/output/ai-service-settings/live-verification.json`
- `desktop/output/ai-service-settings/restart-verification.json`
- `desktop/output/ai-service-settings/package-verification.json`
- `desktop/output/ai-service-settings/build.log`、`package.log`、`sign.log`
- `desktop/output/ai-service-settings/settings-saved.png`
- 可重复的服务验证脚本：`desktop/scripts/verify-ai-settings.ts`，通过 `COACH_SERVICES_CONFIG` 指向私有配置；使用临时副本测试，不修改原配置。
