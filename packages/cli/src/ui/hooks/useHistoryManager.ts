/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Buffer } from 'node:buffer';
import type { HistoryItem } from '../types.js';
import { ConversationContext } from '../../utils/ConversationContext.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../../constants/historyLimits.js';

// Global counter for generating unique message IDs across all hook instances.
// This prevents ID collisions when multiple useHistory hooks use the same baseTimestamp.
let globalMessageIdCounter = 0;

// Type for the updater function passed to updateHistoryItem
type HistoryItemUpdater = (
  prevItem: HistoryItem,
) => Partial<Omit<HistoryItem, 'id'>>;

export interface UseHistoryManagerReturn {
  history: HistoryItem[];
  addItem: (
    itemData: Omit<HistoryItem, 'id'>,
    baseTimestamp?: number,
    isResuming?: boolean,
  ) => number; // Returns the generated ID
  updateItem: (
    id: number,
    updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
  ) => void;
  clearItems: () => void;
  loadHistory: (newHistory: HistoryItem[]) => void;
}

export interface UseHistoryOptions {
  maxItems?: number;
  maxBytes?: number;
}

interface HistoryLimits {
  maxItems: number;
  maxBytes: number;
}

/**
 * Custom hook to manage the chat history state.
 *
 * Encapsulates the history array, message ID generation, adding items,
 * updating items, and clearing the history.
 */
function useHistoryLimits(
  options?: UseHistoryOptions,
): React.MutableRefObject<HistoryLimits> {
  const maxItems = options?.maxItems;
  const maxBytes = options?.maxBytes;
  const limits = useMemo(
    () => normalizeHistoryLimits({ maxItems, maxBytes }),
    [maxItems, maxBytes],
  );
  const limitsRef = useRef<HistoryLimits>(limits);

  useEffect(() => {
    limitsRef.current = limits;
  }, [limits]);

  return limitsRef;
}

function useHistoryMutators(
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>,
  limitsRef: React.MutableRefObject<HistoryLimits>,
): Pick<UseHistoryManagerReturn, 'addItem' | 'updateItem' | 'loadHistory'> {
  const getNextMessageId = useCallback((baseTimestamp: number): number => {
    globalMessageIdCounter += 1;
    return baseTimestamp * 1000 + globalMessageIdCounter;
  }, []);

  const loadHistory = useCallback(
    (newHistory: HistoryItem[]) => {
      setHistory(trimHistory(newHistory, limitsRef.current));
    },
    [limitsRef, setHistory],
  );

  const addItem = useCallback(
    (
      itemData: Omit<HistoryItem, 'id'>,
      baseTimestamp: number = Date.now(),
      _isResuming: boolean = false,
    ): number => {
      const id = getNextMessageId(baseTimestamp);
      const newItem: HistoryItem = { ...itemData, id } as HistoryItem;
      setHistory((prevHistory) =>
        appendHistoryItem(prevHistory, newItem, limitsRef.current),
      );
      return id;
    },
    [getNextMessageId, limitsRef, setHistory],
  );

  const updateItem = useCallback(
    (
      id: number,
      updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
    ) => {
      setHistory((prevHistory) =>
        trimHistory(
          updateHistoryItems(prevHistory, id, updates),
          limitsRef.current,
        ),
      );
    },
    [limitsRef, setHistory],
  );

  return { addItem, updateItem, loadHistory };
}

export function useHistory(
  options?: UseHistoryOptions,
): UseHistoryManagerReturn {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const limitsRef = useHistoryLimits(options);
  const { addItem, updateItem, loadHistory } = useHistoryMutators(
    setHistory,
    limitsRef,
  );

  useEffect(() => {
    setHistory((prev) => trimHistory(prev, limitsRef.current));
  }, [limitsRef]);

  const clearItems = useCallback(() => {
    setHistory([]);
    ConversationContext.startNewConversation();
  }, []);

  return useMemo(
    () => ({
      history,
      addItem,
      updateItem,
      clearItems,
      loadHistory,
    }),
    [history, addItem, updateItem, clearItems, loadHistory],
  );
}

function normalizeHistoryLimits(options?: UseHistoryOptions): HistoryLimits {
  return {
    maxItems: normalizeLimit(options?.maxItems, DEFAULT_HISTORY_MAX_ITEMS),
    maxBytes: normalizeLimit(options?.maxBytes, DEFAULT_HISTORY_MAX_BYTES),
  };
}

function normalizeLimit(
  value: number | null | undefined,
  fallback: number,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor(value);
}

function trimHistory(
  items: HistoryItem[],
  limits: HistoryLimits,
): HistoryItem[] {
  let trimmed = items;

  if (Number.isFinite(limits.maxItems) && trimmed.length > limits.maxItems) {
    trimmed = trimmed.slice(trimmed.length - limits.maxItems);
  }

  if (Number.isFinite(limits.maxBytes)) {
    let totalBytes = 0;
    const reversed: HistoryItem[] = [];

    for (let i = trimmed.length - 1; i >= 0; i--) {
      const item = trimmed[i];
      const itemBytes = estimateHistoryItemBytes(item);

      if (totalBytes + itemBytes > limits.maxBytes && reversed.length > 0) {
        break;
      }

      totalBytes += itemBytes;
      reversed.push(item);
    }

    trimmed = reversed.reverse();
  }

  return trimmed;
}

function estimateHistoryItemBytes(item: HistoryItem): number {
  try {
    return Buffer.byteLength(JSON.stringify(item), 'utf8');
  } catch {
    return 0;
  }
}

function appendHistoryItem(
  prevHistory: HistoryItem[],
  newItem: HistoryItem,
  limits: HistoryLimits,
): HistoryItem[] {
  if (prevHistory.length === 0) {
    return trimHistory([newItem], limits);
  }

  const lastItem = prevHistory[prevHistory.length - 1];
  if (
    lastItem.type === 'user' &&
    newItem.type === 'user' &&
    lastItem.text === newItem.text
  ) {
    return prevHistory;
  }
  return trimHistory([...prevHistory, newItem], limits);
}

function updateHistoryItems(
  prevHistory: HistoryItem[],
  id: number,
  updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
): HistoryItem[] {
  return prevHistory.map((item) => {
    if (item.id === id) {
      const newUpdates =
        typeof updates === 'function' ? updates(item) : updates;
      return { ...item, ...newUpdates } as HistoryItem;
    }
    return item;
  });
}
