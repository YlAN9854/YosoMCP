# YOSO

**YOSO** 是一套以 Chrome 扩展为入口的 browser workflow 系统。用户在真实网页上演示操作，扩展将轨迹录制、规范化并默认脱敏，导出为 versioned **YOSO Trace Package（`.yoso`）**；Agent 再通过仓库内的两个 Skill 将轨迹编译为 workflow library，并在用户已经打开的 Chrome session 中动态理解页面、执行操作。

新的主路径不再把 CSS selector 固化脚本当作唯一真相。轨迹描述保留操作意图、顺序和必要的页面线索，执行时由 Agent 重新观察当前页面并选择目标元素，从而更好地适应页面结构变化。完整设计见[产品转型架构](docs/architecture/product-transformation.md)。

---

## 产品组成

| 组件 | 职责 | 是否调用 LLM |
|------|------|:---:|
| **YOSO Recorder 扩展** | 录制操作树、做结构标注、按固定 allowlist 脱敏并导出 `.yoso`。 | 否 |
| [`yoso-trace-compiler`](skills/yoso-trace-compiler/SKILL.md) | 把不可信 `.yoso` 校验、编译并原子导入本地 workflow library；不操作浏览器。 | 否 |
| [`yoso-browser-library`](skills/yoso-browser-library/SKILL.md) | 查找已导入 workflow，收集运行时输入，连接已有 Chrome，观察页面后逐步执行并 detach。 | 否 |

三部分的数据流是：

```text
用户演示 → Recorder → <workflow>.yoso
                         ↓
               yoso-trace-compiler
                         ↓
              本地 workflow library
                         ↓
               yoso-browser-library
                         ↓
                 已有 Chrome session
```

## 核心能力

| 能力 | 说明 |
|------|------|
| **工具集（ToolSet）** | 按站点或业务场景组织多棵操作树，一套工具集可以包含多条 workflow 轨迹。 |
| **录制与结构标注** | 捕获点击、输入、导航、等待、悬停、内容提取、文件上传等操作，并保留树、分支、参数和循环语义。 |
| **Trace Package** | 无需 branch `code-ready` 或 LLM；只要当前 ToolSet 有节点，即可在分支页下载 versioned `.yoso`。 |
| **Agent 动态执行** | workflow 提供意图、顺序和页面线索；Agent 运行时 snapshot 页面并动态选择元素，不盲目依赖旧 selector。 |
| **真实浏览器复用** | Browser Library Skill 只 attach 已有 Chrome，可复用该浏览器中的登录态、Cookie 与站点上下文；结束后只 detach。 |
| **Legacy exports** | 原有 ToolSet JSON、固定脚本 Skill、MCP Server 和登录会话导出继续保留，便于已有用户迁移。 |

## `.yoso` Trace Package

`.yoso` 是 ZIP 容器，v1 归档只允许两个根级条目：

```text
manifest.json
trace.json
```

Recorder 使用字段 allowlist 和 `safe-default` 策略。默认不导出输入值、凭据、文件路径、DOM attributes、截图、提取文本、Cookie、LocalStorage、SessionStorage 或 LLM 配置；URL 的 query 和 fragment 会被移除。`manifest.json` 记录 schema/version、节点统计和可重算的脱敏事件计数。

> `.yoso` 仍然是敏感文件，不是匿名数据。selectors、页面结构、站点路径和操作意图可能暴露内部系统信息；请只在受信任环境中保存、传输和编译。

---

## 演示与示例仓库

> 下列条目为**预留位置**：发布视频或独立仓库后，将占位文字替换为实际链接与一句说明即可。

### 视频演示

| 平台 | 链接与说明 |
|------|------------|
| **哔哩哔哩** | _（待补充：演示视频 URL）_ |
| **YouTube** | _（待补充：演示视频 URL）_ |

可选：在同一行或下方加一句视频内容简介（例如：安装、录制、分支、导出 MCP 全流程）。

### 常见网站的 MCP Server 示例（独立仓库）

使用 YOSO 对常见站点录制并导出的 MCP Server 代码，可单独维护在**本仓库之外**的 Git 托管仓库中，便于版本管理与分发。

| 项目 | 链接与说明 |
|------|------------|
| **示例仓库** | _（待补充：`https://github.com/...` 或 Gitee 等）_ |
| **文档 / 列表** | _（可选：各站点工具说明、导入方式、免责声明等，可为仓库内 README 链接）_ |

> **提示**：第三方站点自动化可能受服务条款约束；示例仓库建议注明「仅供学习 / 需自行承担合规责任」等。

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
2. 按需标注等待、悬停、提取、上传、分支、参数或循环语义；Trace 导出不要求先完成旧脚本的 `code-ready` 门槛。
3. 打开**分支**页，点击**下载 Trace Package (.yoso)**。扩展在本地完成固定规则脱敏，不访问网络，也不调用 LLM。
4. 让 Agent 使用 `$yoso-trace-compiler` 校验并导入 `.yoso`，得到本地 workflow library。
5. 让 Agent 使用 `$yoso-browser-library` 选择 workflow、补齐已脱敏的运行时输入，并 attach 用户已有的 Chrome session。
6. Agent 每一步先观察页面、解析当前 locator，再执行操作；成功或失败后均只运行 `playwright-cli -s=yoso detach`，不关闭外部浏览器。

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
# Chrome 144+：在 chrome://inspect/#remote-debugging 启用并批准当前实例
playwright-cli -s=yoso attach --cdp=chrome

# Chrome 已在启动时暴露 CDP endpoint
playwright-cli -s=yoso attach --cdp=http://127.0.0.1:9222

# 已安装并授权 Playwright Extension，需要复用现有 tabs 时
playwright-cli -s=yoso attach --extension=chrome

# workflow 结束后只断开控制
playwright-cli -s=yoso detach
```

传统 CDP endpoint 必须由 Chrome 预先开放；它不能把任意未启用调试的实例事后变成 9222 服务。Chrome、Playwright CLI/MCP 和跨 WSL/Windows 网络的版本差异见[本地 Chrome session 复用调研](docs/research/playwright-local-chrome-session-reuse.md)及 Browser Skill 的[连接说明](skills/yoso-browser-library/references/browser-connection.md)。

## Legacy exports 兼容

产品转型不会删除已有导出入口：

- ToolSet 仍可导入/导出 `<name>.yoso.json`。
- `code-ready` 分支仍可生成固定 TypeScript Skill 包与 MCP Server 包。
- 登录会话仍可显式导出 Playwright `storageState` JSON；该文件含 Cookie 与 LocalStorage，比 `.yoso` 更敏感。
- 旧 Skill/MCP 的 readiness、注册、代码生成和 blocked 规则保持不变。

新的 Trace Compiler/Browser Library 与旧 `skill.runtime.json`/固定脚本是不同契约，不应混用。迁移期可以并行使用两条路径。

---

## 权限说明

扩展会申请包括但不限于：`sidePanel`、`tabs`、`scripting`、`storage`、`cookies`、`webNavigation`、`downloads` 以及广泛 **host_permissions**（用于在任意站点注入内容脚本并录制/重放）。`.yoso` 导出不会读取 Cookie 或 Web Storage；`cookies` 权限仍由 legacy 登录会话导出使用。开源审阅时请以 `wxt.config.ts` 中的 `manifest` 为准。

---

## 仓库结构（节选）

```
entrypoints/          # WXT 入口（background、content、sidepanel）
content/              # 内容脚本：录制、重放、选择器与分支候选采集等
background/           # 后台：消息路由、重放控制、结构分析、MCP/Skill 生成
sidepanel/            # 侧栏 UI（React）
types/                # 共享类型定义
skills/               # Trace Compiler 与 Browser Library 两个 repo-native Skill
docs/architecture/    # 产品架构、数据契约与安全边界
```

---

## 常见问题

**法律声明**
> 本项目仅供学习交流使用，请勿用于任何非法或违反网站服务条款的目的。因滥用本项目导致的任何法律责任，由使用者自行承担。

**导出被拦截（blocked）**  
Legacy Skill/MCP 在路径未确认或校验未通过时仍会拒绝生成。`.yoso` Trace Package 不依赖这些门槛；若 Trace 导出失败，请检查操作树是否为空、节点 ID/父子关系是否合法。

**LLM 相关**  
工具注册命名等 legacy 功能需要你在**设置**中配置 API Key 与模型；Recorder 的 `.yoso` 导出、两个 repo-native Skill 及真实浏览器执行均不依赖插件内 LLM 配置。

---

## 参与贡献

欢迎 Issue 与 Pull Request。提交代码前建议本地执行 `npm run compile` 确保类型通过。

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 致谢

感谢使用 YOSO。若本项目对你的研究或产品有帮助，可考虑在论文或文档中引用本仓库链接。
