# TinyCode Workbench

一个从零实现的 TypeScript 编码代理工作台：Core 定义有效任务，Runtime 执行与保存循环，Pi SDK 提供模型决策，Electron + React 展示文件差异、测试输出和运行历史。

## 运行

需要 Node.js 24+。

```powershell
npm install --legacy-peer-deps
npm run demo
npm run eval
npm run check
npm run test:e2e
npm run dev
```

桌面中点击 **创建演示项目 → 开始任务**。演示文件独立生成，不修改参考仓库或本项目源码。离线策略先修复数量，执行实际测试发现折扣失败，再修复折扣并复测。它是确定性策略，不是在线 LLM。

`npm run verify` 会统一运行类型检查、单元测试、构建和桌面测试，并把命令、退出码和测试数写入 `artifacts/verification.json`。

`npm run build` 后可用 `npm start` 启动构建版桌面应用。当前交付是可运行的开发/构建产物，不含签名安装器。

## 真实模型

先设置环境变量，再从同一个终端启动工作台；在界面选择 Pi 模式。密钥不写进项目、事件或模型 State。

```powershell
$env:TINYCODE_PROVIDER='openai'
$env:TINYCODE_MODEL='<Pi catalog 中的模型 ID>'
$env:OPENAI_API_KEY='<你的密钥>'
npm run dev
```

也可以设置其他 Pi 支持的 Provider 及其环境变量。模型 ID 必须存在于固定 SDK 版本的 catalog。未配置或认证失败会显示 typed auth/provider error，不会切换成离线成功。

CLI：`npm run agent -- --workspace <目录> --tests cart.test.ts --task "修复代码" --allow-writes`；添加 `--offline` 只适用于内置购物车任务。不允许模型提供任意 shell 命令，测试工具仅用 Node `--test` 执行启动时选择的测试文件。

## 模块与调用关系

```text
React / CLI
   ↓ 任务请求                 ↑ 产品事件（进度、结果）
Desktop preload → main → WorkbenchService
                           ↓
                    AgentRuntime ←→ JsonStore
                      ↓       ↓       JSONL 先持久化再发布
                 Core.step   WorkspaceTools
                      ↓       list / read / edit / tests
                  ModelPort
                  ├ OfflineCartModel（固定任务策略）
                  └ PiModelAdapter（SDK 单回合 JSON 决策）
```

- `src/core` 不读取磁盘、不导入 SDK；完成必须有最后一次修改后的通过测试；partial 必须列出材料缺口。
- `src/tools` 执行实际文件与测试进程；拒绝路径越界/链接/内部目录；修改前读取、原文唯一匹配、外部变化保护；测试不继承模型密钥。
- `src/runtime` 维护递增事件、预算、重试、取消、JSONL 与回放。记录是事实来源。消费者关闭流也会保存取消状态。
- `src/adapters` 隔离 Pi SDK，用同一 Decision codec 验证离线和在线决策。SDK 不直接执行工具，以便 Runtime 独占副作用与预算。
- `src/product` 管理目录授权、运行、历史与恢复；桌面 IPC 经参数校验，preload 仅暴露固定函数。

## 学习与证据

[阶段计划](docs/PLAN.md)、[SDK 映射](docs/SDK-MAPPING.md)、[逐阶段导读](docs/WALKTHROUGH.md)、[验证记录与局限](docs/VERIFICATION.md)。

`artifacts/demo-run.json` 保存真实闭环；`artifacts/golden/` 保存 5 个独立真实工具运行的事件轨迹；`artifacts/evaluation.json` 保存汇总。`npm run eval` 会重新捕获并覆盖这些回归基线，检查差异后再接受新基线。

默认桌面数据位于 Electron userData/workbench；CLI/脚本位于 `.workbench`。可以用 `TINYCODE_DATA_DIR` 指定桌面存储位置。所有历史可回看；等待人工输入可以续跑；崩溃运行恢复已保存观察并标记 interrupted，不重复不确定的文件写入。

此工具的路径规则不是操作系统沙箱。用户授权的测试文件可以执行项目代码；只对可信工作目录启用测试和修改。当前无 MCP、多代理、任意命令、token 级流式文本、签名/自动更新，也没有假装这些能力已实现。
