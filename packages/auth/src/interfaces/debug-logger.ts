/**
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.4
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interface for debug/error/warn logging, replacing direct DebugLogger imports.
 *
 * The method shape is derived from P00a preflight grep of actual logger usages
 * in auth-relevant files (auth-precedence-resolver.ts, precedence.ts,
 * keyring-token-store.ts, codex-device-flow.ts). Core's DebugLogger structurally
 * satisfies this interface.
 *
 * The module-level debugLogger singleton (from ../utils/debugLogger.js) and
 * DebugLogger class constructor (from ../debug/index.js) are core factory
 * concerns — auth receives an IDebugLogger instance via DI injection, not
 * the factory.
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.4
 */
export interface IDebugLogger {
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  log(...args: unknown[]): void;
}
