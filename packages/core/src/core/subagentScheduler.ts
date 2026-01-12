/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { ToolCallRequestInfo } from './turn.js';
import type {
  CompletedToolCall,
  OutputUpdateHandler,
  ToolCallsUpdateHandler,
} from './coreToolScheduler.js';

export type SubagentSchedulerFactory = (args: {
  schedulerConfig: Config;
  onAllToolCallsComplete: (calls: CompletedToolCall[]) => Promise<void>;
  outputUpdateHandler: OutputUpdateHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
}) => {
  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> | void;
  dispose?: () => void;
};
