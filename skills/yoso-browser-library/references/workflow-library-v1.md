# Workflow Library v1 运行时规范

## 查找根目录

```text
${YOSO_HOME:-$HOME/.yoso}/browser-library/v1/
```

每个 `<traceId>` 目录只允许：

```text
library.json
workflows/*.json
```

读取目录名和 JSON 中的 ID 前，验证 `^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$`，拒绝 `.`、`..`、斜杠、反斜杠和绝对路径。引用的 `file` 必须精确为 `workflows/<workflowId>.json`，且目录内不得有未引用 workflow。

## Library manifest

```json
{
  "schemaVersion": 1,
  "traceId": "trace-id",
  "sourcePackageId": "package-id",
  "importedAt": "ISO-8601",
  "workflows": [
    {
      "workflowId": "tree-id--leaf-id",
      "name": "Trace / Tree / leaf-id",
      "file": "workflows/tree-id--leaf-id.json"
    }
  ]
}
```

只接受 `schemaVersion: 1`。同一用户意图匹配多个 workflow 时不得按数组顺序取第一个。

## Workflow definition

必需字段：

```text
schemaVersion, workflowId, traceId, treeId, leafNodeId, name,
steps[], requiredInputs[], extracts[]
```

可选 `startUrl`。每个 step 精确为 `{nodeId, action}`，顺序已经是 root→leaf，不再排序。

required input：

```json
{
  "name": "accountPassword",
  "nodeId": "node-id",
  "field": "value",
  "secret": true,
  "reason": "action-value"
}
```

`field` 只允许 `value` 或 `filePath`。`reason` 只允许 `action-value` 或 `file-path`。同一 workflow 的 name 必须唯一，每个 input 必须映射到相同 node 的对应 step。

## 选择 workflow

1. 先根据用户明确提供的 workflow ID 精确匹配。
2. 否则把用户意图与 workflow name、startUrl host、trace/tree ID 比较。
3. 已 attach 时，可把当前 tab URL 作为过滤条件，但不得读取 cookie/storage 来路由。
4. 零匹配：报告没有已录 workflow，可建议用户用 Recorder 新录轨迹。
5. 多匹配：列出安全的 name/ID/host 让用户选择，不执行浏览器动作。

## 执行前验证

- library、workflow 与所有引用 schemaVersion 为 1。
- workflow ID、trace ID、tree ID、leaf ID 和 step node ID 安全。
- `steps` 非空，node ID 不重复。
- action type 属于支持集合。
- 每个 redacted value/filePath 都有 required input，且 supplied value 不是空串、placeholder 或 `[REDACTED]`。
- secret input 不得写入临时文件、shell history、日志或最终回复。

任何失败都必须发生在 attach 或第一条页面 mutation 前。

## 运行时结果

结果只包含：workflow ID、成功/失败、最后成功 step、必要的 extract 当前值和明确错误码。禁止附带 cookies、storage、Authorization、页面全量快照或 secret inputs。
