/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent, AgentHistoryItem } from '@vybestack/llxprt-code-agents';
import {
  describeUnreadableRecording,
  matchUnreadableRecordings,
  type EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';

/**
 * Resume through the Agent session owner. Recordings discovery skipped as
 * unreadable come back as `warnings` (shown after the restore, like the raw
 * resume does), and a failed resume names the unreadable file it matched.
 */
export async function resumeOwnerSession(
  agent: Agent,
  ref: string,
  emojiFilterMode: EmojiFilterMode,
): Promise<{
  readonly history: readonly AgentHistoryItem[];
  readonly uiHistory: readonly HistoryItem[];
  readonly warnings: readonly string[];
}> {
  let history: readonly AgentHistoryItem[];
  try {
    history = await agent.session.resume(ref);
  } catch (error) {
    throw await nameUnreadableRecording(agent, ref, error);
  }
  const { unreadableRecordings } =
    await agent.session.listBrowserTargetsDetailed();
  return {
    history,
    uiHistory: iContentToHistoryItems([...history], emojiFilterMode),
    warnings: unreadableRecordings.map(
      (recording) =>
        `Skipped unreadable session recording ${describeUnreadableRecording(recording)}`,
    ),
  };
}

async function nameUnreadableRecording(
  agent: Agent,
  ref: string,
  error: unknown,
): Promise<unknown> {
  if (!(error instanceof Error)) return error;
  const { unreadableRecordings } =
    await agent.session.listBrowserTargetsDetailed();
  const named = matchUnreadableRecordings(
    ref,
    error.message.replace(/^Failed to resume session: /, ''),
    unreadableRecordings,
  );
  if (named.length === 0) return error;
  return new Error(
    `${error.message} (unreadable recording skipped: ${named.map(describeUnreadableRecording).join('; ')})`,
  );
}
