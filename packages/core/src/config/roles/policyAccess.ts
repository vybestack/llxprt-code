/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApprovalMode } from '../configTypes.js';

/**
 * Role interface for approval-mode and folder-trust policy concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface PolicyAccess {
  getApprovalMode(): ApprovalMode;
  isTrustedFolder(): boolean;
  setApprovalMode(mode: ApprovalMode): void;
}
