/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent, AgentHistoryItem } from '@vybestack/llxprt-code-agents';
import type { EmojiFilterMode } from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';

type OwnerUiReplay = {
  readonly history: readonly AgentHistoryItem[];
  readonly uiHistory: readonly HistoryItem[];
  readonly warnings: readonly string[];
};

export async function importOwnerSession(
  importSession: Agent['session']['importSession'],
  packageDirectory: string,
  emojiFilterMode: EmojiFilterMode,
  getHistory: Agent['session']['getHistory'],
): Promise<OwnerUiReplay> {
  await importSession(packageDirectory);
  const history = await getHistory();
  return {
    history,
    uiHistory: iContentToHistoryItems([...history], emojiFilterMode),
    warnings: [],
  };
}
