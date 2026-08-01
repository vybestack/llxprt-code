/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone audit-log function extracted from CredentialProxyServer to
 * keep the server file under the ESLint max-lines threshold.
 *
 * @plan PLAN-20260731-GHBROKER.P05
 * @requirement REQ-006, REQ-007
 * @pseudocode 002-frame-and-cancel.md (structural extraction only)
 */

/** Log severity level. */
export type AuditLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * Audit-log callback signature. Matches the CredentialProxyServer.auditLog
 * method shape so it can be passed as a dependency to extracted modules.
 */
export type AuditLogFn = (
  level: AuditLevel,
  connectionId: number,
  operation: string,
  details?: Record<string, unknown>,
) => void;

/**
 * Emits a structured JSON log line to stderr for security audit purposes.
 * Never includes actual secrets — only operation names and non-sensitive
 * identifiers. Wrapped in try/catch so a full or closed stderr buffer
 * never crashes the proxy.
 */
export function auditLog(
  level: AuditLevel,
  connectionId: number,
  operation: string,
  details?: Record<string, unknown>,
): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component: 'credential-proxy',
    conn: connectionId,
    op: operation,
  };
  if (details) {
    entry.details = details;
  }
  try {
    if (!process.stderr.destroyed) {
      process.stderr.write(JSON.stringify(entry) + '\n');
    }
  } catch {
    // stderr may be closed or full — audit logging must never crash the proxy
  }
}
