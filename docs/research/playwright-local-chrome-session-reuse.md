# Playwright 复用本地 Chrome 会话能力调研

> 调研日期：2026-08-29
>
> 适用对象：Playwright MCP、Playwright CLI、通过 CDP 或 Browser Extension 连接本地 Chrome 的产品方案
>
> 核心问题：能否不启动独立浏览器实例，而是代理使用用户已经运行的 Chrome，并复用已有 session、cookies、浏览器状态与 tabs。

## 结论摘要

目前 Playwright MCP 和官方 Playwright CLI 都可以连接并控制已经运行的本地 Chrome，并复用该浏览器 profile 中的登录态和页面状态，但必须满足以下任一条件：

1. Chrome 144+ 已由用户在 `chrome://inspect/#remote-debugging` 中开启 Remote Debugging，并批准连接；或
2. 目标 Chrome 已经暴露传统 CDP endpoint；或
3. 用户安装 Playwright Extension，并批准 MCP/CLI 通过扩展连接现有 tabs。

因此，严格按照“不得创建独立浏览器/profile，必须复用用户当前 Chrome”的定义，当前可行路线有两类：

- **CDP channel attach**：`--cdp-endpoint=chrome` / `attach --cdp=chrome`；
- **Browser Extension attach**：`--extension` / `attach --extension`。

`--user-data-dir`、`open --persistent` 和 `--storage-state` 虽然能够保存或导入部分认证状态，但都会使用 Playwright 管理的浏览器或 BrowserContext，不等同于代理当前正在运行的 Chrome。

## 能力矩阵

| 连接方式 | 是否创建独立浏览器/profile | 复用日用 Chrome 登录态 | 复用现有 tabs | 前置条件 | 对本需求的判断 |
|---|---:|---:|---:|---|---|
| MCP `--cdp-endpoint=chrome` | 否 | 是 | 是 | Chrome 144+；用户开启 Remote Debugging 并批准连接 | 满足 |
| CLI `attach --cdp=chrome` | 否 | 是 | 是 | 同上 | 满足 |
| `--cdp-endpoint=http://localhost:9222` | 否 | 取决于暴露 endpoint 的 profile | 是 | Chrome 启动时已暴露 CDP endpoint | 条件满足 |
| MCP/CLI `--extension` | 不创建独立 Playwright profile | 是 | 是，可由用户选择 | 安装 Playwright Extension 并批准连接 | 满足，适合 SSO/2FA |
| MCP `--user-data-dir` | 是 | 只复用指定持久 profile | 否 | profile 未被其他 Chrome 实例占用 | 不满足严格定义 |
| CLI `open --persistent` / `--profile` | 是 | 只复用 CLI 自己的持久 profile | 否 | profile 未被其他实例占用 | 不满足严格定义 |
| `--storage-state` | 是 | 仅导入可序列化状态 | 否 | 预先导出状态文件 | 不满足严格定义 |

## 路线一：Chrome 144+ CDP channel attach

这是当前最直接的纯 CDP 路线。用户不需要使用命令行参数重新启动 Chrome，也不需要知道具体调试端口。

### 用户侧准备

在正在运行的目标 Chrome 中打开：

```text
chrome://inspect/#remote-debugging
```

启用：

```text
Allow remote debugging for this browser instance
```

客户端请求连接时，Chrome 会显示授权对话框。用户允许后，Playwright 才能连接；调试期间 Chrome 会显示浏览器正在被自动化软件控制的提示。

### Playwright MCP 配置

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--cdp-endpoint=chrome"
      ]
    }
  }
}
```

Playwright Core 会把 `chrome` 识别为 Chromium channel 名称，从默认 Chrome user data directory 中读取 `DevToolsActivePort`，再连接对应的 browser-level CDP WebSocket。该路径不会调用 `launch()` 或 `launchPersistentContext()`，也不会创建新的 Chrome profile。

官方资料：

- [Playwright MCP：Connecting to Browsers](https://playwright.dev/mcp/configuration/browser-extension)
- [Playwright Core：channel endpoint 解析实现](https://github.com/microsoft/playwright/blob/de214f440b7e34937fe4886f046b78b757136087/packages/playwright-core/src/server/chromium/chromium.ts#L478-L500)
- [Chrome：连接 AI agent 到个人浏览器](https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect?hl=zh-cn)

### Playwright CLI 命令

```bash
npm install -g @playwright/cli@latest

playwright-cli attach --cdp=chrome
playwright-cli snapshot

# 用完后只断开 CLI session，保留外部浏览器运行
playwright-cli detach
```

也可以使用当前 `playwright` 主包提供的集成入口：

```bash
npx playwright cli attach --cdp=chrome
```

官方资料：[Playwright CLI：Attach](https://playwright.dev/agent-cli/commands/attach)。

## 路线二：Playwright Extension attach

如果目标是稳定复用 SSO、2FA、已安装浏览器扩展、人工操作到一半的页面或复杂的当前 tab 状态，Extension 模式更贴合需求。

### Playwright MCP 配置

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--extension"
      ]
    }
  }
}
```

CLI 对应命令：

```bash
playwright-cli attach --extension
```

使用前需要安装官方 [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)。首次连接默认需要用户批准并选择 tab；多个客户端会获得不同 tab group，用户可以通过把 tab 拖入或拖出 group 来调整客户端可见范围。

该模式底层仍然传递 CDP 消息，但不是把 Chrome 的传统 `9222` endpoint 直接暴露给 Playwright：

```text
Playwright MCP / CLI
        ↓ connectOverCDP
本地 CDP relay
        ↓ WebSocket
Playwright Extension
        ↓ chrome.debugger API
用户当前 Chrome tabs
```

因此：

- 从“是否使用 CDP 控制页面”的角度看，它属于 CDP 路线；
- 从“是否直接连接 Chrome remote-debugging endpoint”的角度看，它属于 Extension bridge 路线。

官方资料：

- [Playwright Extension README](https://github.com/microsoft/playwright/blob/de214f440b7e34937fe4886f046b78b757136087/packages/extension/README.md)
- [Extension relay 的 `chrome.debugger` 调用](https://github.com/microsoft/playwright/blob/de214f440b7e34937fe4886f046b78b757136087/packages/extension/src/relayConnection.ts#L39-L55)

## 路线三：传统 CDP endpoint

Playwright MCP 和 CLI 仍支持连接已经存在的 HTTP/WebSocket CDP endpoint：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--cdp-endpoint=http://localhost:9222"
      ]
    }
  }
}
```

```bash
playwright-cli attach --cdp=http://localhost:9222
```

这种情况下 Playwright 不会启动浏览器，而是调用 `chromium.connectOverCDP()` 连接目标实例的默认 BrowserContext。

但是，从 Chrome 136 开始，`--remote-debugging-port` 和 `--remote-debugging-pipe` 对默认 Chrome data directory 不再生效，必须同时指定非默认 `--user-data-dir`：

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile-for-automation
```

这通常会形成独立 profile，需要用户重新登录，因此传统 `9222` 路线已经不适合作为“直接复用日用 Chrome profile”的默认方案。Chrome 144+ 的用户授权式 channel attach 是对此问题更合适的官方路径。

官方资料：

- [Chrome 136：Remote Debugging switches 安全变更](https://developer.chrome.com/blog/remote-debugging-port)
- [Playwright `connectOverCDP()` API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [MCP CDP 连接实现](https://github.com/microsoft/playwright/blob/de214f440b7e34937fe4886f046b78b757136087/packages/playwright-core/src/tools/mcp/browserFactory.ts#L105-L114)

## Session、Cookie 与浏览器状态的实际复用范围

通过 CDP 或 Extension 连接已有浏览器时，Playwright 使用的是目标浏览器的现有默认 BrowserContext，而不是创建新的隔离 context。

可复用内容包括：

- 当前 profile 的 cookie jar 和登录 session；
- 已打开的普通网页 tabs；
- 页面所属 origin 的 `localStorage`；
- 原 tab 中仍然存活的 `sessionStorage`；
- service worker、Cache Storage 和其他由该 profile 持有的运行环境；
- Extension 模式下，页面依赖的已安装浏览器扩展。

边界包括：

- `HttpOnly` cookie 不能由页面 JavaScript 通过 `document.cookie` 读取，但可被 BrowserContext/CDP cookie API 访问；
- `Secure`、`SameSite`、domain、path、partition 等 cookie 规则仍由 Chrome 正常执行；
- `localStorage` 仍按 origin 隔离；
- DevTools、`chrome:`、`edge:` 等特殊页面不应被视为普通可控 Page；
- CDP target 的发现存在类型和时序边界，不能保证所有特殊 target 都映射为 Playwright Page；
- Playwright 官方将 `connectOverCDP()` 描述为比 Playwright protocol 连接显著低保真，部分高级能力可能受 Chrome 启动方式和 CDP 实现差异影响。

## 为什么 persistent profile 和 storageState 不等价

### Persistent profile

MCP `--user-data-dir` 或 CLI `open --persistent` 会启动一个 Playwright 管理的浏览器实例，并把 cookies、localStorage 等写入指定目录。它解决的是“让自动化浏览器跨次运行保持状态”，不是“接管用户当前正在运行的 Chrome”。

同时，同一个 user data directory 不能安全地由两个 Chrome 实例并发占用，直接指向用户正在使用的默认 profile 会遇到单实例/profile lock 和数据安全问题。

### storageState

`storageState` 是状态快照，不是完整 profile：

- 可以保存或导入 cookies 与 origin-scoped localStorage；
- 可按选项覆盖部分 IndexedDB/认证数据；
- 不包含已打开 tabs；
- 不原生持久化 sessionStorage；
- 不复制浏览器扩展、完整缓存、浏览器设置或正在运行的 service worker 状态。

因此它适合可复制的自动化环境，但不满足本调研的核心产品定义。

## 当前官方包与版本快照

截至 2026-08-29，通过 npm Registry 与 CLI `--help` 实测：

| 包 | 当前版本 | 说明 |
|---|---:|---|
| `@playwright/mcp` | `0.0.79` | 官方 standalone MCP Server |
| `@playwright/cli` | `0.1.18` | 官方 Playwright CLI，bin 名为 `playwright-cli` |
| `playwright` | `1.62.1` | 当前主包，同时提供 `playwright mcp` 和 `playwright cli` 入口 |
| `playwright-cli` | `0.262.0` | deprecated 占位包，无 executable；应改用 `@playwright/cli` |

对应 npm 页面：

- [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp)
- [`@playwright/cli`](https://www.npmjs.com/package/@playwright/cli)
- [`playwright-cli`](https://www.npmjs.com/package/playwright-cli)

## 安全与产品边界

复用真实日用 Chrome profile 意味着自动化客户端可以接触高价值状态，包括已登录网站、cookies、页面内容和可能存在的企业内网会话。这不是普通无状态浏览器自动化的安全等级。

产品设计至少需要明确：

- 连接必须由用户显式发起或批准；
- 当前受控 browser、profile 和 tabs 必须可见；
- 用户应能随时断开连接；
- 不应把 origin allowlist 描述成完整安全边界；
- 对不完全可信的 Agent，应建议使用专用 Chrome profile；
- Extension token、CDP endpoint 和 browser-level 控制权限都应被视为敏感凭据或高权限能力。

## 对 YOSO Flow 产品形态讨论的输入

> **历史方案，已不属于当前产品边界。** 本节只记录早期调研时讨论过的连接模型，不代表当前能力或产品承诺。当前插件只负责录制、Replay、参数/循环角色推断与 Trace Clipboard/`.yoso` 交付；不生成或导出固定 Skill/MCP。repo-native Trace Compiler 与 Browser Library Skills 作为独立工具保留。

早期讨论曾围绕以下连接模型展开：

1. **YOSO Flow 继续只负责录制和生成**，导出的 MCP/Skill 由用户自行选择 Playwright 连接方式；
2. **YOSO Flow 导出带 Browser Binding 的 MCP**，运行时提供 `isolated`、`persistent`、`existing Chrome via CDP`、`existing Chrome via Extension` 等显式模式；
3. **YOSO Flow 自身充当浏览器桥接层**，利用现有扩展身份、tab 权限和录制上下文，把受控 tab 暴露给生成的 MCP；
4. **混合模式**，默认使用隔离浏览器保证可重复性，在必须复用 SSO/2FA/人工上下文时由用户切换到现有 Chrome。

这些方案的主要权衡不是“技术上能否复用 cookie”，而是可重复性、用户授权体验、权限隔离、Agent 信任边界、导出产物的独立性，以及 YOSO Flow 是否要承担持续运行的 browser broker 职责。
