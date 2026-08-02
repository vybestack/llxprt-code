/**
 * @license
 * Copyright 2026 Vybestack LLC
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
import { redactTokenShaped } from './github-broker-errors.js';

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
 *
 * `details` is caller-supplied, so the no-secrets property is enforced here
 * rather than asserted in prose: every emitted string is run through the
 * token redactor. The previous comment claimed secrets were never included
 * while nothing checked, which is the kind of guarantee that quietly stops
 * being true.
 *
 * Writing is wrapped so a full or closed stderr never crashes the proxy, but
 * a serialisation failure is not silently dropped: a minimal entry is
 * emitted instead, because a missing audit line is itself a security signal.
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
  let line: string;
  try {
    // Redact after serialising so nested values are covered too, without
    // walking arbitrary structures.
    line = redactTokenShaped(JSON.stringify(entry));
  } catch {
    // Serialisation failed (a circular value in details, say). Emit a
    // reduced entry rather than dropping the audit record entirely.
    line = JSON.stringify({
      ts: entry.ts,
      level,
      component: 'credential-proxy',
      conn: connectionId,
      op: operation,
      details: 'unserialisable',
    });
  }
  try {
    if (!process.stderr.destroyed) {
      process.stderr.write(line + '\n');
    }
  } catch {
    // stderr may be closed or full — audit logging must never crash the proxy
  }
}
