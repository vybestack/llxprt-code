/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types for the agentStream module.
 * Only cross-module stable types belong here.
 */

import { type AgentRequestInput } from '@vybestack/llxprt-code-core';

export enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

export interface QueuedSubmission {
  query: AgentRequestInput;
  options?: { isContinuation: boolean };
  promptId?: string;
}
