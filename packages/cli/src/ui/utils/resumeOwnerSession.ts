/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  describeUnreadableRecording,
  matchUnreadableRecordings,
  type EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import { resumeHistoryWindow } from './streamHistoryItems.js';

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
  readonly uiHistory: readonly HistoryItem[];
  readonly warnings: readonly string[];
}> {
  let uiHistory: HistoryItem[];
  try {
    uiHistory = await resumeHistoryWindow(
      await agent.session.resume(ref),
      emojiFilterMode,
    );
  } catch (error) {
    throw await nameUnreadableRecording(agent, ref, error);
  }
  const { unreadableRecordings } =
    await agent.session.listBrowserTargetsDetailed();
  return {
    uiHistory,
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
