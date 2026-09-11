/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import type { HistoryItem } from '../types.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import type {
  HistoryItemUpdater,
  HistoryLimits,
} from '../stores/turn/historyLedger.js';
import { normalizeHistoryLimits } from '../stores/turn/historyLedger.js';
import type { TurnStore } from '../stores/turn/turnStore.js';

export interface UseHistoryManagerReturn {
  history: HistoryItem[];
  addItem: (
    itemData: Omit<HistoryItem, 'id'>,
    baseTimestamp?: number,
    isResuming?: boolean,
  ) => number;
  updateItem: (
    id: number,
    updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
  ) => void;
  clearItems: () => void;
  loadHistory: (newHistory: HistoryItem[]) => void;
}

export interface RetractableHistoryManagerReturn
  extends UseHistoryManagerReturn {
  removeItems: (ids: readonly number[]) => void;
}

export type RemoveHistoryItems = RetractableHistoryManagerReturn['removeItems'];

export interface UseHistoryOptions {
  maxItems?: number;
  maxBytes?: number;
}

/**
 * History state lives in the TurnStore (issue #2536 slice C2). This hook
 * keeps the command-orchestration role: it binds the store's history
 * commands, mirrors cleared conversations into ConversationContext, and
 * applies the display limits (dispatch -> effect ordering).
 */
export function useHistory(
  turnStore: TurnStore,
  options?: UseHistoryOptions,
): UseHistoryManagerReturn {
  return useRetractableHistory(turnStore, options);
}

export function useRetractableHistory(
  turnStore: TurnStore,
  options?: UseHistoryOptions,
): RetractableHistoryManagerReturn {
  const { store, commands } = turnStore;
  const maxItems = options?.maxItems;
  const maxBytes = options?.maxBytes;
  const limits: HistoryLimits = useMemo(
    () => normalizeHistoryLimits({ maxItems, maxBytes }),
    [maxItems, maxBytes],
  );

  const history = useStoreSelector(store, (state) => state.history);

  useEffect(() => {
    commands.setHistoryLimits(limits);
  }, [commands, limits]);

  return useMemo(
    () => ({
      history,
      addItem: commands.addItem,
      updateItem: commands.updateItem,
      removeItems: commands.removeItems,
      clearItems: commands.clearItems,
      loadHistory: commands.loadHistory,
    }),
    [history, commands],
  );
}
