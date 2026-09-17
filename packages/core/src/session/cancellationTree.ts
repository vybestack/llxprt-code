/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Linked cancellation for one session: tasks, shell jobs, child agents,
 * and pending auth and approval waits hang off a single root. A joined
 * signal aborts when the root aborts or when the joined node aborts.
 */
export interface CancellationTree {
  readonly root: AbortSignal;
  join(node?: AbortSignal): AbortSignal;
}
