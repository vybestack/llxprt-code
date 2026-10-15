/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent, AgentHistoryItem } from '@vybestack/llxprt-code-agents';
import type {
  ContinueTarget,
  EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';
import { resumeOwnerSession as resumeSession } from './resumeOwnerSession.js';

type OwnerUiReplay = {
  readonly history: readonly AgentHistoryItem[];
  readonly uiHistory: readonly HistoryItem[];
  readonly warnings: readonly string[];
};

export const resumeOwnerSession = resumeSession;

export async function importOwnerSession(
  agent: Agent,
  packageDirectory: string,
  emojiFilterMode: EmojiFilterMode,
): Promise<OwnerUiReplay> {
  await agent.session.importSession(packageDirectory);
  const history = await agent.session.getHistory();
  return {
    history,
    uiHistory: iContentToHistoryItems([...history], emojiFilterMode),
    warnings: [],
  };
}

export function listOwnerBrowserTargets(
  agent: Agent,
): Promise<readonly ContinueTarget[]> {
  return agent.session.listBrowserTargets();
}
