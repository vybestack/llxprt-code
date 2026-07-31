/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Buffer } from 'node:buffer';
import type { HistoryItem } from '../types.js';
import { ConversationContext } from '../../utils/ConversationContext.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../../constants/historyLimits.js';

let globalMessageIdCounter = 0;

const TRUNCATION_MARKER = '\n[... truncated to history limit ...]\n';

type HistoryItemUpdater = (
  prevItem: HistoryItem,
) => Partial<Omit<HistoryItem, 'id'>>;

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

export interface UseHistoryOptions {
  maxItems?: number;
  maxBytes?: number;
}

interface HistoryLimits {
  readonly maxItems: number;
  readonly maxBytes: number;
}

interface HistoryEntry {
  readonly item: HistoryItem;
  readonly bytes: number;
}

interface HistoryState {
  readonly entries: readonly HistoryEntry[];
  readonly totalBytes: number;
}

const EMPTY_HISTORY_STATE: HistoryState = { entries: [], totalBytes: 0 };

export function useHistory(
  options?: UseHistoryOptions,
): UseHistoryManagerReturn {
  const maxItems = options?.maxItems;
  const maxBytes = options?.maxBytes;
  const limits = useMemo(
    () => normalizeHistoryLimits({ maxItems, maxBytes }),
    [maxItems, maxBytes],
  );
  const [state, setState] = useState<HistoryState>(EMPTY_HISTORY_STATE);

  useEffect(() => {
    setState((previous) => trimHistoryState(previous, limits));
  }, [limits]);

  const getNextMessageId = useCallback((baseTimestamp: number): number => {
    globalMessageIdCounter += 1;
    return baseTimestamp * 1000 + globalMessageIdCounter;
  }, []);

  const loadHistory = useCallback(
    (newHistory: HistoryItem[]) => {
      setState(createHistoryState(newHistory, limits));
    },
    [limits],
  );

  const addItem = useCallback(
    (
      itemData: Omit<HistoryItem, 'id'>,
      baseTimestamp: number = Date.now(),
      _isResuming: boolean = false,
    ): number => {
      const id = getNextMessageId(baseTimestamp);
      const newItem: HistoryItem = { ...itemData, id } as HistoryItem;
      setState((previous) => appendHistoryItem(previous, newItem, limits));
      return id;
    },
    [getNextMessageId, limits],
  );

  const updateItem = useCallback(
    (
      id: number,
      updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
    ) => {
      setState((previous) => updateHistoryItem(previous, id, updates, limits));
    },
    [limits],
  );

  const clearItems = useCallback(() => {
    setState(EMPTY_HISTORY_STATE);
    ConversationContext.startNewConversation();
  }, []);

  const history = useMemo(
    () => state.entries.map((entry) => entry.item),
    [state.entries],
  );

  return useMemo(
    () => ({ history, addItem, updateItem, clearItems, loadHistory }),
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
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor(value);
}

function estimateHistoryItemBytes(item: HistoryItem): number {
  try {
    return Buffer.byteLength(JSON.stringify(item), 'utf8');
  } catch {
    return 0;
  }
}

function createHistoryEntry(
  item: HistoryItem,
  maxBytes: number,
): HistoryEntry | undefined {
  const bounded = boundHistoryItem(item, maxBytes);
  if (bounded === undefined) {
    return undefined;
  }
  return { item: bounded, bytes: estimateHistoryItemBytes(bounded) };
}

function createHistoryState(
  items: readonly HistoryItem[],
  limits: HistoryLimits,
): HistoryState {
  const entries = items.flatMap((item) => {
    const entry = createHistoryEntry(item, limits.maxBytes);
    return entry === undefined ? [] : [entry];
  });
  return trimHistoryState(
    {
      entries,
      totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    },
    limits,
  );
}

function trimHistoryState(
  state: HistoryState,
  limits: HistoryLimits,
): HistoryState {
  const itemStart = Number.isFinite(limits.maxItems)
    ? Math.max(0, state.entries.length - limits.maxItems)
    : 0;
  const itemBounded = state.entries.slice(itemStart);
  let totalBytes = itemBounded.reduce((total, entry) => total + entry.bytes, 0);
  let byteStart = 0;
  while (totalBytes > limits.maxBytes && byteStart < itemBounded.length - 1) {
    totalBytes -= itemBounded[byteStart].bytes;
    byteStart += 1;
  }
  return { entries: itemBounded.slice(byteStart), totalBytes };
}

function appendHistoryItem(
  previous: HistoryState,
  newItem: HistoryItem,
  limits: HistoryLimits,
): HistoryState {
  const lastEntry =
    previous.entries.length > 0
      ? previous.entries[previous.entries.length - 1]
      : null;
  if (
    lastEntry !== null &&
    lastEntry.item.type === 'user' &&
    newItem.type === 'user' &&
    lastEntry.item.text === newItem.text
  ) {
    return previous;
  }
  const entry = createHistoryEntry(newItem, limits.maxBytes);
  if (entry === undefined) {
    return previous;
  }
  return trimHistoryState(
    {
      entries: [...previous.entries, entry],
      totalBytes: previous.totalBytes + entry.bytes,
    },
    limits,
  );
}

function updateHistoryItem(
  previous: HistoryState,
  id: number,
  updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
  limits: HistoryLimits,
): HistoryState {
  const index = previous.entries.findIndex((entry) => entry.item.id === id);
  if (index < 0) {
    return previous;
  }
  const oldEntry = previous.entries[index];
  const newUpdates =
    typeof updates === 'function' ? updates(oldEntry.item) : updates;
  const updatedItem: HistoryItem = {
    ...oldEntry.item,
    ...newUpdates,
  } as HistoryItem;
  const updatedEntry = createHistoryEntry(updatedItem, limits.maxBytes);
  const entries =
    updatedEntry === undefined
      ? previous.entries
      : previous.entries.map((entry, entryIndex) =>
          entryIndex === index ? updatedEntry : entry,
        );
  const totalBytes =
    updatedEntry === undefined
      ? previous.totalBytes
      : previous.totalBytes - oldEntry.bytes + updatedEntry.bytes;
  return trimHistoryState({ entries, totalBytes }, limits);
}

function boundHistoryItem(
  item: HistoryItem,
  maxBytes: number,
): HistoryItem | undefined {
  if (
    !Number.isFinite(maxBytes) ||
    estimateHistoryItemBytes(item) <= maxBytes
  ) {
    return item;
  }
  if (maxBytes <= 0) {
    return undefined;
  }
  if (typeof item.text === 'string') {
    const fitted = fitHistoryText(item, item.text, maxBytes);
    if (fitted !== undefined) {
      return fitted;
    }
  }
  if (item.type === 'tool_group') {
    const perToolBytes = Math.max(1, Math.floor(maxBytes / item.tools.length));
    const tools = item.tools.map((tool) => ({
      ...tool,
      resultDisplay:
        typeof tool.resultDisplay === 'string'
          ? boundUtf8Text(tool.resultDisplay, perToolBytes)
          : tool.resultDisplay,
    }));
    const candidate: HistoryItem = { ...item, tools };
    if (estimateHistoryItemBytes(candidate) <= maxBytes) {
      return candidate;
    }
  }
  const fallback: HistoryItem = {
    id: item.id,
    type: 'info',
    text: '[History item truncated to byte limit]',
  };
  return estimateHistoryItemBytes(fallback) <= maxBytes ? fallback : undefined;
}

function fitHistoryText(
  item: HistoryItem,
  text: string,
  maxBytes: number,
): HistoryItem | undefined {
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  let fitted: HistoryItem | undefined;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const candidate: HistoryItem = {
      ...item,
      text: previewText(characters, count),
    } as HistoryItem;
    if (estimateHistoryItemBytes(candidate) <= maxBytes) {
      fitted = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  return fitted;
}

function previewText(characters: readonly string[], count: number): string {
  const prefixCount = Math.ceil(count / 2);
  const suffixCount = Math.floor(count / 2);
  return `${characters.slice(0, prefixCount).join('')}${TRUNCATION_MARKER}${characters.slice(characters.length - suffixCount).join('')}`;
}

function boundUtf8Text(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  let fitted = '';
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const candidate = previewText(characters, count);
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      fitted = candidate;
      low = count + 1;
    } else {
      high = count - 1;
    }
  }
  return fitted;
}
