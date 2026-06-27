/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolCallRequestInfo } from './turn.js';
import type {
  CompletedToolCall,
  OutputUpdateHandler,
  ToolCallsUpdateHandler,
} from './coreToolScheduler.js';

/**
 * Handle returned by a subagent scheduler factory.
 * Allows scheduling tool calls and optionally disposing of the scheduler.
 */
export interface SubagentSchedulerHandle {
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> | void;
  dispose?: () => void;
}

export type SubagentSchedulerFactory = (args: {
  schedulerConfig: Config;
  onAllToolCallsComplete: (calls: CompletedToolCall[]) => Promise<void>;
  outputUpdateHandler: OutputUpdateHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
}) => SubagentSchedulerHandle | Promise<SubagentSchedulerHandle>;
