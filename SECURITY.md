# 安全策略

## 支持范围

当前仅维护最新的 `0.1.x` 版本。安全修复会通过新的 patch 版本和 GitHub Release 发布。

## 报告漏洞

请优先使用本仓库 GitHub Security 页面中的 **Report a vulnerability** 私密报告入口。请勿在公开 Issue 中披露尚未修复的漏洞、凭据、Cookie、完整浏览器 snapshot、未脱敏 Trace 或可识别个人与内部系统的信息。

报告应尽量包含：

- 受影响版本与运行环境。
- 最小复现步骤和预期/实际行为。
- 影响范围及是否需要用户交互或已有登录态。
- 已完成脱敏的日志或示例；不要提交真实 secret。

维护者确认后会协调复现、修复与披露时间。若私密报告入口不可用，请通过维护者的 GitHub 主页联系，仍不要公开漏洞细节。

## 敏感边界

YOSO Flow 扩展拥有 `<all_urls>`、`scripting`、`tabs` 等浏览器权限，以录制和 Replay 用户明确发起的操作。Clipboard Envelope 与 `.yoso` 会删除输入值、凭据、文件路径、DOM attributes、截图、提取文本、Cookie 和 Web Storage，但它们并非匿名数据：URL path、selector、页面结构和操作意图仍可能暴露敏感信息。

使用或提交安全报告时：

- 只在受信任环境中保存和处理 Trace。
- 不上传来自内部系统或私人账户的原始轨迹。
- 不在日志、Issue、Pull Request 或 Release 中附带 secret runtime input。
- Browser Library 只能 attach 用户已授权的 Chrome，不得绕过远程调试授权或导出浏览器存储。
