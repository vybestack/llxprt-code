/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role interface for session identity concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface SessionIdentity {
  getSessionId(): string;
  isInteractive(): boolean;
  getIdeMode(): boolean;
  adoptSessionId(sessionId: string): void;
  getMaxSessionTurns(): number;
  getContinueSessionRef(): string | null;
}
