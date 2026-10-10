/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent, AgentHistoryItem } from '@vybestack/llxprt-code-agents';
import type {
  ContinueTarget,
  EmojiFilterMode,
  UnreadableRecording,
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

/** Targets plus the unreadable recordings discovery skipped, as the browser reports them. */
export async function listOwnerBrowserListing(agent: Agent): Promise<{
  readonly targets: readonly ContinueTarget[];
  readonly skippedCount: number;
  readonly unreadableRecordings: readonly UnreadableRecording[];
}> {
  const { targets, unreadableRecordings } =
    await agent.session.listBrowserTargetsDetailed();
  return {
    targets,
    skippedCount: unreadableRecordings.length,
    unreadableRecordings,
  };
}

export function ownerBrowserSessionId(
  agent: Agent,
  targets: readonly ContinueTarget[],
  fallback: string,
): string {
  const path = agent.session.getRecording().path;
  const active = targets.find(
    (target) => target.kind === 'session' && target.session.filePath === path,
  );
  return active?.kind === 'session' ? active.session.sessionId : fallback;
}

export async function deleteOwnerBrowserTarget(
  agent: Agent,
  target: ContinueTarget,
): Promise<void> {
  if (target.kind === 'checkpoint') {
    await agent.session.deleteCheckpoint(target.checkpointId);
  } else {
    await agent.session.deleteSession(target.session.sessionId);
  }
}
