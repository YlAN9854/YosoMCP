# YOSO

**YOSO** 是一套以 Chrome 扩展为入口的 browser workflow 系统。用户在真实网页上演示操作，扩展将轨迹录制、规范化并默认脱敏；可一键复制 versioned Clipboard Envelope 给 Agent，也可下载 **YOSO Trace Package（`.yoso`）** 备用。Agent 再通过仓库内的两个 Skill 将轨迹编译为 workflow library，并在用户已经打开的 Chrome session 中动态理解页面、执行操作。

新的主路径不再把 CSS selector 固化脚本当作唯一真相。轨迹描述保留操作意图、顺序和必要的页面线索，执行时由 Agent 重新观察当前页面并选择目标元素，从而更好地适应页面结构变化。完整设计见[产品转型架构](docs/architecture/product-transformation.md)。

---

## 产品组成

| 组件 | 职责 | 是否调用 LLM |
|------|------|:---:|
| **YOSO Recorder 扩展** | 录制操作树、做结构标注、按固定 allowlist 脱敏并复制 Clipboard Envelope；`.yoso` 作为下载备用。 | 否 |
| [`yoso-trace-compiler`](skills/yoso-trace-compiler/SKILL.md) | 把不可信 `.yoso` 或粘贴 Envelope 校验、编译并原子导入本地 workflow library；不操作浏览器。 | 否 |
| [`yoso-browser-library`](skills/yoso-browser-library/SKILL.md) | 查找已导入 workflow，收集运行时输入，连接已有 Chrome，观察页面后逐步执行并 detach。 | 否 |

三部分的数据流是：

```text
用户演示 → Recorder → 复制 Clipboard Envelope（主路径）
                    └→ 下载 <workflow>.yoso（备用）
                              │
                              ▼
                    yoso-trace-compiler
                              │
                              ▼
                    本地 workflow library
                              │
                              ▼
                    yoso-browser-library
                              │
                              ▼
                      已有 Chrome session
```

## 新用户安装与数据目录

扩展与两个 Skill 是三项独立安装物：扩展负责录制和导出，Trace Compiler 负责导入，Browser Library 负责复用已有 Chrome 执行。只安装 Skill **不会**自动创建、下载或附带任何站点 workflow。

### 安装两个 Skill

将仓库中的两个完整目录复制到本地 Codex Skill 根目录。默认根目录为 `${CODEX_HOME:-$HOME/.codex}/skills/`：

| 仓库目录 | 默认安装目标 |
|----------|--------------|
| `skills/yoso-trace-compiler/` | `${CODEX_HOME:-$HOME/.codex}/skills/yoso-trace-compiler/` |
| `skills/yoso-browser-library/` | `${CODEX_HOME:-$HOME/.codex}/skills/yoso-browser-library/` |

首次安装且目标目录尚不存在时，可在仓库根目录执行：

```bash
CODEX_SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "$CODEX_SKILLS_DIR"
cp -R skills/yoso-trace-compiler "$CODEX_SKILLS_DIR/"
cp -R skills/yoso-browser-library "$CODEX_SKILLS_DIR/"
```

升级时应替换对应的完整 Skill 目录，避免把新目录嵌套到旧目录中。安装后重新开始一个 Agent 会话，使 Skill metadata 能在新会话中参与匹配。

### 轨迹与 Library 存在哪里

这三类文件彼此分离：

| 数据 | 默认位置 | 何时产生 |
|------|----------|----------|
| Skill 本体 | `${CODEX_HOME:-$HOME/.codex}/skills/yoso-*/` | 用户安装两个 Skill 时 |
| 剪贴板轨迹 | 系统剪贴板；粘贴后进入受信任的 Agent 对话 | 点击“复制给 Agent”时 |
| 原始 `.yoso` | 用户在浏览器中选择的下载目录 | Recorder 导出时 |
| 编译后的 workflow library | `${YOSO_HOME:-$HOME/.yoso}/browser-library/v1/<traceId>/` | Trace Compiler 首次成功导入时 |

因此，新用户刚安装两个 Skill 后，workflow library 为空是正常状态。主路径是在插件中点击“复制给 Agent”，把完整内容粘贴到 Agent 对话；其中已包含 `$yoso-trace-compiler` 路由指令。剪贴板受限、内容较大或需要归档时，再下载 `.yoso` 并让 Agent 导入。Compiler 不会移动或删除原始下载文件；导入成功后，多个网站和多条轨迹统一进入同一个 Browser Library，而不是各自生成一个站点 Skill。

```text
${YOSO_HOME:-$HOME/.yoso}/browser-library/v1/
└── <traceId>/
    ├── library.json
    └── workflows/
        └── <treeId>--<leafId>.json
```

可通过 `YOSO_HOME` 修改数据根目录。例如，默认位置在 Linux/WSL 中是 `~/.yoso/browser-library/v1/`，在原生 Windows 环境中等价于 `C:\Users\<用户名>\.yoso\browser-library\v1\`。当 Agent 和 `playwright-cli` 运行在 WSL、Chrome 运行在 Windows 时，library 默认仍保存在 WSL 文件系统；CDP/Extension 连接只负责跨环境控制浏览器，不会把 workflow 数据写入 Chrome profile。

## 核心能力

| 能力 | 说明 |
|------|------|
| **工具集（ToolSet）** | 按站点或业务场景组织多棵操作树，一套工具集可以包含多条 workflow 轨迹。 |
| **录制与结构标注** | 捕获点击、输入、导航、等待、悬停、内容提取、文件上传等操作，并保留树、分支、参数和循环语义。 |
| **Trace 导出** | 只要当前 ToolSet 有节点，即可在录制单页直接复制 versioned Clipboard Envelope，或下载 `.yoso` 备用。 |
| **Agent 动态执行** | workflow 提供意图、顺序和页面线索；Agent 运行时 snapshot 页面并动态选择元素，不盲目依赖旧 selector。 |
| **真实浏览器复用** | Browser Library Skill 只 attach 已有 Chrome，可复用该浏览器中的登录态、Cookie 与站点上下文；结束后只 detach。 |

## Trace 导出格式

“复制给 Agent”生成的文本包含一行路由指令、唯一 sentinel `YOSO_TRACE_CLIPBOARD_V1`，以及一个 JSON Envelope：

```json
{"format":"yoso-trace-clipboard","formatVersion":1,"manifest":{},"trace":{}}
```

Envelope 中的 `manifest` 与 `trace` 和同次 `.yoso` 导出的内容语义一致。Compiler 只在容器解析处区分粘贴文本与 ZIP，之后两者共享相同的版本、schema、脱敏计数、图结构和原子导入校验。

`.yoso` 是 ZIP 容器，v1 归档只允许两个根级条目：

```text
manifest.json
trace.json
```

Recorder 使用字段 allowlist 和 `safe-default` 策略。默认不导出输入值、凭据、文件路径、DOM attributes、截图、提取文本、Cookie、LocalStorage、SessionStorage，或旧 ToolSet 中遗留的 LLM 配置；URL 的 query 和 fragment 会被移除。`manifest.json` 记录 schema/version、节点统计和可重算的脱敏事件计数。

> Clipboard Envelope 与 `.yoso` 都不是匿名数据。selectors、页面结构、站点路径和操作意图可能暴露内部系统信息；请只粘贴给受信任的 Agent，并只在受信任环境中保存、传输和编译。

---

## 演示与示例仓库

> 下列条目为**预留位置**：发布视频或独立仓库后，将占位文字替换为实际链接与一句说明即可。

### 视频演示

| 平台 | 链接与说明 |
|------|------------|
| **哔哩哔哩** | _（待补充：演示视频 URL）_ |
| **YouTube** | _（待补充：演示视频 URL）_ |

可选：在同一行或下方加一句视频内容简介（例如：安装、录制分叉、Replay 续录、复制并导入 Trace 全流程）。

---

## 技术栈

- **运行时**：Chrome 扩展（Manifest V3）
- **框架**：[WXT](https://wxt.dev/) + React 19 + TypeScript
- **状态**：Zustand
- **样式**：Tailwind CSS v4

---

## 环境要求

- **Node.js** 18+（推荐当前 LTS）
- **Google Chrome**（或兼容 Chromium 的浏览器，用于加载未打包扩展）

---

## 开发与构建

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 生产构建（输出在 .output/chrome-mv3 等目录，以 WXT 实际输出为准）
npm run build

# 打 zip 便于上架或分发
npm run zip
```

**分发 zip 与本地调试目录**

- **`npm run zip`** 会先执行生产构建，再在 `.output/` 下生成**单个压缩包**，文件名形如 `yoso-extension-<版本号>-chrome.zip`（版本号与 `package.json` 的 `version` 一致）。该 zip 适合提交 Chrome 网上应用店、发 Release 或网盘分发。
- **本地开发与调试**时，请在 Chrome 中选择**未打包目录**（例如 `.output/chrome-mv3`），不要使用「加载已解压」去选 zip 文件；若拿到的是 zip，需先解压，再对解压后的文件夹执行「加载已解压的扩展程序」。
- Firefox 对应产物可使用 `npm run zip:firefox` 生成。

TypeScript 类型检查（不产出文件）：

```bash
npm run compile
```

---

## 安装扩展（开发者模式）

1. 执行 `npm run build`（开发阶段也可用 `npm run dev` 生成输出目录）。
2. 打开 Chrome：**扩展程序** → **管理扩展程序** → 开启**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择 WXT 构建产物目录（例如 `.output/chrome-mv3`）。
4. 点击工具栏中的 YOSO 图标或使用 Chrome **侧边栏**打开 YOSO 面板（扩展申请 `sidePanel` 权限）。

---

## 主使用流程

1. 在扩展中选择或新建 ToolSet，在目标站点开始录制并按业务流程完成演示。
2. 按需标注等待、悬停、提取、上传、分支、参数或循环语义；可从任意节点 Replay 后继续录制或创建左右分支。
3. 在同一录制页面点击**保存轨迹**，再点击**复制给 Agent**。扩展在本地完成固定规则脱敏，不访问网络；将复制结果完整粘贴到受信任的 Agent 对话。
4. Agent 使用 `$yoso-trace-compiler` 校验并导入 Clipboard Envelope，得到本地 workflow library。剪贴板不可用或需要保留原始文件时，点击**下载 .yoso 备用文件**并让 Agent 导入该文件。
5. 让 Agent 使用 `$yoso-browser-library` 选择 workflow、补齐已脱敏的运行时输入，并 attach 用户已有的 Chrome session。
6. Agent 每一步先观察页面、解析当前 locator，再执行操作；所有 CLI stdout/stderr 先由受控 wrapper 重定向到本轮私有易失目录，只返回脱敏后的最小状态；成功或失败后均只执行 detach 并清理该目录，不关闭外部浏览器。

### 执行前 hard gate

Browser Library 不会在“找到一个大概匹配的轨迹”后立即操作页面。以下校验全部通过，才允许进入后续执行：

1. **Library 完整性**：根目录、catalog、workflow 引用、`schemaVersion`、ID、step 顺序与 action 类型合法。
2. **唯一选择**：用户意图只能匹配到一条明确 workflow；有多个候选时先让用户选择。
3. **运行时输入**：轨迹中被脱敏的必填值和文件路径已补齐，且不是 placeholder；secret 不写入 library、仓库、日志或对话输出。
4. **连接边界**：只能 attach 用户已有 Chrome；任一静态校验失败都必须发生在 attach 或第一次页面变更之前。
5. **逐步动态校验**：每一步操作前重新检查当前 URL/origin，并从 snapshot 中解析唯一且可见的目标；目标缺失、歧义或页面上下文不符时停止，不猜测点击。

Compiler 也遵循对应的导入 gate：Clipboard Envelope 先验证 sentinel、单一 JSON 边界和版本，`.yoso` 先验证 ZIP 容器；之后两者在临时目录共享 schema、引用、安全与资源限制校验，通过后才原子写入正式 library，失败时不留下半成品。

两个 Skill 可用官方 validator 检查：

```bash
uv run --with pyyaml python \
  "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" \
  skills/yoso-trace-compiler

uv run --with pyyaml python \
  "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" \
  skills/yoso-browser-library
```

## 连接已有 Chrome

Browser Library Skill 只允许显式 attach，不会静默执行 `open` 或启动一个替代浏览器。根据本机条件选择一种连接方式：

```bash
# 以下是 Skill 内部传给 transcript-safe run_private wrapper 的参数，
# 不是建议用户或 Agent 直接发起的裸 playwright-cli tool call。

# Chrome 144+：在 chrome://inspect/#remote-debugging 启用并批准当前实例
run_private attach-channel attach --cdp=chrome

# Chrome 已在启动时暴露 CDP endpoint；WSL 场景可替换为 Windows host 地址
run_private attach-cdp attach --cdp=http://127.0.0.1:9222

# 已安装并授权 Playwright Extension，需要复用现有 tabs 时
run_private attach-extension attach --extension=chrome

# workflow 结束后只断开控制
run_private detach detach
```

`run_private` 是 Browser Skill 定义的同一 shell invocation 包装约定，不是需要用户全局安装的命令。传统 CDP endpoint 必须由 Chrome 预先开放；它不能把任意未启用调试的实例事后变成 9222 服务。使用单独 `--user-data-dir` 启动的调试实例也不等同于用户当前日常 Chrome session。Chrome、Playwright CLI/MCP 和跨 WSL/Windows 网络的版本差异见[本地 Chrome session 复用调研](docs/research/playwright-local-chrome-session-reuse.md)及 Browser Skill 的[连接说明](skills/yoso-browser-library/references/browser-connection.md)。

`playwright-cli` 可能把页面 snapshot 自动写入当前目录，也可能把 post-action snapshot 返回 stdout。Browser Library Skill 因此禁止从仓库或 evidence 目录直接运行，也禁止把裸 CLI 调用作为 Agent tool call；所有输出必须先在同一 shell invocation 内重定向并脱敏。有 secret runtime input 时必须使用 memory-backed 私有目录，并在 finally 中 detach 后清除。无法提供这种安全执行通道时应在 attach 前停止。

## Recorder 精简边界

扩展只保留轨迹创作与交付主链：ToolSet 选择/显式保存、录制树、树内分叉、从节点 Replay 后续录、参数/循环推断，以及 Clipboard/`.yoso` Trace 导出。旧 ToolSet JSON 导入导出、Branch 产物管理、插件内 LLM 设置与分析、固定脚本 Skill/MCP 生成和登录会话导出均已移除。仓库中的 `yoso-trace-compiler` 与 `yoso-browser-library` 是当前正式的 Skill 契约，不属于被删除的插件内旧生成器。

---

## 权限说明

扩展申请 `activeTab`、`sidePanel`、`storage`、`tabs`、`scripting`、`webNavigation` 和 `<all_urls>` host permission，用于在用户访问的页面注入内容脚本并录制/重放。它不再申请 `cookies`、`downloads`，也不申请 OpenAI/Anthropic API host；`.yoso` 下载由页面 Blob 链接完成。开源审阅时请以 `wxt.config.ts` 中的 `manifest` 为准。

---

## 仓库结构（节选）

```
entrypoints/          # WXT 入口（background、content、sidepanel）
content/              # 内容脚本：录制、重放、选择器与分支候选采集等
background/           # 后台：消息路由、录制/重放控制、结构分析与 Trace 生成
sidepanel/            # 侧栏 UI（React）
types/                # 共享类型定义
skills/               # Trace Compiler 与 Browser Library 两个 repo-native Skill
docs/architecture/    # 产品架构、数据契约与安全边界
```

---

## 常见问题

**法律声明**
> 本项目仅供学习交流使用，请勿用于任何非法或违反网站服务条款的目的。因滥用本项目导致的任何法律责任，由使用者自行承担。

**Trace 无法复制或下载**
先确认已选择 ToolSet、录制树至少包含一个节点，并点击“保存轨迹”。若仍失败，请检查节点 ID、父子关系和 tree root 是否合法；Recorder 不依赖插件内 LLM 或旧 `code-ready` 门槛。

---

## 参与贡献

欢迎 Issue 与 Pull Request。提交代码前建议本地执行 `npm run compile` 确保类型通过。

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 致谢

感谢使用 YOSO。若本项目对你的研究或产品有帮助，可考虑在论文或文档中引用本仓库链接。
