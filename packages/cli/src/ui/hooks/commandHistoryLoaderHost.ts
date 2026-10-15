/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { EmojiFilterMode, IContent } from '@vybestack/llxprt-code-core';
import type { SlashCommandActionReturn } from '../commands/types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import {
  createEmojiFilter,
  filterHistoryItems,
  iContentToHistoryItems,
} from '../utils/iContentToHistoryItems.js';

type HistoryResult = Extract<
  SlashCommandActionReturn,
  { type: 'load_history' }
>;
export function bindCommandHistoryLoader(
  replaceHistory: (history: HistoryResult['clientHistory']) => Promise<void>,
  readEmojiFilterMode: () => EmojiFilterMode,
  clear: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
): (result: HistoryResult) => Promise<void> {
  return async (result) => {
    await replaceHistory(result.clientHistory);
    const filter = createEmojiFilter(readEmojiFilterMode());
    clear();
    filterHistoryItems(result.history, filter).forEach((item, index) => {
      addItem(item, index);
    });
  };
}

export function bindResumedHistoryReplay(
  readEmojiFilterMode: () => EmojiFilterMode,
  clear: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
): (history: readonly IContent[]) => void {
  return (history) => {
    const uiHistory = iContentToHistoryItems(
      [...history],
      readEmojiFilterMode(),
    );
    clear();
    uiHistory.forEach((item, index) => {
      addItem(item, index);
    });
  };
}
