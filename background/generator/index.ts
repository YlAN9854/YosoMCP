// Barrel: MCP 导出（整包生成）入口；按分支组装的实现见 mcpGen

export { generateMcpServer } from './mcpGen'
export type { McpOutput } from './mcpGen'
export { generateTracePackage } from './tracePackageGen'
export { redactToolSetToTrace } from './traceRedactor'
export { TracePackageError } from './traceGraph'
