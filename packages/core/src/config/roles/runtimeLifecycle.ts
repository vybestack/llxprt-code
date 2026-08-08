/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role interface for runtime lifecycle concerns — start, stop, and dispose
 * (issue #2615, P06b Gap 2).
 *
 * These members were the "unassigned" set in
 * `project-plans/issue2615/analysis/role-assignment.json`: used by composition
 * roots, not service locators, and not data reads. They form a genuine concern
 * (lifecycle management), not a dumping ground — anything that is not
 * start/stop/dispose does not belong here.
 *
 * Member signatures match the concrete Config / ConfigBase declarations
 * exactly.
 */

import type { MessageBus } from '../../confirmation-bus/message-bus.js';

export interface RuntimeLifecycle {
  dispose(): Promise<void>;
  initialize(dependencies?: { messageBus?: MessageBus }): Promise<void>;
  ensureInitialized(
    dependencies?:
      | { messageBus?: MessageBus }
      | (() => { messageBus: MessageBus }),
  ): Promise<void>;
  disposeScheduler(sessionId: string): void;
  shutdownLspService(): Promise<void>;
}
