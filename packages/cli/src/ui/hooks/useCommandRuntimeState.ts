/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useSlashCommandCancellation } from './useSlashCommandCancellation.js';
import { usePendingHistory } from './slashCommandProcessorSupport.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

export function useCommandRuntimeState(
  addItem: UseHistoryManagerReturn['addItem'],
): {
  oauthControl: ReturnType<typeof useOAuthControl>;
  cancellation: ReturnType<typeof useSlashCommandCancellation>;
  pending: ReturnType<typeof usePendingHistory>;
  session: ReturnType<typeof useSessionStats>;
} {
  return {
    oauthControl: useOAuthControl(),
    cancellation: useSlashCommandCancellation(),
    pending: usePendingHistory(addItem),
    session: useSessionStats(),
  };
}
