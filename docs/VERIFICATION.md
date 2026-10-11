# 验证记录与交付边界

日期：2026-10-10（Asia/Shanghai）。环境：Windows，Node.js 24.15.0，Pi SDK 0.84.2，Electron 41.10.7。依赖由 package-lock.json 锁定。用户明确选择先完成离线验证，真实模型配置稍后提供。

## 已运行的证据

| 命令 | 结果 | 验证内容 |
| --- | --- | --- |
| npm run test:core | 13 通过 | 纯 Core 完成语义、文件实际读写、路径/链接守卫、未知工具、取消 |
| npm run test:runtime | 通过 | 生命周期、隔离、工具失败、预算、重试、取消、消费者关闭、恢复、脱敏、暂停 |
| npm run demo | 退出码 0 | 实际读取和两次修改，测试先 1 后 0；artifacts/demo-run.json |
| npm run eval | 5/5 通过 | 五个独立工作目录，实际测试全部 1 → 0；artifacts/evaluation.json |
| node --import tsx scripts/sdk-smoke.ts | 退出码 0 | 真实 SDK 导入、ModelRuntime、loader.reload、内存 Session、禁用工具、abort/dispose；未调用在线模型 |
| npm run typecheck | 退出码 0 | strict TypeScript，源码、脚本、测试与 UI |
| npm test | 通过 | Core、Tools、Runtime、codec、真实 SDK 组装、golden 回放、桌面服务边界 |
| npm run build | 退出码 0 | main ESM、sandbox preload CJS、React renderer |
| npm run test:e2e | 3/3 通过 | 实际 Electron 修复闭环、重启日志、partial 和取消进程 |
| npm run agent -- --help | 退出码 0 | CLI 可启动、显示使用方式 |

最终精确计数在 artifacts/verification.json 中记录。golden 数据来自实际工具执行，不是手写事件；回放容忍输入重复并排序，状态必须完全一致。golden 与 Pi 路径共享 Decision codec；此证据不等于在线 Provider 推理已验证。

## 真实失败与修复

- 安装：受限环境和 registry 请求失败；通过获授权的安装命令重试，跳过可选 peer 自动补装；Electron 二进制使用 npmmirror 镜像安装。没有降低 SDK 固定版本。
- 取消：早期 signal 已中止时，abortable 在订阅 work 的拒绝前抛出，造成 unhandled rejection。修复为先观测已启动 Promise 的拒绝，再抛取消。回归通过。
- SDK 冷导入：第一次完整并行测试超出 15 秒；独立计时显示耗时集中在 SDK 导入，ModelRuntime 和会话组装很快。仅 SDK 组装测试给予 60 秒，后续完整回归通过，无在线请求。
- 桌面启动：本机 Electron 41 + Playwright ESM 入口顶层等待 ready 时启动卡住；改为注册 ready 初始化回调后，三个真实桌面用例通过。这里记录的是本机复现，未泛化为所有 Electron 版本行为。另参考 [Electron ESM 官方说明](https://www.electronjs.org/docs/latest/tutorial/esm)。
- 最终检查：恢复上下文加入脱敏，启动和续跑加入异步初始化互斥。人工等待不消耗执行时间，恢复时保留累计额度和用量。

## SDK 锚点

安装包中实际阅读：examples/sdk/02-custom-model.ts、03-custom-prompt.ts；dist/core/sdk.d.ts、model-runtime.d.ts、resource-loader.d.ts、settings-manager.d.ts、agent-session.d.ts；sdk.js 与 resource-loader.js。新发现保存在 SDK-MAPPING.md，没有修改全局 Skill。

## 未验证或未提供

1. 按用户选择未调用在线付费模型；Provider 的 JSON 响应稳定性、真实推理质量、在途 HTTP 取消和成本元数据需要配置后实测。生产适配器已实现、实际 SDK 会话组装已通过。
2. Node 测试进程可以执行用户所选项目的代码。路径守卫/allowlist 是应用策略，不是 OS 沙箱；不抵御恶意测试程序或系统层面的文件竞态。测试只继承必要系统环境，不继承 Provider 密钥。
3. 当前使用 Node 原生 --test，支持可由 Node 24 直接运行的测试文件；未接 npm/Vitest 项目命令。仅编辑既有文本文件，不提供任意 shell、删除、MCP、多代理或图片。
4. 每轮 SDK Session 重新建立，不支持长会话压缩、token 增量文本流。日志中模型用量未报告时保持缺失；Token 预算只能约束已报告的用量，不能保证单个 Provider 响应不会超额。
5. 崩溃运行恢复后标记 interrupted，请检查 diff 后新建任务；损坏 JSONL 拒绝自动续跑。无跨进程多写者协议，当前单应用实例使用一个运行服务。
6. 交付开发和构建版桌面程序；未制作签名安装器、自动更新或运行云端 CI。已添加 Windows CI workflow，但未 push 或触发远程 CI。

## 启动

`npm run dev` 或构建后的 `npm start`。创建演示项目即可使用无需密钥的真实工具闭环。真实模型设置方式见 README。
