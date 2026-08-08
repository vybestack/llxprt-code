/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskToolRegistration } from '../toolRegistryFactory.js';

/**
 * Role interface for tool allow/exclude-list and registration concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface ToolAccess {
  getExcludeTools(): string[] | undefined;
  getAllowedTools(): string[] | undefined;
  getTaskToolRegistration(): TaskToolRegistration | undefined;
  setTaskToolRegistration(registration: TaskToolRegistration | undefined): void;
  getImagePayloadBudgetBytes(): number;
}
