# TinyCode Workbench 开发契约

给定一个用户授权的 TypeScript 工作目录与测试入口，用户希望修复代码；代理有用的标准是读取实际代码、修改实际文件、执行实际测试，并根据失败结果继续修复，最终用通过的测试证明结果。

材料：目录、文件、测试输出。动作：list_files、read_file、edit_file、run_tests。信息：文件原文、替换 diff、进程 exitCode/stdout/stderr。缺少材料要返回 partial；缺少模型认证要返回 auth，不可用演示成功替代。

## 阶段与验收命令

1. Core/Tool：`npm run test:core`。Core 无 SDK/文件/网络依赖，明确决策和观察；真实工具限制路径与命令，精确替换必须唯一。
2. Runtime：`npm run test:runtime`。JSONL 先写后发；session 隔离；预算、超时、取消、重试；回放幂等；暂停可输入恢复；崩溃中的工具不自动重做。
3. SDK/评测：`npm test`、`npm run demo`、`npm run eval`。先读 SDK 类型写映射文档；离线决策器使用实际文件和测试进程，不声称使用 LLM；保存 5 个独立真实工具运行的 golden transcripts，并用生产适配器 codec 回放；在线验证须另配 Provider。
4. 桌面：`npm run typecheck`、`npm run build`、`npm run test:e2e`。React → preload 固定 API → Electron 主进程 → Runtime → Core/ports；隔离、sandbox、CSP、IPC 校验；任务、过程、取消、历史、恢复可使用。

## 技术与边界

Node 24 + strict TypeScript；Pi SDK 固定 0.84.2；Electron + React + electron-vite；JSONL 存储；Vitest + Playwright。TypeScript 是源码、测试和脚本的唯一实现语言。只读参考 D:/tinyCode 的 README/package 架构，不修改、不复制其实现。

Core 拥有任务、状态、决策、观察、成功语义；Runtime 拥有 ID、序号、事件、预算、重试、取消和存储。文件工具从显式根目录出发，拒绝越界、链接和私密文件。测试命令是用户启动前指定的 Node executable + 参数，模型不能改成 shell 命令。执行项目测试本身可以执行项目代码，属于工作目录的运行授权，不是 OS 沙箱。

## UI 方案

面向学习代理循环和修复代码的人：左侧任务/历史、中间按顺序展开工具证据、右侧结果与验证状态。底色 #edf2f7、面板 #ffffff、正文 #20334c、主色 #345bc7、失败 #ac3450、通过 #227569。中文用系统微软雅黑，代码用 Consolas。工具轨迹是主视觉，用文件 diff 和 exitCode 支撑完成状态，不堆装饰统计卡。

## Skill 分工

pi-coding-agent 推导真实任务、Core/Runtime、ports、证据、故障和回放。fullstack-desktop 路由 typescript-pro（联合类型/严格编译）、electron-best-practices（进程与 IPC）、React skill（监听清理、派生状态、按需 SDK 加载）、frontend-design（工作台设计）、playwright-expert（真实桌面流程、role selector、自动等待、截图）。不用 SQL；不引入多代理。
