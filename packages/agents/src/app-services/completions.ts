/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Completion boundary classification (REQ-021 / §4.7). Per the §4.7 decision,
 * prompt/command/at-command/MCP-prompt completion LOADING is intentionally
 * CLI-local (pure UI/UX), while the resulting actions resolve to runtime turns
 * or durable subpaths. This module exposes those explicit, typed classifications
 * (derived from the canonical command→API map) so the boundary is documented in
 * production rather than implied — no completion entry is an orphan.
 */

import { COMMAND_API_MAP } from './command-api-map.js';
import type { CommandApiMapping } from './types.js';

const COMPLETION_PREFIX = 'completions:';

export interface CliLocalCompletion {
  readonly completion: string;
  readonly kind: 'cli-local';
  readonly note: string;
}

/**
 * Return the explicit CLI-local completion classifications drawn from the
 * canonical map. Each entry documents why completion loading stays CLI-local.
 */
export function listCliLocalCompletions(): readonly CliLocalCompletion[] {
  return COMMAND_API_MAP.filter(
    (entry: CommandApiMapping): boolean =>
      entry.command.startsWith(COMPLETION_PREFIX) && entry.kind === 'cli-local',
  ).map((entry: CommandApiMapping) => ({
    completion: entry.command.slice(COMPLETION_PREFIX.length),
    kind: 'cli-local' as const,
    note: entry.note ?? 'Completion loading is CLI-local UI/UX',
  }));
}
