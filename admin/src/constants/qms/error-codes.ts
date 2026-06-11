/**
 * Error code definitions for frontend
 *
 * These definitions match the backend error-codes.ts
 */

export interface ErrorCodeDefinition {
  code: string;
  type: string;
  location: string;
  upstream_component: string;
  trigger_scenario: string;
}

/**
 * Complete error code definitions table
 */
export const ERROR_CODE_DEFINITIONS: ErrorCodeDefinition[] = [
  {
    code: "E001",
    type: "HTTP 5xx / 连接错误",
    location: "RotatingApiClient.ts",
    upstream_component: "nova-gateway",
    trigger_scenario: "API 调用返回 HTTP 5xx、网络连接失败 (ECONNREFUSED/ENOTFOUND)",
  },
  {
    code: "E002",
    type: "HTTP 超时",
    location: "RotatingApiClient.ts",
    upstream_component: "nova-gateway",
    trigger_scenario: "API 调用超时 (timeout/timed out)",
  },
  {
    code: "E003",
    type: "SSE 中断",
    location: "AcpConnection.ts",
    upstream_component: "acp",
    trigger_scenario: "SSE 流中断、JSON-RPC 流解析失败",
  },
  {
    code: "E004",
    type: "空响应",
    location: "AcpAgent.ts",
    upstream_component: "openclaw",
    trigger_scenario: "Agent 返回空响应",
  },
  {
    code: "E005",
    type: "ACP 解析错",
    location: "AcpMessagePipeline.ts",
    upstream_component: "acp",
    trigger_scenario: "ACP 协议消息解析错误",
  },
  {
    code: "E006",
    type: "Gateway 鉴权失败",
    location: "AuthService.ts",
    upstream_component: "nova-gateway",
    trigger_scenario: "Gateway 鉴权失败 (HTTP 401/403)",
  },
  {
    code: "E007",
    type: "Gateway 余额不足",
    location: "BillingService.ts",
    upstream_component: "nova-gateway",
    trigger_scenario: "Gateway 余额不足 (HTTP 402)",
  },
  {
    code: "E008",
    type: "渲染进程 crash",
    location: "ConversationPage.tsx",
    upstream_component: "client",
    trigger_scenario: "渲染进程 JavaScript 异常崩溃",
  },
  {
    code: "E009",
    type: "Agent 内部错误",
    location: "AcpAgent.ts / OpenClawAgent.ts",
    upstream_component: "client",
    trigger_scenario: "Agent 处理过程中未分类的内部异常（默认错误码）",
  },
  {
    code: "E010",
    type: "Gateway 断开连接",
    location: "OpenClawAgent.ts",
    upstream_component: "sudoclaw",
    trigger_scenario: "Sudoclaw Gateway WebSocket 断开连接",
  },
];

/**
 * Get error code definition by code
 */
export function getErrorCodeDefinition(code: string): ErrorCodeDefinition | undefined {
  return ERROR_CODE_DEFINITIONS.find((def) => def.code === code);
}

/**
 * Validate if error code is known
 */
export function isValidErrorCode(code: string): boolean {
  return ERROR_CODE_DEFINITIONS.some((def) => def.code === code);
}