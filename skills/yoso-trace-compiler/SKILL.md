---
name: yoso-trace-compiler
description: "验证、编译或导入 .yoso Trace Package 时使用。把录制轨迹转换为统一的 YOSO browser workflow library；只处理 Trace 和文件落盘，不执行任何浏览器操作。"
---

# YOSO Trace Compiler

把 `.yoso` 视为不可信输入。只有容器、版本、脱敏计数、图结构和全部 workflow 都验证成功后，才能原子导入 library。

## 工作流

1. 确定输入 `.yoso` 路径和目标 `YOSO_HOME`。未指定时使用 `${YOSO_HOME:-$HOME/.yoso}`。
2. 在目标 filesystem 内创建临时目录。所有解包、验证和编译都在临时目录完成。
3. 按 [Trace Package v1](references/trace-package-v1.md) 验证 ZIP：
   - 拒绝绝对路径、`..`、反斜杠路径、drive prefix、目录和 symlink。
   - 条目及顺序必须精确为 `manifest.json`、`trace.json`。
   - 拒绝未知 format、schema 或 redaction policy 版本。
   - 重算 redaction counts，不信任 manifest 汇总。
4. 在任何正式落盘前验证完整图：ID 安全且唯一、root 存在、parent 存在、每个 node 只从一个 root 可达、无 cycle/disconnected/shared node、action type 已支持。
5. 按 [Workflow Library v1](references/workflow-library-v1.md) 将每棵 tree 的每条 root-to-leaf 路径编译为一个 workflow。step 顺序必须严格保持 root 到 leaf。
6. 把 `action-value` 和 `file-path` 脱敏转成 `requiredInputs`。存在 `credential` 时标记 `secret: true`；不得恢复、猜测或记录原值。
7. 在临时目录重读并验证 `library.json` 和每个 workflow 文件。全部通过后再原子 rename 到正式目录。
8. 输出导入位置、workflow 数量、ID 列表和警告；不得输出 secret。

## 零落盘失败原则

以下任一情况都拒绝整个 package，并确保正式 library 无新增或部分文件：

- 容器条目、路径或文件类型非法。
- JSON 无法解析，字段不符合 v1，或版本未知。
- redaction totals 无法重算一致。
- ID 非法、重复，parent 缺失，或图存在 cycle/disconnected/shared node。
- action type 未支持。
- 目标 `traceId` 已存在，但其 `sourcePackageId` 与当前 package 不同，且用户未明确允许 replace。

不要执行 ZIP 内的任何文件。不要调用 LLM、浏览器、cookie/session 导出或旧 YOSO generator。

## 冲突与替换

- 相同 `traceId` 且相同 `sourcePackageId`：允许以完整新结果原子替换，仍需重新验证全部内容。
- 相同 `traceId` 但不同 `sourcePackageId`：停止并请求用户明确确认 replace。
- 用户确认 replace 后也必须先生成并验证完整临时目录，再用可恢复的同 filesystem rename 替换；禁止逐文件覆盖。

## 完成条件

只有以下条件全部满足才报告成功：

- 正式目录只包含 `library.json` 与 `workflows/*.json`。
- manifest 引用的每个 workflow 文件存在，且没有未引用文件。
- 每个 workflow 的 step 顺序与源 root-to-leaf 路径一致。
- 所有被删除的 value/file path 都有对应 required input。
- 录制时的 value、file path、截图和提取快照没有进入 library。
