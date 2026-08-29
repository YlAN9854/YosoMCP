# YOSO 产品转型架构

## 1. 决策摘要

YOSO 从“录制后生成固定 Playwright 脚本，再包装为 MCP Server”转向“录制事实、编译语义轨迹、由 Agent 在真实浏览器中动态执行”的三层产品：

1. **YOSO Recorder extension**：浏览器插件只负责录制、归一化、默认脱敏和导出，不在新的 Trace 主路径中调用 LLM。
2. **`yoso-trace-compiler` Skill**：验证 `.yoso` Trace Package，把 root-to-leaf 轨迹编译成可检索、可参数化的 workflow library。
3. **`yoso-browser-library` Skill**：根据用户意图检索 workflow，以记录的轨迹为指导，先理解当前页面，再通过 Playwright CLI/CDP/Extension 驱动用户已经打开的真实浏览器。

本次转型保留原有 ToolSet JSON、MCP、可执行 Skill 和 session 导出。新能力是并行增加的主路径，不是一次破坏性迁移。

## 2. 为什么转型

旧方案把录制结果固化为带 CSS selector 的 Playwright 代码。Agent 只看到一个封装后的调用，无法感知页面状态，也无法在 DOM 或文案小幅变化时重新理解目标。结果是：脚本对 selector、页面时序和录制环境耦合过强，页面变化后容易失败。

新方案保留“用户演示一次”的低门槛，同时把轨迹降级为指导信息。运行时 Agent 必须先 snapshot 当前页面，再依据轨迹中的动作意图、selector 线索、文本、frame 和等待语义动态定位。轨迹提供先验，页面观测决定实际动作。

## 3. 系统拓扑

```text
用户演示
  │
  ▼
YOSO Recorder extension
  录制 → 归一化 → allowlist → 默认脱敏
  │
  ▼
versioned .yoso Trace Package
  manifest.json + trace.json
  │
  ▼
yoso-trace-compiler Skill
  验证容器/版本/图 → 参数化 → 原子导入
  │
  ▼
用户统一 browser workflow library
  站点/任务索引 + workflow v1
  │
  ▼
yoso-browser-library Skill
  意图路由 → snapshot → 动态定位 → 逐步校验 → detach
  │
  ▼
用户已经运行的 Chrome 与真实 session/cookies
```

## 4. 组件职责

### 4.1 Recorder extension

Recorder 是事实采集器和安全导出边界：

- 记录 navigate、click、fill、upload、wait、extract、frame 等动作和树关系。
- 从当前 ToolSet snapshot 生成 Trace，不改写现有 IndexedDB schema。
- 只使用显式 allowlist 创建新对象，不把 ToolSet 原对象直接序列化后再删除字段。
- 新 Trace 导出不访问网络、不调用 LLM、不依赖 branch 分析或 `code-ready` 状态。
- 当前 ToolSet 至少有一个 operation node 时即可导出。
- Side Panel 只负责触发 background 生成并把两个文本条目压成 `.yoso` ZIP。

Recorder 不负责：理解业务意图、给 workflow 命名、生成固定脚本、导入 library、连接或控制真实浏览器。

### 4.2 `yoso-trace-compiler` Skill

Compiler 是不可信文件与用户 library 之间的边界：

- 只接受固定的 `.yoso` ZIP 容器和已知版本。
- 拒绝额外条目、绝对路径、`..`、symlink、未知 format/schema/redaction policy。
- 重算树图、脱敏计数与 root-to-leaf 路径，拒绝 cycle、orphan、共享 node 和非法 ID。
- 把每条 root-to-leaf 路径编译成 workflow；把已脱敏的 value/file path 转成运行时必填参数。
- 使用临时目录生成完整结果，验证成功后原子替换 library 中对应的 `traceId` 目录。
- 不执行浏览器动作，也不猜测被脱敏的秘密值。

### 4.3 `yoso-browser-library` Skill

Browser Library Skill 是运行时路由器和执行协议：

- 用户要求浏览器操作或特定站点任务时，优先检查统一 library 中是否有匹配 workflow。
- workflow 命中后先连接用户明确批准的真实浏览器，再 snapshot 当前页面。
- 每一步把轨迹线索与当前 DOM/可访问性信息结合，动态选择 locator。
- destructive action 不自动重试；缺必填参数、定位歧义、导航偏离或 unsupported action 时立即停止。
- 成功和失败都只执行 `detach`，不关闭用户浏览器。

Skill 不导出 cookies/localStorage，不绕过 Chrome 的远程调试授权，也不悄悄启动隔离浏览器作为“真实 session”的替代品。

## 5. Trace Package v1

### 5.1 容器

`.yoso` 是 ZIP 容器，v1 顶层条目及顺序固定为：

```text
manifest.json
trace.json
```

不允许额外条目、目录、绝对路径、路径穿越或 symlink。JSON 采用 UTF-8、2-space 缩进和末尾换行。

### 5.2 版本

v1 同时维护三个独立版本：

- `formatVersion`：ZIP 容器和 manifest 结构。
- `traceSchemaVersion` / `schemaVersion`：Trace 文档结构。
- `redaction.policyVersion`：默认脱敏策略。

读取方遇到未知版本必须拒绝，不能按最近版本猜测或静默降级。未来兼容升级应新增明确 migration，不在 v1 reader 中放宽校验。

### 5.3 Trace 内容

Trace 只保留 Recorder 事实：

- ToolSet 基础标识、名称、描述、时间和清理后的 target URL。
- operation tree 的 ID、root 和可选 label。
- normalized node、parent 关系、动作、frame、等待、loop 和角色线索。
- selector、tag、索引和 parent selector 等动态定位线索。
- root redaction events，以及每个 action 的 `redactedFields`。

Trace 明确不包含：branches、tools、analysis cache、generated code、session、cookies、localStorage、LLM settings、录制时截图或提取快照。

### 5.4 图不变量

- tree `id` 与 `rootNodeId` 分别唯一。
- 每个 root 必须存在，且对应 node 的 `parentId` 为 `null`。
- 每个非 root node 的非空 `parentId` 必须存在。
- 每个 node 从且仅从一个 root 可达。
- 不允许 cycle、disconnected node 或 shared node。
- 缺少匹配的源 tree metadata 时，可从实际 `parentId === null` node 合成 tree；源 tree 指向缺失 root、重复 root 或重复 ID 时拒绝导出。

## 6. 默认脱敏策略

### 6.1 必须删除

每次 Trace 导出无条件排除：

- `action.value`
- `action.filePath`
- `upload` 动作即使未记录真实路径，也必须发出 `file-path` 脱敏事件，供 Compiler 生成运行时文件输入。
- `action.attributes` 与 candidate attributes
- `action.extractedText`
- `action.extractedScreenshot`
- `metadata.llmSettings`
- session、cookies、localStorage

URL 会移除 query 和 fragment。保留的文本还会掩码常见 password、token、secret、API key、Authorization 和 Bearer 赋值形态。

### 6.2 审计信息

每次删除或掩码只记录 `{path, code}`，其中 path 是源 ToolSet 的 JSON Pointer，不记录原值。同一 path/code 去重并排序。manifest 中的 `redaction.byCode` 由事件重算，必须满足：

```text
redaction.total
  = trace.redactions.length
  = sum(redaction.byCode)
```

action 级事件还会把 code 加入该 action 的 `redactedFields`。Compiler 由 `credential` 判断 runtime input 是否为 secret，但不得恢复或猜测原值。

### 6.3 安全边界

safe-default 不是通用 PII anonymizer。selector、页面可见文本、站点路径和结构本身仍可能暴露业务信息，因此 `.yoso` 仍应按敏感文件处理，只分享给可信接收方。v1 不提供“关闭脱敏”开关。

## 7. Browser workflow library

默认 library 根目录为：

```text
${YOSO_HOME:-$HOME/.yoso}/browser-library/v1/
```

每个 `traceId` 独立成目录，catalog 只引用已经完整验证并原子落盘的 workflow。多个站点和多条轨迹共存在同一个 library Skill 下；站点只是索引维度，不拆成多个 Skill。

Skill 的 metadata/description 负责稳定触发：当用户显式或隐式要求浏览器操作、站点任务、复用录制流程时，应先调用 Browser Library Skill，再查询 catalog；没有匹配 workflow 时才回退到通用浏览器探索，并可建议用户录制新轨迹。

## 8. 真实 Chrome 连接模型

运行层依次支持：

1. `playwright-cli attach --cdp=chrome`：Chrome 144+ active-instance channel，用户需在 `chrome://inspect/#remote-debugging` 允许连接。
2. `playwright-cli attach --cdp=http://127.0.0.1:9222`：连接已经暴露 CDP endpoint 的 Chrome；Chrome 136+ 必须使用 non-standard `--user-data-dir`。
3. `playwright-cli attach --extension=chrome`：通过 Playwright Extension 连接已有 tabs/profile。

三者的共同原则是连接用户明确批准的外部浏览器，而不是由 Skill 新开隔离实例。连接同一个 profile/context 才能使用其 cookies、origin storage 和现有页面；`storageState` 导入到新 context 不等于复用真实浏览器。更完整的能力边界见[本地 Chrome session 复用调研](../research/playwright-local-chrome-session-reuse.md)。

`playwright-cli` 的 snapshot 可能包含已经填写的表单值，并自动写入当前工作目录。Browser Skill 必须从本轮独立的私有易失目录运行，把 daemon/cache 一并限制在该目录；有 secret input 时该目录必须是 memory-backed filesystem。snapshot 原文只在进程内解析，对外输出前替换 supplied inputs；finally 先 detach，再清除整个易失目录。无法满足这些条件时在 attach 前停止，不能把仓库、Skill 或 evidence 目录当作运行目录。

## 9. 错误模型

| 错误 | 层 | 处理 |
|---|---|---|
| `TRACE_PACKAGE_EMPTY` | Recorder | 当前 ToolSet 无 node；UI 不下载 |
| `TRACE_PACKAGE_INVALID_ID` | Recorder/Compiler | ID 或文件名不安全；停止且无落盘副作用 |
| `TRACE_PACKAGE_INVALID_TREE` | Recorder/Compiler | 图不满足不变量；停止且报告结构问题 |
| `TRACE_PACKAGE_UNSUPPORTED_VERSION` | Compiler | 未知 format/schema/policy；拒绝降级 |
| `TRACE_PACKAGE_INVALID_ARCHIVE` | Compiler | 条目、路径或 ZIP 类型非法；拒绝解包 |
| `WORKFLOW_INPUT_REQUIRED` | Runtime | 缺少 value/file/secret 参数；首个动作前停止 |
| `WORKFLOW_TARGET_AMBIGUOUS` | Runtime | locator 命中不唯一；不猜测、不继续 |
| `WORKFLOW_NAVIGATION_DIVERGED` | Runtime | 当前页面偏离预期；报告最后成功步骤 |
| `WORKFLOW_ACTION_UNSUPPORTED` | Runtime | 动作无法安全映射；停止执行 |

## 10. 兼容矩阵

| 能力 | 转型后状态 | 说明 |
|---|---|---|
| `.yoso` Trace Package | 新主路径 | 无 LLM、默认脱敏、交给 Compiler Skill |
| `.yoso.json` ToolSet | 保留 | 现有导入/导出与 IndexedDB 不变 |
| `*-skill.zip` | 保留 | 旧的固定脚本式可执行 Skill |
| `*-mcp-server.zip` | 保留 | 旧 MCP Server 生成与门禁不变 |
| `*-session.json` | 保留 | 仍只导出 code-ready 分支所需 storage state |
| LLM 设置与命名 | 保留 | 旧分析/命名能力继续存在；Trace 路径不使用 |

## 11. 数据与信任边界

- Content Script 产生的录制消息不可信；background 只从当前 ToolSet snapshot 生成导出。
- Side Panel 不能提供 package ID、producer version 或 server timestamp；这些由 background 注入。
- `.yoso` 对 Compiler 是不可信输入，验证完成前不得写入正式 library。
- workflow library 对 Runtime 提供指导，不拥有浏览器授权；Chrome 用户批准是独立边界。
- Browser Skill 每步重新观测页面，不能把录制 selector 当成必然正确的命令。

## 12. 非目标

本阶段不建设扩展内 Trace 导入、云同步、账号体系、marketplace、远程 browser broker、LLM 轨迹总结、Chrome Web Store 发布或跨设备 session 搬运，也不移除任何旧导出能力。

## 13. 演进原则

1. Recorder schema 只描述可观察事实，业务语义属于 Compiler 输出。
2. 脱敏策略只能版本化收紧；放宽必须成为显式的新模式并重新评估产品授权，本阶段不提供。
3. Runtime 以页面观测为准，workflow 提供目标和顺序，不提供不可质疑的 selector。
4. 每个版本的 reader 都严格验证自己理解的字段与不变量。
5. 旧导出通过独立兼容测试维护，不让新 Trace 代码侵入其生成链路。
