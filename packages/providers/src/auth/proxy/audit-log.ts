/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone audit-log function extracted from CredentialProxyServer to
 * keep the server file under the ESLint max-lines threshold.
 *
 * @plan PLAN-20260731-GHBROKER.P05, PLAN-20260901-PROXYAUDIT
 * @requirement REQ-006, REQ-007
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-storage';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import { redactTokenShaped } from './github-broker-errors.js';

/** Log severity level. */
export type AuditLevel = 'INFO' | 'WARN' | 'ERROR';

const SINK_FILE_NAME = 'credential-proxy-audit.log';

/**
 * Upper bound on records held per TUI-ownership span (#3490). frame_decode_error
 * (WARN) and process_frames_error (ERROR) fire per incoming proxy-socket chunk,
 * so a broken or hostile client can otherwise buffer one record per chunk for a
 * whole sandbox session — an unbounded-memory path that would also dump an
 * enormous block to stderr at release. 256 keeps the flush readable while
 * bounding the worst case. When full, the OLDEST records are dropped in favor
 * of the newest, and a summary line reports the drop on flush. Durability is
 * unaffected: every dropped record is already in the file sink.
 */
const MAX_DEFERRED_LINES = 256;

/**
 * Whether an Ink TUI owns this process's terminal (#3490). Set by the CLI
 * around the sandbox hop, when the host hands its terminal to the sandbox
 * TUI and stderr bytes would corrupt the interface.
 */
let tuiOwned = false;

/**
 * WARN/ERROR lines recorded while a TUI owned the terminal (#3490). The
 * host process that spawns the sandbox child has no UI subscriber for
 * coreEvents feedback — the Ink UI subscribing to it lives in the child,
 * and per-process events cannot cross that boundary — so without this
 * buffer the host's warnings and errors would never reach the operator.
 * Bounded to MAX_DEFERRED_LINES, keeping the most recent lines.
 */
const deferredDuringOwnership: string[] = [];

/**
 * Count of records evicted from {@link deferredDuringOwnership} because the
 * buffer was full. Reported once as the first line of the flush, then reset
 * alongside the buffer.
 */
let droppedFromDeferred = 0;

/**
 * Marks terminal ownership for the audit log. The only production caller is
 * maybeHopIntoSandbox(); every other entry point keeps the default (false)
 * stderr behavior. Releasing ownership (owned -> not-owned, once the sandbox
 * child has exited and the terminal is free) flushes the WARN/ERROR lines
 * deferred while it was held; re-asserting the current value does nothing.
 */
export function setTuiOwnsTerminal(owned: boolean): void {
  if (tuiOwned === owned) {
    return;
  }
  tuiOwned = owned;
  if (!owned) {
    flushDeferredLines();
  }
}

/** Read accessor mirroring {@link setTuiOwnsTerminal}. */
export function tuiOwnsTerminal(): boolean {
  return tuiOwned;
}

/**
 * Resets the audit-log routing state: terminal ownership, the deferred
 * buffer and the overflow counter. Test-only — deterministic per-test state
 * for suites that drive ownership; production resets ownership through
 * {@link setTuiOwnsTerminal} alone.
 */
export function resetAuditLogStateForTesting(): void {
  tuiOwned = false;
  deferredDuringOwnership.length = 0;
  droppedFromDeferred = 0;
}

/**
 * Writes one formatted record line to stderr through the guarded path shared
 * by the default write and the deferred flush. A closed or full stream must
 * never crash the proxy.
 */
function writeRecordToStderr(line: string): void {
  try {
    if (!process.stderr.destroyed) {
      process.stderr.write(line + '\n');
    }
  } catch {
    // stderr may be closed or full — audit logging must never crash the proxy
  }
}

/**
 * Emits the WARN/ERROR lines deferred while a TUI owned the terminal, then
 * clears the buffer so a later release cannot reprint them. When records
 * were dropped to keep the buffer at MAX_DEFERRED_LINES, a summary line
 * goes out FIRST so the operator knows the block is truncated; it is a JSON
 * object of the same shape as the records so the stream stays
 * one-JSON-object-per-line.
 */
function flushDeferredLines(): void {
  if (droppedFromDeferred > 0) {
    writeRecordToStderr(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'WARN' satisfies AuditLevel,
        component: 'credential-proxy',
        op: 'audit_deferred_overflow',
        details: { dropped: droppedFromDeferred },
      }),
    );
  }
  for (const line of deferredDuringOwnership) {
    writeRecordToStderr(line);
  }
  deferredDuringOwnership.length = 0;
  droppedFromDeferred = 0;
}

/**
 * Appends one JSON line to the durable sink under the global log dir. The
 * dir is resolved per write so LLXPRT_LOG_HOME / LLXPRT_CONFIG_HOME
 * overrides are honored. A sink that cannot be written must never take the
 * proxy down or suppress the other record surfaces.
 */
function appendToSink(line: string): void {
  try {
    const logDir = Storage.getGlobalLogDir();
    mkdirSync(logDir, { recursive: true });
    appendFileSync(path.join(logDir, SINK_FILE_NAME), line + '\n');
  } catch {
    // An unwritable sink degrades durability, not availability.
  }
}

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
 * Emits a structured, redacted JSON audit line to the durable sink and, per
 * terminal ownership, to stderr and/or the user-feedback surface (#3490).
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
  appendToSink(line);
  if (tuiOwned) {
    // The sandbox TUI is drawing on this process's terminal; zero bytes may
    // reach stderr. WARN/ERROR still surface through the UI feedback path
    // (for any process that has a subscriber) and are deferred to stderr so
    // the hop host — which has none — can flush them once the child exits.
    if (level !== 'INFO') {
      if (deferredDuringOwnership.length >= MAX_DEFERRED_LINES) {
        // Keep the most recent records; the evicted ones are already in the
        // durable sink, so this trades stderr flush volume, not durability.
        deferredDuringOwnership.shift();
        droppedFromDeferred++;
      }
      deferredDuringOwnership.push(line);
      coreEvents.emitFeedback(level === 'WARN' ? 'warning' : 'error', line);
    }
    return;
  }
  writeRecordToStderr(line);
}
