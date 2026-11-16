/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scheduler ownership of one subagent's tool calls, interactive and not,
 * with the code mode composition the subagent's own settings allow (issue
 * #4084). The composition reads the subagent's own selection, governance and
 * whitelist, so a script in the subagent can never reach more than the
 * subagent itself; nested calls carry the subagent's agent ID.
 */

import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  assembleSchedulerOwner,
  composeNestedExecution,
  type NestedSchedulerBase,
} from '../session/assembleSchedulerOwner.js';
import type { SessionSchedulerOwner } from '../session/sessionSchedulerOwner.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type {
  CodeModeSettingLimits,
  CodeModeSettings,
} from '../code-mode/code-mode-settings.js';

/** What a subagent's own settings say about code mode. */
export interface SubagentCodeMode {
  /** Enablement and surface, from the subagent's own settings. */
  readonly readSettings: () => CodeModeSettings;
  /** The subagent's limits, already lowered to its caller's. */
  readonly readLimits: () => CodeModeSettingLimits;
}

export function assembleSubagentSchedulerOwner(
  subagentId: string,
  base: NestedSchedulerBase,
  codeMode: SubagentCodeMode | undefined,
  readDeadline: () => number | undefined,
  callbacks: SchedulerCallbacks,
): SessionSchedulerOwner {
  // A subagent answers nested approvals the way it answers its own calls:
  // through the session's child display, never an approval handler.
  const nestedExecution =
    codeMode === undefined
      ? undefined
      : composeNestedExecution(
          subagentId,
          base,
          (options) => new CoreToolScheduler(options),
          {
            approval: undefined,
            readCodeModeLimits: codeMode.readLimits,
            readDeadline,
          },
        );
  return assembleSchedulerOwner(subagentId, {
    ...base,
    ...(nestedExecution === undefined ? {} : { nestedExecution }),
    ...callbacks,
  });
}
