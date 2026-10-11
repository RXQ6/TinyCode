# 逐阶段导读

## 第一阶段：什么才算代理完成了任务

先读 `src/core/contracts.ts`，再读 `src/core/agent.ts`。Task 是用户希望修复的事情；Decision 只有调用工具、询问人、回复三种；Observation 保存动作的实际结果。`step` 委托 ModelPort 决策，但会拒绝没有测试证据的“已完成”。Core 不知道 Electron、文件系统或 Pi SDK。

`src/tools/workspace.ts` 才接触文件和进程。read_file 保存读取时的哈希；edit_file 检查内容未变化，再执行唯一替换。run_tests 使用固定 Node 程序和用户预选的测试文件，不接受模型生成的 shell 命令。

调用：`step(state, model, signal) → Decision(call_tool) → tools.execute(intent, signal) → Observation`。验证：`npm run test:core`，13 个测试通过。

pi-coding-agent 让我们先定义结果证据再设计循环；fullstack-desktop 路由 TypeScript Skill，用判别联合区分决策/事件，用严格编译避免错把缺失字段当成有效结果。

## 第二阶段：循环如何执行、停止与恢复

读 `src/runtime/runtime.ts`。run 建立 Session 和 Run；每轮记录 model_requested、decision_made，再执行工具；工具结束写入 tool_completed 与 observation_added。失败测试也会成为观察，下一轮据此修复。工具异常不会清空已有状态。

Runtime 拥有迭代、工具、Token、重试和执行时间预算。AbortSignal 从 Runtime 传到 model/tools；用户取消不重试。usage_reported 出现在终止前，最后是 completed/failed/cancelled。连续相同行为没有新信息时触发 no_progress。

读 `src/runtime/store.ts`：JSONL 先追加并 flush，再把事件交给消费者。序号连续，重复相同事件可以幂等追加，冲突序号拒绝。`replayAgentState` 从事件重建任务、观察、迭代和人工输入；UI 不读取 SDK 内部对象。

等待人输入会保存 awaiting_human；`resume` 接收输入后继续。人工等待时间不耗执行超时预算，Token/工具/重试额度不会重置。进程崩溃时只恢复已保存证据，不重复不确定的副作用，明确报告 interrupted。损坏日志保留原文件并拒绝自动恢复。

验证：`npm run test:runtime`。pi-coding-agent 决定日志、预算与恢复不变量；fullstack-desktop 保持 Runtime 在主进程中，文件/模型权限不进入 renderer。

## 第三阶段：SDK 只是模型端口的实现

先读 `docs/SDK-MAPPING.md`，再读 `src/adapters/pi.ts`。真实 ModelPort 每轮创建 Pi 内存会话，关闭 SDK 的全部内置工具，只要求返回一个 JSON 决策。运行时执行工具和记录证据，避免两套循环同时拥有写文件的权力。

`DefaultResourceLoader.reload` 显式加载受控系统提示，关闭全局扩展和项目指令发现。`ModelRuntime` 从 Provider 环境配置取模型；`session.prompt` 的 assistant 文本通过 Zod codec 验证，错误映射为 auth/rate_limited/provider_unavailable 等；取消调用 `session.abort`，最后 dispose。模型用量按适配器生命周期累计，Runtime 记录每次运行的增量。

`OfflineCartModel` 是内置购物车任务的固定策略，不能解决任意项目。它会做一次不完整修改，在真实测试的失败输出包含 discount 时继续修复。它不是在线 LLM。

`npm run demo` 的证据链：

1. list_files / read_file：读取实际 cart.ts。
2. edit_file：把 `sum + item.price` 改为乘以 quantity。
3. run_tests：退出码 1，quantity 与 empty 通过，discount 失败。
4. edit_file：把 `subtotal + discount` 改为按折扣减价并保留两位小数。
5. run_tests：退出码 0，三个测试通过；Core 接受 complete。

`npm run eval` 运行五种实际金额/数量/折扣数据，保存 golden transcripts。golden.test.ts 按每一步 State 重放离线决策，并通过生产 Pi codec 编解码，保证结构语义一致。`pi.test.ts` 真的导入 0.84.2 并组装 tools-disabled 会话，但不请求付费模型。在线 Provider 验证待用户配置，不把 codec 回放说成在线推理验证。

pi-coding-agent 提供 SDK 映射、真实任务与 golden 证据标准；fullstack-desktop 的 TypeScript 指导把 SDK 类型挡在端口背后，并让错误保持可验证的联合类型。

## 第四阶段：人如何看到代理做了什么

入口是 `src/main/index.ts`，renderer 在 `src/renderer/src.tsx`。React 只调用 `window.workbench`；`src/preload/index.ts` 用 contextBridge 暴露固定函数；主进程检查调用窗口、参数、目录授权，再交给 WorkbenchService。服务拒绝并发启动，也拒绝对 D:/tinyCode 写入。

调用链：`React.start → preload invoke → IPC handler → WorkbenchService.start → Runtime.run → Core.step → ModelPort → ToolPort`；事件反向流动：`RunLog flush → service.broadcast → preload listener → React 的工具证据与结果面板`。React Effect 退出时移除监听；历史回放复用同一产品事件。

左侧是任务和工作目录；中间是读取内容、代码差异与测试输出；右侧是完成/部分/失败/取消和用量。失败测试保留在成功任务的轨迹里，所以用户能检查“为什么继续修改”。应用重启后可回看所有日志；等待输入时出现继续表单。

验证：`npm run typecheck`、`npm run build`、`npm run test:e2e`。三个实际桌面用例通过：修复与重启历史、未授权写入后的 partial、取消实际测试进程。截图 `artifacts/workbench-completed.png` 已检查。

pi-coding-agent 决定 UI 必须展示的产品事件与诚实结果；fullstack-desktop 路由 Electron（隔离/sandbox/IPC）、React（监听与状态）、frontend-design（证据工作台布局）、Playwright（真实启动、角色选择器、自动等待、截图和并行用例）。
