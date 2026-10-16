/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { StatsCommandOperations } from './statsCommand.js';
export function bindStatsCommand(
  readQuota: StatsCommandOperations['readQuota'],
  isOAuthAvailable: StatsCommandOperations['isOAuthAvailable'],
  discoverBuckets: StatsCommandOperations['discoverBuckets'],
  readStartTime: StatsCommandOperations['readStartTime'],
  addItem: UseHistoryManagerReturn['addItem'],
): StatsCommandOperations {
  return {
    readStartTime,
    readQuota,
    isOAuthAvailable,
    discoverBuckets,
    addItem,
  };
}
