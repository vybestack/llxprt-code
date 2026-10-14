/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { StatsCommandOperations } from './statsCommand.js';
import { fetchAllQuotaInfo } from './statsQuota.js';
export function bindStatsCommand(
  api: RuntimeApi,
  oauth: OAuthControl,
  readStartTime: StatsCommandOperations['readStartTime'],
  addItem: UseHistoryManagerReturn['addItem'],
): StatsCommandOperations {
  return {
    readStartTime,
    readQuota: () => fetchAllQuotaInfo(api, oauth),
    isOAuthAvailable: () => oauth.isAvailable(),
    discoverBuckets: (logger) => oauth.discoverBuckets(logger),
    addItem,
  };
}
