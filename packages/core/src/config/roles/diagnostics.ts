/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role interface for diagnostic flags (debug mode, conversation logging).
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface Diagnostics {
  getDebugMode(): boolean;
  getConversationLoggingEnabled(): boolean;
}
