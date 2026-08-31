# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [0.1.0] - 2026-08-31

首个公开预览版本。

### 新增

- Chrome Manifest V3 录制器，支持操作树、分叉录制、Replay 续录、参数与循环推断。
- versioned Clipboard Envelope 与 `.yoso` Trace Package 导出，并采用 `safe-default` 脱敏策略。
- `yoso-trace-compiler` Agent Skill，用于校验、编译并原子导入轨迹。
- `yoso-browser-library` Agent Skill，通过官方 Playwright CLI 在用户授权的现有 Chrome session 中执行 workflow。

### 移除

- 插件内 LLM 配置与分析。
- 旧 ToolSet JSON 导入导出、固定脚本 Skill/MCP 生成和登录会话导出。
