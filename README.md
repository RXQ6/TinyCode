# TinyCode Workbench

一个从零实现的 TypeScript 编码代理工作台，让 **读取代码 → 修改文件 → 执行测试 → 根据结果继续修复** 的过程可观察、可回放。

项目将任务规则、执行循环、模型决策和桌面界面拆分为独立模块：Core 判断任务是否完成，Runtime 执行工具并保存事件，Pi SDK 提供模型决策，Electron + React 展示文件差异、测试输出和运行历史。

## 功能概览

- **桌面工作台与 CLI**：通过界面或命令行发起任务，查看执行进度与结果。
- **真实文件与测试工具**：列出、读取和编辑工作目录中的文件，运行预先选择的 Node 测试。
- **离线演示与在线模型**：无需密钥即可体验内置购物车修复任务；配置 Provider 后可使用 Pi 模型适配器。
- **事件记录与回放**：以 JSONL 保存执行过程，支持历史查看、等待人工输入后的续跑和中断状态恢复。
- **明确的完成条件**：要求测试通过的任务，必须在最后一次修改后通过测试才能标记完成；部分完成会说明缺少的材料。

## 快速开始

需要 **Node.js 24+** 和 npm。以下示例使用 PowerShell。

```powershell
git clone https://github.com/RXQ6/TinyCode.git
cd TinyCode
npm install --legacy-peer-deps
npm run dev
```

在桌面界面点击 **创建演示项目 → 开始任务**，即可体验无需密钥的修复流程：

1. 读取购物车代码，修复商品数量计算。
2. 执行实际测试，发现折扣计算仍然失败。
3. 修复折扣逻辑，再次测试并完成任务。

演示项目生成在独立目录中。离线模式使用针对内置任务的确定性策略；文件读写和测试执行均为真实操作。

也可以在终端运行演示，事件轨迹保存至 `artifacts/demo-run.json`：

```powershell
npm run demo
```

启动构建版桌面应用：

```powershell
npm run build
npm start
```

## 使用真实模型

先设置环境变量，再从**同一个终端**启动工作台，并在界面选择 **Pi 模式**。

```powershell
$env:TINYCODE_PROVIDER = 'openai'
$env:TINYCODE_MODEL = '<Pi catalog 中的模型 ID>'
$env:OPENAI_API_KEY = '<你的密钥>'
npm run dev
```

可以使用其他 Pi 支持的 Provider，并配置对应的认证环境变量。模型 ID 必须存在于项目固定的 Pi SDK `0.84.2` 的 catalog 中。

密钥不写入项目、事件记录或模型状态。缺少配置或认证失败时，工作台会返回对应的认证或 Provider 错误。

目前已验证离线工具闭环和真实 SDK 会话组装；在线 Provider 的推理质量、响应稳定性、请求取消及成本数据仍需配置模型后实测。

## 命令行使用

配置模型环境变量后，指定工作目录、测试文件和任务：

```powershell
npm run agent -- --workspace "<工作目录>" --tests cart.test.ts --task "修复购物车数量与折扣计算，并通过测试" --allow-writes
```

- `--workspace`：任务工作目录。
- `--tests`：启动时选定的测试文件，多个文件用逗号分隔。
- `--task`：任务描述。
- `--allow-writes`：允许修改工作目录中的文件。
- `--offline`：使用内置离线策略，仅适用于购物车演示任务。

测试工具通过 Node `--test` 执行选定文件，支持 Node.js 24 可直接运行的测试。当前未接入 npm/Vitest 项目测试命令。

## 架构与模块

```text
React → preload → main ─┐
                       ├→ WorkbenchService → AgentRuntime ←→ JsonStore
CLI ───────────────────────────────────────→ AgentRuntime
                                                │
                           ┌────────────────────┴───────────────────┐
                           ↓                                        ↓
                       Core.step                              WorkspaceTools
                           ↓                                  list / read / edit / tests
                       ModelPort
                           ├─ OfflineCartModel：内置任务策略
                           └─ PiModelAdapter：SDK 单回合 JSON 决策
```

Runtime 先持久化事件，再发布给消费者。Pi SDK 提供决策，工具执行和预算控制由 Runtime 管理。

| 模块 | 职责 |
| --- | --- |
| `src/core` | 定义任务状态、决策和完成条件，不读取磁盘、不依赖 SDK。 |
| `src/tools` | 执行文件操作和测试；校验路径、读取记录、原文匹配及外部文件变化，隔离测试进程中的模型密钥。 |
| `src/runtime` | 管理执行循环、事件序号、预算、重试、取消、持久化与回放。 |
| `src/adapters` | 隔离 Pi SDK，使用统一的 Decision codec 校验在线与离线决策。 |
| `src/product` | 管理目录授权、任务运行、历史记录和恢复。 |
| `src/main` / `src/preload` / `src/renderer` | 提供 Electron 主进程、受控 IPC 接口与 React 桌面界面。 |

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动桌面开发环境。 |
| `npm run typecheck` | 执行 TypeScript 类型检查。 |
| `npm test` | 运行单元与集成测试。 |
| `npm run check` | 依次执行类型检查、测试和构建。 |
| `npm run test:e2e` | 运行实际 Electron 桌面端到端测试。 |
| `npm run demo` | 执行单个离线修复演示，保存事件轨迹。 |
| `npm run eval` | 执行 5 个独立购物车场景，重新生成回归轨迹与评估汇总。 |
| `npm run verify` | 执行类型检查、单元测试、构建和桌面测试，记录命令、退出码与测试数。 |

验证产物：

- [`artifacts/demo-run.json`](artifacts/demo-run.json)：演示任务的完整事件轨迹。
- [`artifacts/golden/`](artifacts/golden/)：5 个独立场景的真实工具运行记录。
- [`artifacts/evaluation.json`](artifacts/evaluation.json)：场景评估汇总。
- [`artifacts/verification.json`](artifacts/verification.json)：统一验证结果。

`npm run eval` 会覆盖回归基线，接受新基线前应检查差异。已执行的验证与未验证项见 [验证记录](docs/VERIFICATION.md)。

## 数据存储与恢复

桌面数据默认保存在 Electron 的 `userData/workbench` 中，CLI 和脚本数据保存在 `.workbench` 中。可通过 `TINYCODE_DATA_DIR` 指定桌面数据目录。

运行历史支持回看；等待人工输入的任务可继续执行。崩溃后恢复已保存的观察，并将运行标记为 `interrupted`。检查文件差异后可以新建任务，恢复过程不会重复执行结果不确定的文件写入。

## 当前边界

路径校验和工具授权属于应用层约束，不提供操作系统沙箱。选定的测试文件可以执行项目代码，请仅在可信工作目录中启用测试和修改。

当前支持编辑既有文本文件和运行指定的 Node 测试；尚未提供任意 shell 命令、MCP、多代理、token 级文本流、签名安装器或自动更新。桌面应用以开发环境和构建产物形式运行。

## 项目导读

- [阶段计划](docs/PLAN.md)：实现阶段与目标。
- [SDK 映射](docs/SDK-MAPPING.md)：Pi SDK 与项目模块的对应关系。
- [逐阶段导读](docs/WALKTHROUGH.md)：源码阅读与学习路径。
- [验证记录与局限](docs/VERIFICATION.md)：已执行的验证、问题修复和交付边界。
