# 真实浏览器连接与执行协议

## 选择连接方式

所有命令使用独立 session：

```bash
playwright-cli -s=yoso ...
```

### 用户提供 CDP endpoint

```bash
playwright-cli -s=yoso attach --cdp=http://127.0.0.1:9222
```

endpoint 必须来自用户或当前受控 QA 环境。不得扫描本机端口寻找浏览器。

### 用户要求连接正在运行的 Chrome

Chrome 144+ 由用户在以下页面启用并批准 Remote Debugging：

```text
chrome://inspect/#remote-debugging
```

随后：

```bash
playwright-cli -s=yoso attach --cdp=chrome
```

不得绕过授权对话框。Chrome 136+ 的传统 remote-debugging port 对默认 data directory 不生效；不要把新建 profile 冒充用户当前 session。

### 用户需要当前 tabs、SSO、2FA 或扩展状态

安装并批准官方 Playwright Extension 后：

```bash
playwright-cli -s=yoso attach --extension=chrome
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

## 执行循环

attach 后：

```bash
playwright-cli -s=yoso tab-list
playwright-cli -s=yoso snapshot
```

对每个 step：

1. snapshot/find 获取当前页面的可访问性信息和 element ref。
2. 根据 role/text/selector/frame/index 证明目标唯一。
3. 执行一个 CLI action。
4. 再 snapshot，检查 URL、目标可见性或最终状态。
5. 记录非敏感的 step outcome；失败即停止。

CDP 连接的能力低于完整 Playwright protocol。某个高级能力不可用时停止并说明，不切换到另一个浏览器继续。

## Detach 保证

只要 attach 成功，后续逻辑必须等价于：

```text
try:
  snapshot + execute + verify
finally:
  playwright-cli -s=yoso detach
```

成功、locator 歧义、导航偏离、缺 action 支持、用户取消都必须 detach。detach 后可用 `tab-list`/操作系统进程检查证明外部 Chrome 仍运行，但不得调用 storage/cookie 命令进行“验证”。

## 隐私与权限

- 不调用 `cookie-*`、`localstorage-*`、`sessionstorage-*`、`state-save`、`requests`、`request-*`。
- 不访问 `chrome://`、`edge://`、DevTools 页面；Remote Debugging 授权页仅由用户操作。
- 不把 snapshot 全文写入 evidence；只记录必要的 element ref、URL origin 和结果状态。
- secret input 不进入 CLI transcript。优先通过受控的进程输入或 Agent 内存传递；如果当前工具无法避免回显，先停止并请求安全输入通道。
