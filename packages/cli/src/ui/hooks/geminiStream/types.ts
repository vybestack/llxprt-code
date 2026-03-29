/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types for the geminiStream module.
 * Only cross-module stable types belong here.
 */

import type { PartListUnion } from '@google/genai';

export enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

export interface QueuedSubmission {
  query: PartListUnion;
  options?: { isContinuation: boolean };
  promptId?: string;
}
