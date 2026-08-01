/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cancel operation handler for the credential proxy server. Processes
 * `cancel` requests by aborting the target operation in the calling
 * connection's own pending registry.
 *
 * Cancel is scoped to the caller's own connection — one connection can
 * never cancel another's work. This falls out of the per-connection
 * registry and needs no extra check.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-007
 * @pseudocode 002-frame-and-cancel.md lines 43-59
 */

import type { ResponseWriter } from './response-writer.js';
import type { ConcurrentDispatchRegistry } from './concurrent-dispatch-registry.js';

/** Callback type for the audit-log function. */
export type AuditLogFn = (
  level: 'INFO' | 'WARN' | 'ERROR',
  connectionId: number,
  operation: string,
  details?: Record<string, unknown>,
) => void;

/**
 * Result of a cancel request, used to select the response.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-007
 */
export type CancelResult =
  | { kind: 'invalid' }
  | { kind: 'not_found'; targetId: string }
  | { kind: 'cancelled'; op: string; targetId: string };

/**
 * Evaluates a cancel request against the pending registry. Returns the
 * result so the caller can send the appropriate response and log it.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-007
 * @pseudocode 002-frame-and-cancel.md lines 43-59
 */
export function evaluateCancel(
  pending: ConcurrentDispatchRegistry,
  targetId: string | undefined,
): CancelResult {
  if (!targetId) return { kind: 'invalid' };
  const target = pending.get(targetId);
  if (target === undefined) return { kind: 'not_found', targetId };
  target.abort.abort();
  return { kind: 'cancelled', op: target.op, targetId };
}

/**
 * Handles the `cancel` operation end-to-end: evaluates, audits, and sends
 * the response. Cancel is scoped to the calling connection's own registry.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-007
 * @pseudocode 002-frame-and-cancel.md lines 43-59
 */
export function handleCancel(
  writer: ResponseWriter,
  id: string,
  payload: Record<string, unknown>,
  connectionId: number,
  pending: ConcurrentDispatchRegistry,
  auditLog: AuditLogFn,
): void {
  const targetId = payload.targetId as string | undefined;
  const result = evaluateCancel(pending, targetId);
  switch (result.kind) {
    case 'invalid':
      writer.sendError(id, 'INVALID_REQUEST', 'Missing targetId');
      break;
    case 'not_found':
      auditLog('INFO', connectionId, 'cancel', {
        status: 'not_found',
        targetId: result.targetId,
      });
      writer.sendOk(id, { cancelled: false });
      break;
    case 'cancelled':
      auditLog('INFO', connectionId, 'cancel', {
        op: result.op,
        status: 'ok',
        targetId: result.targetId,
      });
      writer.sendOk(id, { cancelled: true });
      break;
    default:
      break;
  }
}
