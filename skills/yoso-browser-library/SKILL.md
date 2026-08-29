---
name: yoso-browser-library
description: "当用户明确或隐含要求在真实浏览器执行网站操作、复用已录制 YOSO workflow、已有登录态或当前 tabs 时使用。先查询统一 browser workflow library，再动态理解页面并执行；不编译 .yoso Trace。"
---

# YOSO Browser Library

把已导入 workflow 当作行动指导，不把录制 selector 当成不可变脚本。每一步都以真实浏览器的当前 snapshot 为准。

## 运行流程

1. 定位 `${YOSO_HOME:-$HOME/.yoso}/browser-library/v1`，按 [Workflow Library v1](references/workflow-library-v1.md) 验证 catalog、workflow 和引用。
2. 根据用户的站点、任务、目标和当前 URL 筛选 workflow。必须得到唯一匹配；没有匹配时说明 library 缺口，多个匹配时要求用户选择，不猜测。
3. 在连接浏览器前收齐全部 `requiredInputs`：
   - 缺任何 input 立即停止，不发浏览器命令。
   - secret input 只保存在当前调用内存，不回显、不写日志、不写 evidence。
   - 不允许把 placeholder 或 `[REDACTED]` 当成输入值。
4. 按 [真实浏览器连接](references/browser-connection.md) 选择用户明确批准的连接方式。禁止静默 fallback 到 `open`、persistent profile 或新 BrowserContext。
5. attach 成功后立即运行 `playwright-cli -s=yoso snapshot`，确认目标 tab、origin 和可见页面状态。
6. 按 workflow `steps` 顺序串行执行。每步先从 snapshot 解析当前 locator，再执行一个动作，再验证 URL、可见性或目标状态。
7. extract 只返回运行时页面结果，不返回录制时 snapshot。
8. 成功或失败都在 finally 阶段执行 `playwright-cli -s=yoso detach`。只断开 CLI，不关闭用户浏览器。

## 动态定位

按以下顺序组合轨迹线索与当前页面：

1. 可访问性 role、label、name、visible text。
2. 当前 snapshot 的唯一 element ref。
3. workflow 中的 selector、parentSelector、elementIndex、selectorMatchIndex、frame selectors。
4. tag、innerText、loop pattern 等辅助线索。

执行前必须证明 locator 唯一且可见。命中 0 个时报告页面偏离；命中多个且无法由 parent/index/frame 消歧时报告 `WORKFLOW_TARGET_AMBIGUOUS`。不要因为 selector 相似就选择第一个元素。

## 安全停止

遇到以下任一情况立即停止后续步骤，报告最后成功 step，并 detach：

- required input 缺失或 secret placeholder 未替换。
- 当前 origin/URL 与 workflow `startUrl` 或最近 navigate 结果明显偏离。
- locator 不存在、不可见或不唯一。
- action type 不受支持。
- destructive action 已发出但结果不确定。
- 用户拒绝 Chrome remote-debugging/Extension 授权。

不要自动重试 click、submit、delete、publish、send、purchase 等 destructive action。不要读取或导出 cookies、localStorage、sessionStorage、请求 headers/body 或 DevTools 特殊页面。

## 动作映射

- `navigate`：仅在需要时使用 cleaned URL；导航后 snapshot 并核对 origin/页面标识。
- `click` / `dblclick` / `hover` / `check` / `select`：使用本轮 snapshot 得到的唯一 target。
- `fill`：从 `requiredInputs[field=value]` 取值；secret 不得进入命令回显或报告。
- `upload`：从 `requiredInputs[field=filePath]` 取本机路径；不存在时停止。
- `keydown`：使用 workflow key。
- `scroll`：使用记录方向/位置作为提示，再 snapshot。
- `wait_*`：使用记录的 timeout/pattern/state，但等待结束后仍需验证页面。
- `extract_selected_content`：按 runtime mode/selector 提取，并只返回当前结果。

## 完成条件

- 用户目标状态已在真实页面中观测到。
- 每个 step 有对应的执行后验证。
- 只返回必要的运行时结果与最后状态，不泄露 secret 或浏览器存储。
- `playwright-cli -s=yoso detach` 已完成，外部 Chrome 和用户 tabs 仍在运行。
