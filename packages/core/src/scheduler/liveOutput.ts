/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnsiOutput } from '../utils/terminalSerializer.js';

/**
 * Accumulates a live-output chunk onto an existing value.
 *
 * Tools that stream via `canUpdateOutput` deliver chunks in one of two
 * semantics:
 *
 * - **`AnsiOutput`** (e.g. the shell tool) — a full terminal-buffer snapshot.
 *   Each chunk supersedes the previous one, so the latest snapshot replaces
 *   the old value.
 * - **`string`** (e.g. the task tool streaming subagent text) — an incremental
 *   delta.  Each chunk must be appended to the existing text so the display
 *   grows rather than showing only the latest token.
 *
 * The `existing` parameter is typed `unknown` because callers may pass values
 * drawn from a broader display union (e.g. `ToolResultDisplay`, which also
 * includes `FileDiff` / `FileRead`).  The function only ever appends when both
 * values are strings; any other combination replaces with the incoming chunk.
 *
 * Note: the append-vs-replace distinction is currently inferred from the
 * payload type.  Migrating to an explicit tagged update protocol (e.g.
 * `{ mode: 'append'; data: string } | { mode: 'replace'; data: AnsiOutput }`)
 * is tracked in follow-up #2586.
 */
export function accumulateLiveOutput(
  existing: unknown,
  chunk: string | AnsiOutput,
): string | AnsiOutput {
  return typeof chunk === 'string' && typeof existing === 'string'
    ? existing + chunk
    : chunk;
}
