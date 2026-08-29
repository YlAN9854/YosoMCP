# Workflow Library v1 编译规范

## 目录

```text
${YOSO_HOME:-$HOME/.yoso}/browser-library/v1/<traceId>/
├── library.json
└── workflows/
    └── <treeId>--<leafId>.json
```

`workflowId` 固定为 `<treeId>--<leafId>`，必须通过与 Trace ID 相同的安全检查。`file` 固定为 `workflows/<workflowId>.json`。

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
      "name": "Trace name / Tree label / leaf-id",
      "file": "workflows/tree-id--leaf-id.json"
    }
  ]
}
```

workflow entries 按 `workflowId` 排序。`importedAt` 由执行导入的 Agent 注入，不信任 package 中的同名数据。

## Workflow definition

```json
{
  "schemaVersion": 1,
  "workflowId": "tree-id--leaf-id",
  "traceId": "trace-id",
  "treeId": "tree-id",
  "leafNodeId": "leaf-id",
  "name": "Trace name / Tree label-or-id / leaf-id",
  "startUrl": "https://example.test/path",
  "steps": [
    { "nodeId": "node-id", "action": {} }
  ],
  "requiredInputs": [
    {
      "name": "value_2",
      "nodeId": "node-id",
      "field": "value",
      "secret": false,
      "reason": "action-value"
    }
  ],
  "extracts": [
    { "nodeId": "node-id", "mode": "text", "selector": "#result" }
  ]
}
```

`startUrl` 取路径中第一个 navigate action 的已清理 URL；没有 navigate 时取 trace `targetUrl`；两者都没有则省略。

## root-to-leaf 编译

1. 从 tree root 开始，按 node parent/children 关系建立邻接表。
2. leaf 是没有 child 的可达 node。
3. 对每个 leaf 唯一回溯到 root，再反转得到 root→leaf path。
4. `steps` 对 path 逐项映射，顺序不得排序或合并。
5. `steps[].action` 保留已经验证的 TraceActionV1；不得加入录制时 snapshot、value 或 file path。

## Required inputs

对每个 step 的 `action.redactedFields`：

- `action-value`：生成 `field: "value"`。若 node metadata 的 `enumParamName` 匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，name 使用它；否则使用 `value_<1-based-step-index>`。
- `file-path`：生成 `field: "filePath"`。若 action 的 `filePathArgName` 匹配同一变量名规则，name 使用它；否则使用 `filePath_<1-based-step-index>`。
- 同一 action 含 `credential` 时，value input 的 `secret` 为 true；其他 input 为 false。
- `reason` 固定为产生该 input 的 `action-value` 或 `file-path`。

同一 workflow 内 input name 必须唯一；合法的显式 name 冲突时整包拒绝，不能静默改名。缺少 runtime input 时由 Browser Library Skill 在连接/执行前停止。

## Extracts

`extract_selected_content` action 生成 extract entry：

- `nodeId`：当前 node ID。
- `mode`：action 的 runtime `extractMode`。
- `selector`：优先 `extractedSelector`，否则使用 action selector。

只描述运行时提取，不携带录制时 `extractedText` 或 screenshot。

## 原子导入

1. 在目标 `browser-library/v1` 所在 filesystem 创建随机临时目录。
2. 在临时目录生成全部 JSON，随后从磁盘重读并验证引用、schema、ID、step 和 required input。
3. 目标不存在时，rename 临时目录为 `<traceId>`。
4. 目标存在且 `sourcePackageId` 相同：先将旧目录 rename 为备份，再把临时目录 rename 到目标；成功后删除备份，失败则恢复。
5. 目标存在且 source 不同：没有用户明确 replace 就停止。明确 replace 后仍采用备份 + rename，不逐文件覆盖。
6. 无论成功失败都清理尚存的临时目录；不得删除用户未确认替换的正式目录。

完成后重新读取正式 `library.json`，确认每个 `file` 存在且没有额外 workflow 文件。
