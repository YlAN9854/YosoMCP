# Trace Package v1 验证规范

## 容器

`.yoso` 是 ZIP。读取 central directory 后、解压任何内容前执行：

1. entry 数量必须是 2。
2. 顺序和名称必须精确为 `manifest.json`、`trace.json`。
3. entry 必须是普通文件；拒绝目录、symlink 和其他特殊类型。
4. 拒绝空名、NUL、绝对路径、`..` segment、反斜杠、Windows drive prefix。
5. 为解压总字节数设置合理上限，防止 ZIP bomb；验证压缩后/解压后大小，不执行任何内容。

## 安全 ID

`packageId`、`traceId`、tree ID、node ID、leaf ID 和所有非 null `parentId` 必须匹配：

```regex
^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$
```

并且不得为 `.` 或 `..`，不得含 `/`、`\\`、drive prefix 或绝对路径。任一 ID 不合格时整包拒绝，不能用“清理后的 ID”继续导入。

## Manifest v1

必须满足：

```json
{
  "format": "yoso-trace-package",
  "formatVersion": 1,
  "traceSchemaVersion": 1,
  "packageId": "safe-id",
  "createdAt": "ISO-8601",
  "producer": { "name": "YOSO", "version": "string" },
  "traceFile": "trace.json",
  "summary": { "treeCount": 1, "nodeCount": 1 },
  "redaction": {
    "policyVersion": 1,
    "mode": "safe-default",
    "total": 0,
    "byCode": {}
  }
}
```

拒绝未知 `formatVersion`、`traceSchemaVersion` 或 `policyVersion`，不猜测兼容。

## Trace document v1

根字段是：

```text
schemaVersion, traceId, name, description, createdAt, updatedAt,
targetUrl?, trees[], nodes[], redactions[]
```

`schemaVersion` 必须为 1。`trees` 的元素只含 `id/rootNodeId/label?`。`nodes` 的元素含 `id/parentId/timestamp/metadata/action`。

Trace action 可使用的动作类型：

```text
click, dblclick, fill, select, check, upload, keydown, navigate,
scroll, hover, wait_for_url, wait_for_selector, wait_for_timeout,
wait_for_navigation, extract_selected_content
```

未知 action type 必须使整包失败。不要把未知 action 当 click 或跳过。

## 脱敏一致性

每个 root event 精确为 `{path, code}`；path 是 JSON Pointer，不得携带原值。同一 `path + code` 不得重复。

允许的 code：

```text
action-value, credential, url-query, url-fragment, file-path,
attributes, screenshot, extracted-text, llm-settings, text-secret
```

按 trace events 重算：

```text
manifest.redaction.total
  == trace.redactions.length
  == sum(manifest.redaction.byCode)
```

`byCode` 中每个 count 必须等于该 code 的实际 event 数量。action 上的 `redactedFields` 必须去重，且其 action 级 code 在 root events 中存在对应 source path。

Trace 和 manifest 任意位置都不应出现录制时的 `value`、`filePath`、attributes 内容、截图、extracted snapshot、LLM settings、cookie 或 storage state。

## 图验证

1. tree ID 和 rootNodeId 分别唯一。
2. node ID 全局唯一。
3. 每个 tree root 存在，并且 root node 的 `parentId` 是 null。
4. 每个非 root node 的非 null parent 存在。
5. 从每个 root 做有颜色 DFS：灰色重入表示 cycle。
6. 每个 node 必须且只能被一个 root 访问；零次是 disconnected，多次是 shared。
7. manifest 的 tree/node count 必须与实际数组长度相等。

任何失败都发生在创建正式 library 之前。
