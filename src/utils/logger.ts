/**
 * Operation logging utility
 */

import { db } from '../db/index.js';

export interface LogOperationParams {
  userId: number;
  userPhone: string;
  action: string;
  resource: string;
  resourceId?: number;
  method?: string;
  path?: string;
  requestData?: unknown;
  responseData?: unknown;
  responseStatus?: number;
  durationMs?: number;
  errorMessage?: string;
}

/**
 * Log an operation to the operation_logs table
 */
export function logOperation(params: LogOperationParams): void {
  db.run(
    `INSERT INTO operation_logs (
      user_id, user_phone, action, resource, resource_id,
      method, path, request_data, response_data,
      response_status, duration_ms, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.userPhone,
      params.action,
      params.resource,
      params.resourceId ?? null,
      params.method ?? null,
      params.path ?? null,
      params.requestData ? JSON.stringify(params.requestData) : null,
      params.responseData ? JSON.stringify(params.responseData) : null,
      params.responseStatus ?? null,
      params.durationMs ?? null,
      params.errorMessage ?? null,
    ]
  );
}

/**
 * Log a Sudorouter API call
 */
export function logSudorouterCall(params: {
  userId: number;
  userPhone: string;
  action: string;
  resourceId?: number;
  method: string;
  url: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseStatus: number;
  durationMs: number;
  errorMessage?: string;
}): void {
  logOperation({
    userId: params.userId,
    userPhone: params.userPhone,
    action: params.action,
    resource: 'sudorouter_api',
    resourceId: params.resourceId,
    method: params.method,
    path: params.url,
    requestData: params.requestBody,
    responseData: params.responseBody,
    responseStatus: params.responseStatus,
    durationMs: params.durationMs,
    errorMessage: params.errorMessage,
  });
}