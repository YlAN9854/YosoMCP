# 真实浏览器连接与执行协议

## CLI 前置条件

本协议只允许使用官方 npm package `@playwright/cli` 提供的 `playwright-cli`，不使用同名的 deprecated 占位 package `playwright-cli`。用户必须在调用本 Skill 前完成安装：

```bash
npm install -g @playwright/cli@latest
playwright-cli --version
```

Agent 只能执行无副作用的 `playwright-cli --version` 预检，不能代替用户安装或升级依赖。预检失败时必须在读取 workflow 和 attach 前停止，给出上述安装命令。当前版本不得改用 `@playwright/mcp`、其他 MCP server、Playwright library API 或临时 `npx` 下载作为 fallback。

## 选择连接方式

所有命令使用独立 session，并必须由后文的 transcript-safe wrapper 执行；以下连接示例只表示参数，不允许把 CLI 原始 stdout/stderr 直接返回 Agent：

```bash
run_private <label> ...
```

### 用户提供 CDP endpoint

```bash
run_private attach-cdp attach --cdp=http://127.0.0.1:9222
```

endpoint 必须来自用户或当前受控 QA 环境。不得扫描本机端口寻找浏览器。

### 用户要求连接正在运行的 Chrome

Chrome 144+ 由用户在以下页面启用并批准 Remote Debugging：

```text
chrome://inspect/#remote-debugging
```

随后：

```bash
run_private attach-channel attach --cdp=chrome
```

不得绕过授权对话框。Chrome 136+ 的传统 remote-debugging port 对默认 data directory 不生效；不要把新建 profile 冒充用户当前 session。

### 用户需要当前 tabs、SSO、2FA 或扩展状态

安装并批准官方 Playwright Extension 后：

```bash
run_private attach-extension attach --extension=chrome
```

只控制用户授权给 Extension 的 tab group。

## 明确禁止的 fallback

以下命令会启动或管理另一浏览器，不等于代理用户当前 Chrome，本 Skill 禁止静默使用：

```text
playwright-cli open
playwright-cli open --persistent
playwright-cli close
playwright-cli close-all
playwright-cli kill-all
```

也不得用 storageState/profile copy 代替“已有 session”而不向用户说明语义变化。

## 私有易失运行目录

`playwright-cli` 会在当前工作目录自动创建 `.playwright-cli/page-*.yml`，页面中的已填表单值可能进入这些 snapshot。不得从 Skill、仓库、项目、下载或 evidence 目录直接运行 CLI。

attach 前必须：

1. 创建仅当前用户可读写的独立运行目录，并把 CLI cwd、daemon session 与 cache 都放在该目录中。
2. 有 secret input 时，目录必须位于 OS 提供的 memory-backed filesystem（Linux/WSL 例如 `/dev/shm`）。若当前平台没有可确认的 memory-backed 私有目录，停止并请求安全执行通道；不得退回普通磁盘临时目录。
3. 注册 finally 清理：先 detach，再删除这个精确运行目录。成功、失败和用户取消都执行。
4. 禁止把 secret 写入 shell history、命令字面量或环境检查输出；只验证变量存在、非 placeholder，不输出值。

同一受控 shell invocation 中定义并强制使用 transcript-safe wrapper。等价模式如下；不得把 `playwright-cli` 裸调用作为单独 tool call：

```bash
run_private() {
  label="$1"
  shift
  (cd "$YOSO_RUNTIME_DIR" && playwright-cli -s=yoso "$@") \
    >"$YOSO_RUNTIME_DIR/$label.stdout" \
    2>"$YOSO_RUNTIME_DIR/$label.stderr"
}
```

attach、tab-list、snapshot、find、eval、fill 和其他 action 全部通过该 wrapper。随后仍在同一 shell 进程内解析这些文件：

- 对每个 supplied input 做精确值替换后，才允许输出必要的 locator 片段。
- 更优先只输出白名单状态，例如 target count、唯一 element ref、URL origin、布尔验证、step/error code。
- 不输出 snapshot 全文、字段值、原始 stdout/stderr 或自动 post-action snapshot。
- secret 参数只以受控变量引用传给 wrapper，例如 `run_private fill-password fill "$target_ref" "$YOSO_INPUT_PASSWORD"`；不得把展开后的值写进命令字面量。

只把 snapshot 原文留在本轮易失目录和进程内。若执行环境不能在 Agent 看见输出前完成重定向与脱敏，必须在 attach 前停止。表单注入 secret 后，所有后续命令和 snapshot 都适用此规则。

## 执行循环

从私有易失目录 attach 后：

```bash
run_private tab-list tab-list
run_private page-snapshot --raw snapshot
```

对每个 step：

1. snapshot/find 获取当前页面的可访问性信息和 element ref。
2. 根据 role/text/selector/frame/index 证明目标唯一。
3. 执行一个 CLI action。
4. 再 snapshot，检查 URL、目标可见性或最终状态；若页面已含 supplied input，只在进程内解析原文，对外输出前先脱敏。
5. 记录非敏感的 step outcome；失败即停止。

CDP 连接的能力低于完整 Playwright protocol。某个高级能力不可用时停止并说明，不切换到另一个浏览器继续。

## Detach 保证

只要 attach 成功，后续逻辑必须等价于：

```text
try:
  snapshot + execute + verify
finally:
  run_private detach detach
  清除本轮易失运行目录
```

成功、locator 歧义、导航偏离、缺 action 支持、用户取消都必须 detach。detach 后可用 `tab-list`/操作系统进程检查证明外部 Chrome 仍运行，但不得调用 storage/cookie 命令进行“验证”。

## 隐私与权限

- 不调用 `cookie-*`、`localstorage-*`、`sessionstorage-*`、`state-save`、`requests`、`request-*`。
- 不访问 `chrome://`、`edge://`、DevTools 页面；Remote Debugging 授权页仅由用户操作。
- 不把 snapshot 全文写入 evidence；只记录必要的 element ref、URL origin 和结果状态。
- secret input 不进入 CLI transcript。优先通过受控的进程输入或 Agent 内存传递；如果当前工具无法避免回显或无法把自动 snapshot 限制在 memory-backed 目录，先停止并请求安全输入通道。
- 不把直接 `playwright-cli` tool call 当作 wrapper；重定向必须发生在同一 shell 命令内部、早于工具采集 stdout/stderr。
- finally 后检查 Skill/仓库/evidence cwd 未新增 `.playwright-cli`，且易失运行目录不存在；该检查只看路径和文件数量，不读取 secret 值。
