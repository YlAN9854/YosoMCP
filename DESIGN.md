# YOSO Side Panel Design System

## 1. Atmosphere & Identity

YOSO 是一个紧凑、可信、偏工程化的浏览器操作面板：信息密度高，但主任务始终清楚。白色和浅灰构成工作区，蓝色标识全局操作，Trace Package 使用 violet 作为独立但一致的能力色。标志性体验是“录制事实 → 明确反馈 → 可交付产物”的短路径，状态变化必须立即可见且不打断用户当前页面。

## 2. Color

颜色来自 Tailwind CSS v4 的内置 OKLCH palette；组件使用下表中的 Tailwind token，不在 JSX 中新增 raw hex/rgb。

| Role | Token | Value | Usage |
|---|---|---|---|
| Surface / canvas | `bg-gray-50` | `oklch(98.5% .002 247.839)` | Side Panel 主背景 |
| Surface / primary | `bg-white` | `#fff` | 工具栏、卡片、表单 |
| Surface / muted | `bg-gray-100` | `oklch(96.7% .003 264.542)` | 次级按钮、disabled |
| Text / primary | `text-gray-900` | `oklch(21% .034 264.665)` | 主要正文 |
| Text / secondary | `text-gray-600` | `oklch(44.6% .03 256.802)` | 提示与辅助信息 |
| Border / default | `border-gray-200` | `oklch(92.8% .006 264.531)` | 分区和常规卡片 |
| Action / primary | `bg-blue-600` | `oklch(54.6% .245 262.881)` | 全局主操作 |
| Action / hover | `bg-blue-700` | `oklch(48.8% .243 264.376)` | 全局主操作 hover |
| Trace / surface | `bg-violet-50/60` | violet-50 at 60% | Trace Package 卡片 |
| Trace / primary | `bg-violet-600` | `oklch(54.1% .281 293.009)` | Trace 主操作 |
| Trace / hover | `bg-violet-700` | `oklch(49.1% .27 292.581)` | Trace 主操作 hover |
| Status / success | `text-green-700` | `oklch(52.7% .154 150.069)` | 完成反馈 |
| Status / error | `text-red-600` | `oklch(57.7% .245 27.325)` | 错误反馈 |
| Status / warning | `text-amber-700` | `oklch(55.5% .163 48.998)` | 风险与待确认状态 |

规则：accent 只表达交互、选择或状态。Trace violet 不用于装饰；复制、下载、错误和成功必须用文案共同表达，不能只依赖颜色。

## 3. Typography

字体沿用浏览器/system UI sans-serif；代码和 selector 使用 Tailwind `font-mono`。

| Level | Tailwind | Size | Weight / line-height | Usage |
|---|---|---:|---|---|
| App heading | `text-sm font-bold` | 14px | 700 / normal | YOSO 标识 |
| Section / action | `text-xs font-medium` | 12px | 500 / 1.5 | 按钮、卡片标题、正文 |
| Supporting | `text-xs leading-relaxed` | 12px | 400 / 1.625 | 安全提示、状态说明 |
| Compact metadata | `text-[10px]` | 10px | 500 / 1.4 | badge、非关键统计 |
| Dense marker | `text-[9px]` | 9px | 500 / 1.3 | 既有节点状态标签，不用于新主操作 |

新功能的按钮、状态和风险说明不得低于 12px。中文使用自然换行；短操作标签优先保持单行，说明文本允许换行但不得截断。

## 4. Spacing & Layout

基础单位为 4px。既有映射：`1=4px`、`1.5=6px`、`2=8px`、`3=12px`、`4=16px`、`8=32px`。

- App shell：单页纵向 flex；ToolSetSelector 与 RecordingControls 固定，OperationTreeView 是唯一主滚动区，Trace Package 固定在树下方。
- 卡片：外边距 12px、内边距 8px、垂直间距 6–8px。
- 交互 cluster：同级按钮 gap 8px；主按钮独占一行，次级按钮可与说明分离。
- 主操作最小高度 44px（`min-h-11`），满足 pointer target。
- 目标宽度：Chrome Side Panel 常规 320–520px；同时必须在 375、768、1280px 下不产生主内容横向滚动。
- 长内容使用 `break-words`；不可断字符串不得撑破容器。

## 5. Components

### App Shell

- **Structure**：ToolSetSelector → RecordingControls → OperationTreeView → Trace Package；ReplayOverlay 覆盖整个录制工作区。
- **Layout**：纵向 shell；ToolSetSelector、RecordingControls 与 Trace Package 均 `shrink-0`，OperationTreeView 使用 `flex-1 min-h-0 overflow-auto`，是唯一主滚动区。页面本身不得产生第二条纵向滚动条。
- **Capability boundary**：界面只呈现轨迹选择/保存、录制、树内分叉、从节点 Replay 后续录、参数角色确认，以及 Trace 复制/下载；不再呈现旧 Branch 产物、LLM 配置、MCP/固定 Skill 生成或 session 导出。
- **Accessibility**：所有操作通过原生 button；键盘顺序严格跟随上述视觉顺序；Replay 状态变化由 live region 宣告。

### Recording Workspace

- **Recording controls**：idle 时显示起始 URL 和录制入口；recording/paused 时只显示当前阶段可执行动作，不为已删除能力保留空位。
- **Operation tree**：继续录制与左右分支入口保留在对应节点/连接附近；节点角色确认仍在树内完成。树只滚动自己的画布，浮层和 context menu 不得扩大 App shell。
- **Persistence**：ToolSet 使用显式“保存轨迹”；保存、复制、下载是三个不同动作，必须有不同文案和反馈，不能用“导出”统称。

### Replay Overlay

- **States**：running、failed、aborted；成功并进入续录时自动关闭。
- **Rollback**：failed 或 aborted 都必须退出 pending continuation/branch 状态，不得让树的 `+` 入口消失。
- **Actions**：running 只提供“中止重放”；failed/aborted 提供“关闭”并返回原树上下文。
- **Accessibility**：overlay 是工作区内的状态层，保留标题、进度、错误详情和可见 focus；不得依赖进度条颜色单独表达结果。

### Panel Card

- **Structure**：header cluster → actions stack → hint → live status。
- **Variants**：neutral、Trace violet、warning amber。
- **Spacing**：`p-2`、`space-y-1.5`、`rounded-lg`。
- **States**：default、disabled、loading、success、error。
- **Accessibility**：标题和操作语义连续；status 使用 `role="status"`、`aria-live="polite"`、`aria-atomic="true"`。
- **Depth**：浅色 surface + 1px border，不新增 shadow。

### Action Button

- **Variants**：primary filled、secondary bordered/muted。
- **Spacing**：主操作 `min-h-11 w-full px-2 py-2`；次级操作保持至少 32px 高，关键导出操作优先 44px。
- **States**：default、hover、active、focus-visible、disabled、loading、success、error。
- **Accessibility**：原生 `button`、明确可见文案、`focus-visible:ring-2`；disabled 不只靠颜色表达。
- **Motion**：只使用 color/opacity 状态过渡；不动画 width/height。

### Live Status

- **Variants**：idle（保留稳定高度）、loading、success、error。
- **Content**：说明发生了什么以及下一步；复制成功必须明确提示“粘贴到 Agent 对话”。
- **Accessibility**：polite live region，避免重复播报同一状态。

### Trace Delivery

- **Placement**：始终位于 OperationTreeView 下方，与树同屏，不需要切换页面。
- **Primary action**：“复制给 Agent”为 44px 主按钮；成功状态明确说明可粘贴到 Agent 对话。
- **Secondary action**：保留 `.yoso` 下载作为文件型交付备选；风险说明与复制决策相邻。
- **Availability**：没有当前轨迹或节点为空时 disabled，并保留原因明确的稳定状态区。

## 6. Motion & Interaction

| Token | Duration | Easing | Usage |
|---|---:|---|---|
| `motion-micro` | 150ms | `ease-out` | hover/focus 颜色反馈 |
| `motion-state` | 200ms | `ease-in-out` | copy/loading/success 的 opacity 状态交换 |

复制交互参照 beui.dev `button` + `action-swap`：idle → loading → success/error，标签在原位改变，不移动布局。当前项目没有 Motion 依赖，因此用 React state 与现有 CSS transition 实现，不新增动画库。Replay 只对运行指示器和进度状态使用现有轻量动画；`prefers-reduced-motion: reduce` 下状态仍即时可见。

## 7. Depth & Surface

采用 **borders-only + tonal tint**：常规区域使用 gray border，Trace 使用 violet tint 与 violet border 建立层级。只有既有 dropdown/modal 可使用 shadow；Trace 导出卡片及其新按钮不新增 shadow、glass 或装饰性 glow。

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- 目标 WCAG 2.2 AA；正文对比度至少 4.5:1，大文字/非文本交互至少 3:1。
- 新交互必须支持 keyboard、visible focus、disabled、loading、success、error。
- 主复制按钮的结果由 live region 宣告；失败保留可行动的错误文字。
- 不用颜色单独表达状态；不新增 emoji 图标。
- 375px、200% zoom 和中文长文案下不得遮挡主操作或产生横向滚动。
- 剪贴板仍可能包含 selector、页面结构与可见文本；风险说明必须出现在复制决策附近。

### Inclusive Personas

- **键盘用户**：只用 Tab/Enter 能完成复制和下载，并能看到 focus。
- **低视力/放大用户**：200% zoom 下按钮和状态不重叠，主要文案可重排。
- **认知负荷敏感用户**：默认路径只有一个明确主动作，成功反馈直接说明下一步。

### Accepted Debt

本次改动不新增已接受的设计或无障碍债务。树节点画布仍沿用现有 emoji action markers 与紧凑字号；它们是录制树既有语言，本轮不做全面 token/图标替换，但所有新主操作和状态文案必须满足本文件的 12px、focus 与 target-size 约束。
