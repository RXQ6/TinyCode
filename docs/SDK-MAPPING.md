# Pi SDK 适配映射（实现前记录）

版本固定 `@earendil-works/pi-coding-agent@0.84.2`。已读 Skill 的 pi-agent-sdk-usage.md 及 sdk-doc-session-runtime / model-auth / resource-loader / tools / events。实际签名以安装包 examples/sdk、docs/sdk.md、dist/core/*.d.ts 为准，检查结果记入 VERIFICATION.md。

## 选择：一个受控决策回合

本项目 Runtime 拥有工具执行循环。`ModelPort.decide` 创建隔离的内存 Pi AgentSession，关闭全部 SDK 工具，让 `session.prompt` 返回一个 JSON Decision；`decodeDecision` 用 Zod 验证后交给 Core。每次决策仅一个回合，完整且截断/脱敏的观察由本地 State 传入。这样 SDK 的内部循环不会绕过 Runtime 的工具预算，也不会在 Runtime 崩溃恢复时重复文件写入。

| Port/字段 | SDK 映射 | 本地边界 |
| --- | --- | --- |
| decide | createAgentSession + AgentSession.prompt(text) | prompt = task + observations + humanInputs + iteration |
| 工具 schema | 明确列出的 JSON 意图：list_files/read_file/edit_file/run_tests | 此版不启用 SDK 原生 tool calls，不调用 defineTool；Runtime 独占 ToolPort |
| tools allowlist | noTools: 'all' | 模型只能请求 JSON action；ToolPort 拒绝未知名称 |
| streaming | SDK prompt Promise 完成后读取 assistant message | 不暴露原始 SDK 事件；产品展示 model_requested/decision_made/tool_* |
| JSON 回应 | assistant.content 中 text 类型块 | decodeDecision 与离线策略共用；格式错误终止 runtime_error |
| 错误 | assistant.stopReason/errorMessage 或 prompt rejection | 401/403 → auth；429 → rate_limited；402/502/503/网络 → provider_unavailable；其他 runtime_error |
| 重试 | SDK retry 禁用 | Runtime 仅重试 rate_limited/timeout/provider_unavailable；绝不重试用户取消 |
| 取消 | signal → session.abort() | abortable 同时拒绝在途 Promise；finally 退订 abort、dispose |
| 使用量 | assistant.usage input/output/cost.total（如存在） | 跨 decide 累计；缺失时字段省略，不猜测成本 |
| 隔离 | SessionManager.inMemory + SettingsManager.inMemory | 不读取用户全局 extensions/skills、不写 SDK auth；Runtime 单独持久化 |
| 模型 | ModelRuntime.getModel(provider, model) | TINYCODE_PROVIDER / TINYCODE_MODEL + Provider 环境变量；密钥从不进入 State/trace |

## 代价与局限

每次决策新建内存 SDK session，不能享受 Pi 的长会话压缩/缓存。只支持返回 JSON 的模型；暂不支持图片、token 级文本流、原生 SDK tool-call transcript 或 MCP。golden tests 证明 fake 和生产 Pi codec 的语义一致，并不证明无凭据的在线 Provider 已运行。

工具是本地 WorkspaceTools：schema 在提示中公开、执行时重新检查参数；测试仅运行用户选定的 Node test files。测试进程属于可信项目代码，路径守卫不构成 OS 沙箱。生产环境密钥只传给 Pi，不继承给项目测试进程。

来源：Skill 内置引用、安装包类型与官方示例；桌面隔离模式另核对 [Electron 官方安全文档](https://www.electronjs.org/docs/latest/tutorial/security/)。
