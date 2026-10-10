/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TaskExecutionPolicy {
  readonly 'task-default-timeout-seconds'?: unknown;
  readonly 'task-max-timeout-seconds'?: unknown;
  readonly globalAsyncEnabled: boolean;
  readonly profileAsyncEnabled: boolean;
}

export interface SubagentRunPolicy {
  readonly maxTurnsPerPrompt?: number;
  readonly maxOutputTokensTotal?: number;
}
